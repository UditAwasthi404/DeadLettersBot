/**
 * Poll Gmail and Google Calendar for new events and queue matching routines.
 * The first successful poll records the current ids and does not fire.
 */
import {
  GoogleConnector,
  OAuthPkceClient,
  connectorCredentialService,
  decryptToken,
  encryptConnectorSecret,
} from "@agentOS/connectors";
import { connectorAccounts } from "@agentOS/shared";
import { and, eq } from "drizzle-orm";
import { loadScheduleSources } from "./automation-sync.ts";
import { oauthConfigFromEnv } from "./connector-oauth.ts";
import type { GatewayDeps } from "./gateway.ts";
import { loggedError, logger } from "./logger.ts";
import { queueRoutine } from "./routine-queue.ts";
import { gmailEventQuery } from "./routine-trigger.ts";
import { drainAgent } from "./worker.ts";

type Cursor = { initialized: boolean; seenIds: string[] };

const MAX_ROUTINES = 20;
const MAX_NEW_EVENTS = 5;

function cursorKey(routineId: string): string {
  return `routine:${routineId}:connector-cursor`;
}

async function readCursor(deps: GatewayDeps, routineId: string): Promise<Cursor> {
  const raw = await deps.redis.get(cursorKey(routineId));
  if (!raw) return { initialized: false, seenIds: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return {
      initialized: parsed.initialized === true,
      seenIds: Array.isArray(parsed.seenIds)
        ? parsed.seenIds.filter((id): id is string => typeof id === "string").slice(0, 100)
        : [],
    };
  } catch {
    return { initialized: false, seenIds: [] };
  }
}

async function accessTokenFor(
  deps: GatewayDeps,
  accountId: string,
  service: "gmail" | "google-calendar",
): Promise<string | null> {
  const credentialService = connectorCredentialService(service);
  const [connection] = await deps.db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.accountId, accountId),
        eq(connectorAccounts.service, credentialService),
      ),
    )
    .limit(1);
  if (!connection) return null;
  const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("connector encryption is not configured");
  let accessToken = await decryptToken(
    connection.accessTokenCiphertext,
    encryptionKey,
    process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS,
    async (ciphertext) => {
      await deps.db
        .update(connectorAccounts)
        .set({ accessTokenCiphertext: ciphertext, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, connection.id));
    },
  );
  if (!connection.expiresAt || connection.expiresAt.getTime() >= Date.now() + 60_000)
    return accessToken;
  if (!connection.refreshTokenCiphertext)
    throw new Error("connector token expired; reconnect this service");
  const refreshToken = await decryptToken(
    connection.refreshTokenCiphertext,
    encryptionKey,
    process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS,
    async (ciphertext) => {
      await deps.db
        .update(connectorAccounts)
        .set({ refreshTokenCiphertext: ciphertext, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, connection.id));
    },
  );
  const tokens = await new OAuthPkceClient(oauthConfigFromEnv(credentialService)).refresh(
    refreshToken,
  );
  accessToken = tokens.accessToken;
  await deps.db
    .update(connectorAccounts)
    .set({
      accessTokenCiphertext: await encryptConnectorSecret(accessToken, encryptionKey),
      refreshTokenCiphertext: tokens.refreshToken
        ? await encryptConnectorSecret(tokens.refreshToken, encryptionKey)
        : connection.refreshTokenCiphertext,
      expiresAt: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000)
        : connection.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(connectorAccounts.id, connection.id));
  return accessToken;
}

async function eventIds(
  service: "gmail" | "google-calendar",
  trigger: {
    sender?: string;
    subject?: string;
    query?: string;
    calendarId?: string;
  },
  accessToken: string,
): Promise<Array<{ id: string; summary: string }>> {
  const google = new GoogleConnector();
  if (service === "gmail") {
    const listed = (await google.call(
      "gmail",
      "ListMessages",
      { query: gmailEventQuery(trigger), maxResults: 10 },
      accessToken,
    )) as { messages?: Array<{ id?: string }> };
    return (listed.messages ?? [])
      .map((message) => ({ id: message.id ?? "", summary: "Gmail message" }))
      .filter((message) => message.id);
  }
  const timeMin = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const listed = (await google.call(
    "calendar",
    "ListEvents",
    { calendarId: trigger.calendarId ?? "primary", maxResults: 10, timeMin },
    accessToken,
  )) as { items?: Array<{ id?: string; summary?: string }> };
  const subject = trigger.subject?.toLowerCase();
  return (listed.items ?? [])
    .filter((item) => item.id && (!subject || (item.summary ?? "").toLowerCase().includes(subject)))
    .map((item) => ({ id: item.id as string, summary: item.summary || "Calendar event" }));
}

let activeRun: Promise<number> | undefined;

export function pollConnectorEvents(deps: GatewayDeps): Promise<number> {
  if (activeRun) return activeRun;
  activeRun = poll(deps).finally(() => {
    activeRun = undefined;
  });
  return activeRun;
}

async function poll(deps: GatewayDeps): Promise<number> {
  const sources = (await loadScheduleSources(deps.db))
    .filter((routine) => routine.trigger.type === "connector_event")
    .slice(0, MAX_ROUTINES);
  let fired = 0;
  for (const routine of sources) {
    if (routine.trigger.type !== "connector_event") continue;
    try {
      const token = await accessTokenFor(deps, routine.accountId, routine.trigger.service);
      if (!token) continue;
      const found = await eventIds(routine.trigger.service, routine.trigger, token);
      const cursor = await readCursor(deps, routine.id);
      const seen = new Set(cursor.seenIds);
      const fresh = found.filter((item) => !seen.has(item.id)).slice(0, MAX_NEW_EVENTS);
      const seenIds = [...found.map((item) => item.id), ...cursor.seenIds]
        .filter((id, index, all) => all.indexOf(id) === index)
        .slice(0, 100);
      await deps.redis.set(
        cursorKey(routine.id),
        JSON.stringify({ initialized: true, seenIds }),
        "EX",
        60 * 60 * 24 * 14,
      );
      if (!cursor.initialized) continue;
      for (const item of fresh) {
        await queueRoutine(
          deps,
          routine,
          `${routine.trigger.service}: ${item.summary} (${item.id})`.slice(0, 500),
          (botId) => void drainAgent(botId, deps),
        );
        fired += 1;
      }
    } catch (err) {
      logger.error({ ...loggedError(err), routineId: routine.id }, "connector event poll failed");
    }
  }
  return fired;
}
