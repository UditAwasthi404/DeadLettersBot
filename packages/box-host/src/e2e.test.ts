/**
 * Phase 1 exit criterion: sendPrompt → accepted → message → settled.
 * INFERENCE_MOCK via mockProvider; MockVMManager (no Docker / no real browser).
 */
import { describe, expect, test } from "bun:test";
import { mockProvider } from "@agentOS/inference";
import {
  type BlobBucket,
  type ServerFrame,
  accounts as accountsTable,
  bots as botsTable,
  steps as stepsTable,
  turns as turnsTable,
} from "@agentOS/shared";
import type { ExecResult, VMInfo, VMManager } from "@agentOS/vm-manager";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { createGateway } from "./gateway.ts";

class MockVMManager implements VMManager {
  async provisionVM(accountId: string): Promise<VMInfo> {
    return { vmId: `mock-${accountId}`, accountId, status: "running" };
  }
  async wakeVM(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "running" };
  }
  async suspendVM(_vmId: string): Promise<void> {}
  async terminateVM(_vmId: string): Promise<void> {}
  async getVMStatus(vmId: string): Promise<VMInfo> {
    return { vmId, accountId: "", status: "running" };
  }
  async execInContainer(_vmId: string, cmd: string[], _input?: string): Promise<ExecResult> {
    if (cmd[0] === "cat") return { stdout: "hello file", stderr: "", exitCode: 0 };
    if (cmd[0] === "ls") return { stdout: "file.txt\n", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async ensureBotBrowser(): Promise<number> {
    return 9222;
  }
}

type TurnRow = {
  id: string;
  botId: string;
  runId: string;
  type: string;
  input: { prompt: string; attachments: unknown[]; nonce: string };
  state: string;
  checkpointRootId?: string | null;
  usage?: unknown;
  settledAt?: Date | null;
};

function createMockDb(
  account: { id: string; sessionVersion: number },
  bot: (typeof botsTable)["$inferSelect"],
  turnStore: TurnRow[],
  stepStore: unknown[],
) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (n: number) => {
            if (table === accountsTable) return [account].slice(0, n);
            if (table === botsTable) return [bot].slice(0, n);
            if (table === turnsTable) return turnStore.slice(-1).slice(0, n);
            return [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        if (table === turnsTable) turnStore.push(v as TurnRow);
        else if (table === stepsTable) stepStore.push(v);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Partial<TurnRow>) => ({
        where: async () => {
          if (table === turnsTable) {
            for (const t of turnStore) Object.assign(t, patch);
          }
        },
      }),
    }),
    execute: async () => [{ ok: 1 }],
  };
}

function createMockRedis() {
  const kv = new Map<string, string>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();
  return {
    async connect() {},
    async ping() {
      return "PONG";
    },
    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes("NX") && kv.has(key)) return null;
      kv.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async publish() {
      return 0;
    },
    async zadd(key: string, score: number, member: string) {
      const arr = zsets.get(key) ?? [];
      arr.push({ score, member });
      arr.sort((a, b) => a.score - b.score);
      zsets.set(key, arr);
      return 1;
    },
    async zpopmin(key: string, _count = 1) {
      const arr = zsets.get(key) ?? [];
      const item = arr.shift();
      zsets.set(key, arr);
      if (!item) return [];
      return [item.member, String(item.score)];
    },
  };
}

function createMockBlob() {
  const store = new Map<string, Uint8Array>();
  return {
    conversationKey(accountId: string, botId: string, turnId: string, name = "root.bin") {
      return `${accountId}/${botId}/${turnId}/${name}`;
    },
    async ensureBuckets() {},
    async put(_bucket: BlobBucket, key: string, body: Uint8Array | Buffer | string) {
      const bytes =
        typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
      store.set(key, bytes);
    },
    async get(_bucket: BlobBucket, key: string) {
      return store.get(key) ?? null;
    },
  };
}

describe("Phase 1 e2e", () => {
  test("sendPrompt → accepted + message + settled", async () => {
    process.env.JWT_SECRET = "e2e-secret";
    process.env.INFERENCE_MOCK = "1";

    const accountId = crypto.randomUUID();
    const botId = crypto.randomUUID();
    const now = new Date();
    const bot = {
      id: botId,
      accountId,
      name: "E2EBot",
      systemPrompt: "",
      profileText: "",
      role: "main" as const,
      skills: [] as string[],
      tools: [] as string[],
      memorySettings: { agentScope: true, userScope: true, projectScope: false },
      approvalSettings: {
        autoReviewRules: [] as { actionPattern: string; mode: "require" | "always_allow" }[],
        defaultLevel: 0 as const,
      },
      inferenceSettings: {},
      createdAt: now,
      updatedAt: now,
    };
    const turnStore: TurnRow[] = [];
    const stepStore: unknown[] = [];

    const app = new Hono();
    const deps = {
      db: createMockDb({ id: accountId, sessionVersion: 0 }, bot, turnStore, stepStore) as never,
      redis: createMockRedis() as never,
      blob: createMockBlob() as never,
      providers: [mockProvider],
      vm: new MockVMManager(),
      accountVms: new Map<string, string>(),
    };
    const { websocket } = createGateway(app, deps);

    const server = Bun.serve({
      port: 0,
      fetch: app.fetch,
      websocket,
    });

    const token = await sign({ accountId }, "e2e-secret");
    const frames: ServerFrame[] = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("e2e timeout")), 15_000);
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      } as never);
      ws.onmessage = (ev) => {
        const frame = JSON.parse(String(ev.data)) as ServerFrame;
        frames.push(frame);
        if (frame.type === "settled" || frame.type === "error") {
          clearTimeout(timeout);
          ws.close();
          resolve();
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
            agentId: botId,
            nonce: crypto.randomUUID(),
            prompt: "read /etc/hostname and tell me what it says",
            attachments: [],
          }),
        );
      };
    });

    server.stop(true);

    expect(frames.some((f) => f.type === "accepted")).toBe(true);
    const message = frames.find((f) => f.type === "message");
    expect(message).toBeDefined();
    if (message && message.type === "message") {
      expect(message.content.length).toBeGreaterThan(0);
    }
    expect(frames.some((f) => f.type === "settled")).toBe(true);
  }, 20_000);
});
