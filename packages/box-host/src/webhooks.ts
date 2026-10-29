import { createHmac, randomUUID } from "node:crypto";
import { decryptConnectorSecret } from "@agentOS/connectors";
import { type Database, webhookDeliveries, webhookSubscriptions } from "@agentOS/shared";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";

export type WebhookEvent = "turn.settled" | "routine.completed" | "approval.required";

const requestedAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 6);
const MAX_ATTEMPTS = Number.isFinite(requestedAttempts)
  ? Math.max(1, Math.min(10, Math.trunc(requestedAttempts)))
  : 6;
const CLAIM_LEASE_MS = 30_000;
const requestedRetentionDays = Number(process.env.WEBHOOK_DELIVERY_RETENTION_DAYS ?? 30);
const DELIVERY_RETENTION_DAYS = Number.isFinite(requestedRetentionDays)
  ? Math.max(0, Math.min(3650, Math.trunc(requestedRetentionDays)))
  : 30;
const PRUNE_INTERVAL_MS = 60 * 60_000;
let localBatchRunning = false;
let lastPrunedAt = 0;

class WebhookHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseSnippet: string,
  ) {
    super(message);
  }
}

async function readResponseSnippet(response: Response, maxBytes = 1024): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  let consumed = 0;
  try {
    while (consumed < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - consumed;
      const chunk = value.subarray(0, remaining);
      consumed += chunk.byteLength;
      output += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        await reader.cancel();
        break;
      }
    }
    output += decoder.decode();
  } catch {
    // Keep the bounded portion already read; the response body is only diagnostic data.
  }
  return output;
}

/** Persist event deliveries first; a background worker performs signed requests and retries. */
export async function deliverWebhookEvent(
  db: Database,
  accountId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.accountId, accountId));
  const targets = rows.filter((row) => row.events.includes(event));
  if (!targets.length) return;
  const eventId = randomUUID();
  const now = new Date();
  await db.insert(webhookDeliveries).values(
    targets.map((target) => ({
      eventId,
      accountId,
      subscriptionId: target.id,
      event,
      url: target.url,
      eventData: data,
      status: "queued" as const,
      nextAttemptAt: now,
    })),
  );
}

