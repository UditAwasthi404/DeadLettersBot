/**
 * Phase 2 exit criteria against Postgres, Redis, and MinIO.
 * Start infra/docker/test-compose.yml, apply Drizzle migrations, then:
 *   AGENTOS_INTEGRATION=1 INFERENCE_MOCK=1 JWT_SECRET=integration-secret \
 *   DATABASE_URL=postgresql://agentos:agentos@127.0.0.1:5432/agentos \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY=minio S3_SECRET_KEY=minio12345 \
 *   pnpm --filter @agentOS/box-host test src/integration.test.ts
 * The database must have no accounts. Live runs are not part of the default test command.
 */
import { describe, expect, test } from "bun:test";
import type { InferenceSession, InferenceStreamEvent, ProviderFactory } from "@agentOS/inference";
import {
  BlobStore,
  type ModelMessage,
  type ServerFrame,
  createDb,
  createRedis,
} from "@agentOS/shared";
import { NoopVMManager } from "@agentOS/vm-manager";
import { Hono } from "hono";
import { createGateway } from "./gateway.ts";

const enabled = process.env.AGENTOS_INTEGRATION === "1";

class ScriptedSession implements InferenceSession {
  readonly providerId = "mock";
  readonly purpose;
  constructor(purpose: InferenceSession["purpose"]) {
    this.purpose = purpose;
  }
  async *streamComplete(messages: ModelMessage[]): AsyncIterable<InferenceStreamEvent> {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const sawTool = messages.some((message) => message.role === "tool");
    if (user.includes("RUN_SHELL") && !sawTool) {
      yield {
        type: "toolCall",
        toolCall: { id: "shell-1", name: "RunShell", args: { command: "echo agentos" } },
      };
      return;
    }
    const memory = system.includes("phase2-memory-marker") ? " phase2-memory-marker" : "";
    const reply = `Mock reply: ${user}${memory}`;
    yield { type: "token", delta: reply };
    yield {
      type: "toolCall",
      toolCall: {
        id: `send-${crypto.randomUUID()}`,
        name: "SendToUser",
        args: { content: reply, endTurn: true },
      },
    };
  }
}

const scriptedProvider: ProviderFactory = {
  id: "mock",
  createSession: (purpose) => new ScriptedSession(purpose),
};

async function jsonRequest(
  app: Hono,
  path: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await app.request(path, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function prompt(
  port: number,
  token: string,
  agentId: string,
  text: string,
  until: (frames: ServerFrame[]) => boolean,
): Promise<ServerFrame[]> {
  return new Promise((resolve, reject) => {
    const frames: ServerFrame[] = [];
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${text}`)), 20_000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { Authorization: `Bearer ${token}` },
    } as never);
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      frames.push(frame);
      if (frame.type === "needsApproval") {
        ws.send(
          JSON.stringify({
            type: "approve",
            agentId,
            runId: frame.runId,
            actionId: frame.actionId,
            decision: "allow_once",
          }),
        );
      }
      if (frame.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(frame.message));
      } else if (until(frames)) {
        clearTimeout(timeout);
        ws.close();
        resolve(frames);
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("websocket error"));
    };
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "sendPrompt",
          agentId,
          nonce: crypto.randomUUID(),
          prompt: text,
          attachments: [],
        }),
      );
    };
  });
}

describe.skipIf(!enabled)("Phase 2 exit criteria", () => {
  test("account, prompt, memory, webhook routine, and approved shell", async () => {
    process.env.INFERENCE_MOCK = "1";
    process.env.JWT_SECRET ??= "integration-secret-integration-secret";
    const db = createDb();
    const redis = createRedis();
    await redis.connect();
    const blob = new BlobStore();
    await blob.ensureBuckets();
    const app = new Hono();
    const { websocket } = createGateway(app, {
      db,
      redis,
      blob,
      providers: [scriptedProvider],
      vm: new NoopVMManager(),
      accountVms: new Map(),
    });
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
    try {
      const email = `phase2-${crypto.randomUUID()}@example.com`;
      const boot = (await jsonRequest(app, "/v1/auth/bootstrap", undefined, {
        method: "POST",
        body: JSON.stringify({ email, displayName: "Phase 2" }),
      })) as { token: string };
      const bot = (await jsonRequest(app, "/v1/bots", boot.token, {
        method: "POST",
        body: JSON.stringify({ name: "Phase2" }),
      })) as { id: string };

      const listed = await prompt(server.port, boot.token, bot.id, "list files in /tmp", (frames) =>
        frames.some((frame) => frame.type === "settled"),
      );
      expect(listed.some((frame) => frame.type === "accepted")).toBe(true);
      expect(listed.some((frame) => frame.type === "message")).toBe(true);

      await jsonRequest(app, `/v1/bots/${bot.id}/memory`, boot.token, {
        method: "POST",
        body: JSON.stringify({ scope: "agent", content: "phase2-memory-marker" }),
      });
      const remembered = await prompt(
        server.port,
        boot.token,
        bot.id,
        "what do you remember",
        (frames) => frames.some((frame) => frame.type === "settled"),
      );
      const rememberedText = remembered
        .filter((frame) => frame.type === "token" || frame.type === "message")
        .map((frame) => ("content" in frame ? frame.content : "delta" in frame ? frame.delta : ""))
        .join("");
      expect(rememberedText).toContain("phase2-memory-marker");

      const skill = (await jsonRequest(app, "/v1/skills", boot.token, {
        method: "POST",
        body: JSON.stringify({
          name: "Two steps",
          steps: [{ instruction: "Say one" }, { instruction: "Say two" }],
        }),
      })) as { id: string };
      const routine = (await jsonRequest(app, "/v1/routines", boot.token, {
        method: "POST",
        body: JSON.stringify({
          botId: bot.id,
          skillId: skill.id,
          name: "Webhook",
          trigger: { type: "webhook" },
        }),
      })) as { routine: { id: string }; webhookSecret?: string };
      expect(routine.webhookSecret).toBeTruthy();
      await jsonRequest(app, `/v1/webhooks/${routine.routine.id}`, undefined, {
        method: "POST",
        headers: { "X-Routine-Secret": routine.webhookSecret ?? "" },
        body: JSON.stringify({ hello: true }),
      });
      const history = (await jsonRequest(
        app,
        `/v1/routines/${routine.routine.id}/history`,
        boot.token,
      )) as unknown[];
      expect(history.length).toBeGreaterThan(0);

      const shell = await prompt(server.port, boot.token, bot.id, "RUN_SHELL", (frames) =>
        frames.some((frame) => frame.type === "settled"),
      );
      expect(shell.some((frame) => frame.type === "needsApproval")).toBe(true);
      expect(shell.some((frame) => frame.type === "toolEnd")).toBe(true);
      expect(shell.some((frame) => frame.type === "settled")).toBe(true);
    } finally {
      server.stop(true);
      redis.disconnect();
    }
  }, 60_000);
});
