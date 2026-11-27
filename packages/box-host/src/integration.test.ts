import { describe, expect, test } from "bun:test";
/**
 * Phase 2/3 exit criteria against Postgres, Redis, and MinIO.
 * Start infra/docker/test-compose.yml, apply Drizzle migrations, then:
 *   AGENTOS_INTEGRATION=1 INFERENCE_MOCK=1 JWT_SECRET=integration-secret \
 *   DATABASE_URL=postgresql://agentos:agentos@127.0.0.1:5432/agentos \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   S3_ENDPOINT=http://127.0.0.1:9000 S3_ACCESS_KEY=minio S3_SECRET_KEY=minio12345 \
 *   pnpm --filter @agentos/box-host test src/integration.test.ts
 * The database must have no accounts. Live runs are not part of the default test command.
 */
import { createServer } from "node:http";
import type { InferenceSession, InferenceStreamEvent, ProviderFactory } from "@agentos/inference";
import {
  BlobStore,
  type ModelMessage,
  type ServerFrame,
  createDb,
  createRedis,
} from "@agentos/shared";
import { NoopVMManager } from "@agentos/vm-manager";
import { Hono } from "hono";
import { createGateway, runScheduledRoutines } from "./gateway.ts";
import { PEER_MESSAGE_HOP_BUDGET, peerHopBudgetExceeded } from "./peer-hops.ts";

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
    if (user.includes("SEND_TO_PEER") && !sawTool) {
      const target = user.match(/SEND_TO_PEER\s+(\S+)/)?.[1] ?? "";
      yield {
        type: "toolCall",
        toolCall: {
          id: "peer-1",
          name: "SendToAgent",
          args: { botId: target, message: "peer task", priority: false },
        },
      };
      return;
    }
    if (user.includes("CALL_MCP") && !sawTool) {
      const serverId = user.match(/CALL_MCP\s+(\S+)/)?.[1] ?? "";
      yield {
        type: "toolCall",
        toolCall: {
          id: "mcp-1",
          name: "MCPCall",
          args: { serverId, toolName: "echo", arguments: { text: "hello" } },
        },
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

      const peer = (await jsonRequest(app, "/v1/bots", boot.token, {
        method: "POST",
        body: JSON.stringify({ name: "PeerBot", role: "peer" }),
      })) as { id: string };
      const peerSend = await prompt(
        server.port,
        boot.token,
        bot.id,
        `SEND_TO_PEER ${peer.id}`,
        (frames) => frames.some((frame) => frame.type === "settled"),
      );
      expect(peerSend.some((frame) => frame.type === "toolEnd")).toBe(true);
      expect(peerHopBudgetExceeded(PEER_MESSAGE_HOP_BUDGET)).toBe(false);
      expect(peerHopBudgetExceeded(PEER_MESSAGE_HOP_BUDGET + 1)).toBe(true);

      const cron = (await jsonRequest(app, "/v1/routines", boot.token, {
        method: "POST",
        body: JSON.stringify({
          botId: bot.id,
          skillId: skill.id,
          name: "Cron",
          trigger: { type: "cron", expression: "* * * * *" },
        }),
      })) as { routine: { id: string } };
      const fired = await runScheduledRoutines(
        {
          db,
          redis,
          blob,
          providers: [scriptedProvider],
          vm: new NoopVMManager(),
          accountVms: new Map(),
        },
        new Date(),
      );
      expect(fired).toBeGreaterThan(0);
      const cronHistory = (await jsonRequest(
        app,
        `/v1/routines/${cron.routine.id}/history`,
        boot.token,
      )) as unknown[];
      expect(cronHistory.length).toBeGreaterThan(0);

      const mcpUpstream = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const payload = body ? (JSON.parse(body) as { method?: string; id?: unknown }) : {};
          res.setHeader("content-type", "application/json");
          if (payload.method === "initialize") {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                  protocolVersion: "2024-11-05",
                  capabilities: { tools: {} },
                  serverInfo: { name: "eval-mcp", version: "1.0.0" },
                },
              }),
            );
            return;
          }
          if (payload.method === "tools/list") {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                  tools: [
                    {
                      name: "echo",
                      description: "Echo text",
                      inputSchema: { type: "object", properties: { text: { type: "string" } } },
                    },
                  ],
                },
              }),
            );
            return;
          }
          if (payload.method === "tools/call") {
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: payload.id,
                result: { content: [{ type: "text", text: "hello" }] },
              }),
            );
            return;
          }
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "unsupported" }));
        });
      });
      await new Promise<void>((resolve) => mcpUpstream.listen(0, "127.0.0.1", resolve));
      const mcpPort = (mcpUpstream.address() as { port: number }).port;
      try {
        const mcp = (await jsonRequest(app, "/v1/connectors/mcp", boot.token, {
          method: "POST",
          body: JSON.stringify({
            name: "Local MCP",
            url: `http://127.0.0.1:${mcpPort}/mcp`,
            apiKey: "test-key",
          }),
        })) as { id: string };
        const mcpCall = await prompt(
          server.port,
          boot.token,
          bot.id,
          `CALL_MCP ${mcp.id}`,
          (frames) => frames.some((frame) => frame.type === "settled"),
        );
        expect(mcpCall.some((frame) => frame.type === "toolEnd" || frame.type === "settled")).toBe(
          true,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          mcpUpstream.close((err) => (err ? reject(err) : resolve())),
        );
      }
    } finally {
      server.stop(true);
      redis.disconnect();
    }
  }, 90_000);
});