/** Claim and process a bounded batch. Conditional updates make claims safe across replicas. */
export async function processWebhookDeliveries(
  db: Database,
  batchSize = 10,
  now = new Date(),
): Promise<number> {
  if (localBatchRunning) return 0;
  localBatchRunning = true;
  try {
    const wallClockNow = Date.now();
    if (DELIVERY_RETENTION_DAYS > 0 && wallClockNow - lastPrunedAt >= PRUNE_INTERVAL_MS) {
      const cutoff = new Date(wallClockNow - DELIVERY_RETENTION_DAYS * 24 * 60 * 60_000);
      await db
        .delete(webhookDeliveries)
        .where(
          and(
            lte(webhookDeliveries.createdAt, cutoff),
            or(
              eq(webhookDeliveries.status, "delivered"),
              eq(webhookDeliveries.status, "failed"),
              eq(webhookDeliveries.status, "cancelled"),
            ),
          ),
        );
      lastPrunedAt = wallClockNow;
    }

    const eligible = or(
      and(eq(webhookDeliveries.status, "queued"), lte(webhookDeliveries.nextAttemptAt, now)),
      and(eq(webhookDeliveries.status, "processing"), lte(webhookDeliveries.leaseUntil, now)),
    );
    const candidates = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(eligible)
      .orderBy(asc(webhookDeliveries.createdAt))
      .limit(Math.max(1, Math.min(batchSize, 100)));

    await Promise.all(
      candidates.map(async (candidate) => {
        const claimTime = new Date();
        const [delivery] = await db
          .update(webhookDeliveries)
          .set({
            status: "processing",
            attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
            leaseUntil: new Date(claimTime.getTime() + CLAIM_LEASE_MS),
            updatedAt: claimTime,
          })
          .where(and(eq(webhookDeliveries.id, candidate.id), eligible))
          .returning();
        if (!delivery) return;

        const [subscription] = await db
          .select({ secretCiphertext: webhookSubscriptions.secretCiphertext })
          .from(webhookSubscriptions)
          .where(
            and(
              eq(webhookSubscriptions.id, delivery.subscriptionId),
              eq(webhookSubscriptions.accountId, delivery.accountId),
            ),
          )
          .limit(1);
        if (!subscription) {
          await db
            .update(webhookDeliveries)
            .set({
              status: "cancelled",
              nextAttemptAt: null,
              leaseUntil: null,
              lastError: "subscription was removed before delivery",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(webhookDeliveries.id, delivery.id),
                eq(webhookDeliveries.status, "processing"),
              ),
            );
          return;
        }

        try {
          const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
          if (!encryptionKey) throw new Error("CONNECTOR_ENCRYPTION_KEY is not configured");
          const secret = await decryptConnectorSecret(
            subscription.secretCiphertext,
            encryptionKey,
            process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS,
          );
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const body = JSON.stringify({
            id: delivery.eventId,
            event: delivery.event,
            timestamp,
            data: delivery.eventData,
          });
          const signature = createHmac("sha256", secret)
            .update(`${timestamp}.${body}`)
            .digest("hex");
          const response = await fetch(delivery.url, {
            method: "POST",
            redirect: "manual",
            headers: {
              "Content-Type": "application/json",
              "X-AgentOS-Event": delivery.event,
              "X-AgentOS-Timestamp": timestamp,
              "X-AgentOS-Signature": `sha256=${signature}`,
            },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          const responseSnippet = await readResponseSnippet(response);
          if (!response.ok)
            throw new WebhookHttpError(
              `Webhook returned HTTP ${response.status}`,
              response.status,
              responseSnippet,
            );
          await db
            .update(webhookDeliveries)
            .set({
              status: "delivered",
              nextAttemptAt: null,
              leaseUntil: null,
              lastStatusCode: response.status,
              lastError: null,
              responseSnippet,
              deliveredAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(webhookDeliveries.id, delivery.id),
                eq(webhookDeliveries.status, "processing"),
              ),
            );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const httpError = err instanceof WebhookHttpError ? err : undefined;
          const exhausted = delivery.attemptCount >= MAX_ATTEMPTS;
          const retryDelayMs = Math.min(
            60 * 60_000,
            5_000 * 2 ** Math.max(0, delivery.attemptCount - 1),
          );
          await db
            .update(webhookDeliveries)
            .set({
              status: exhausted ? "failed" : "queued",
              nextAttemptAt: exhausted ? null : new Date(Date.now() + retryDelayMs),
              leaseUntil: null,
              lastStatusCode: httpError?.status ?? null,
              lastError: message.slice(0, 2_000),
              responseSnippet: httpError?.responseSnippet.slice(0, 1_024) ?? null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(webhookDeliveries.id, delivery.id),
                eq(webhookDeliveries.status, "processing"),
              ),
            );
          console.warn(
            `[webhooks] delivery ${delivery.id} attempt ${delivery.attemptCount}/${MAX_ATTEMPTS} failed: ${message}`,
          );
        }
      }),
    );
    return candidates.length;
  } finally {
    localBatchRunning = false;
  }
}

export async function deleteWebhookSubscription(db: Database, accountId: string, id: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(webhookSubscriptions)
      .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.accountId, accountId)))
      .returning({ id: webhookSubscriptions.id });
    if (!deleted) return false;
    await tx
      .update(webhookDeliveries)
      .set({
        status: "cancelled",
        nextAttemptAt: null,
        leaseUntil: null,
        lastError: "subscription was removed before delivery",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookDeliveries.subscriptionId, deleted.id),
          or(eq(webhookDeliveries.status, "queued"), eq(webhookDeliveries.status, "processing")),
        ),
      );
    return true;
  });
}
