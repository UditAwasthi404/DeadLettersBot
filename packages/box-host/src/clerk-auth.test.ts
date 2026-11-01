import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "@agentOS/shared";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import {
  type AccountLookup,
  type ClerkIdentity,
  accountForClerkIdentity,
  clerkSecretKey,
  setClerkSessionVerifier,
  useMockAuth,
  verifyBearerToken,
} from "./auth.ts";

function memoryLookup(): AccountLookup & {
  rows: Array<{ id: string; email: string; clerkUserId: string | null; sessionVersion: number }>;
} {
  const rows: Array<{
    id: string;
    email: string;
    clerkUserId: string | null;
    sessionVersion: number;
  }> = [];
  return {
    rows,
    async findByClerkUserId(userId) {
      const row = rows.find((item) => item.clerkUserId === userId);
      return row ? { id: row.id, sessionVersion: row.sessionVersion } : null;
    },
    async findByEmail(email) {
      const row = rows.find((item) => item.email === email);
      return row ? { id: row.id, sessionVersion: row.sessionVersion } : null;
    },
    async linkClerkUser(id, userId) {
      const row = rows.find((item) => item.id === id);
      if (row) row.clerkUserId = userId;
    },
    async create(input) {
      const row = {
        id: crypto.randomUUID(),
        email: input.email,
        clerkUserId: input.clerkUserId,
        sessionVersion: 0,
      };
      rows.push(row);
      return { id: row.id, sessionVersion: 0 };
    },
  };
}

const previous = new Map<string, string | undefined>();

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  setClerkSessionVerifier(null);
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previous.clear();
});

describe("auth mode", () => {
  test("uses Clerk only when a secret is set and mock flags are off", () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: "sk_test_secret",
    });
    expect(useMockAuth()).toBe(false);
    setEnv({ CLERK_MOCK: "1" });
    expect(useMockAuth()).toBe(true);
    setEnv({ CLERK_MOCK: "0", INFERENCE_MOCK: "1" });
    expect(useMockAuth()).toBe(true);
    setEnv({ INFERENCE_MOCK: "0", CLERK_SECRET_KEY: undefined });
    expect(useMockAuth()).toBe(true);
  });

  test("trims a Windows carriage return from the Clerk secret before choosing the mode", () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: "sk_test_secret\r",
    });
    expect(clerkSecretKey()).toBe("sk_test_secret");
    expect(useMockAuth()).toBe(false);
  });
});

describe("Clerk verification", () => {
  test("creates an account on first sign-in and reuses it", async () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: "sk_test_secret",
    });
    const lookup = memoryLookup();
    setClerkSessionVerifier(async () => ({
      userId: "user_abc",
      email: "Owner@Example.com",
      name: "Owner",
      sessionId: "sess_1",
    }));
    const first = await verifyBearerToken("Bearer clerk-session", {} as Database, lookup);
    const second = await verifyBearerToken("Bearer clerk-session", {} as Database, lookup);
    expect(first.accountId).toBe(second.accountId);
    expect(first.sub).toBe("user_abc");
    expect(first.clerkSessionId).toBe("sess_1");
    expect(first.scopes).toEqual(["admin"]);
    expect(lookup.rows).toHaveLength(1);
    expect(lookup.rows[0]?.email).toBe("owner@example.com");
    expect(lookup.rows[0]?.clerkUserId).toBe("user_abc");
  });

  test("attaches Clerk to an existing account with the same email", async () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: "sk_test_secret",
    });
    const lookup = memoryLookup();
    lookup.rows.push({
      id: "account-1",
      email: "owner@example.com",
      clerkUserId: null,
      sessionVersion: 2,
    });
    setClerkSessionVerifier(async () => ({
      userId: "user_abc",
      email: "owner@example.com",
      name: "Owner",
    }));
    const auth = await verifyBearerToken("Bearer clerk-session", {} as Database, lookup);
    expect(auth.accountId).toBe("account-1");
    expect(auth.sessionVersion).toBe(2);
    expect(lookup.rows[0]?.clerkUserId).toBe("user_abc");
  });

  test("middleware rejects a missing token and accepts a verified Clerk session", async () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: "sk_test_secret",
    });
    const lookup = memoryLookup();
    setClerkSessionVerifier(async (token) => {
      if (token !== "good-token") throw new Error("bad");
      return { userId: "user_abc", email: "owner@example.com", name: null, sessionId: "sess_1" };
    });
    const app = new Hono();
    let seenAccountId = "";
    app.use("*", async (c, next) => {
      try {
        const auth = await verifyBearerToken(c.req.header("Authorization"), {} as Database, lookup);
        seenAccountId = auth.accountId;
        await next();
      } catch (err) {
        const message = err instanceof Error ? err.message : "unauthorized";
        return c.text(message, 401);
      }
    });
    app.get("/ws", (c) => c.text(seenAccountId));
    app.get("/v1/bots", (c) => c.json({ accountId: seenAccountId }));

    const missing = await app.request("/ws");
    expect(missing.status).toBe(401);
    const bad = await app.request("/v1/bots", { headers: { Authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
    const ok = await app.request("/ws", { headers: { Authorization: "Bearer good-token" } });
    expect(ok.status).toBe(200);
    const accountId = await ok.text();
    const bots = await app.request("/v1/bots", { headers: { Authorization: "Bearer good-token" } });
    expect(await bots.json()).toEqual({ accountId });
  });
});

describe("mock JWT fallback", () => {
  test("still accepts a JWT_SECRET token when Clerk is not configured", async () => {
    setEnv({
      NODE_ENV: "development",
      CLERK_MOCK: "0",
      INFERENCE_MOCK: "0",
      CLERK_SECRET_KEY: undefined,
      JWT_SECRET: "test-secret-test-secret-test-secret",
    });
    expect(useMockAuth()).toBe(true);
    const accountId = crypto.randomUUID();
    const token = await sign(
      { accountId, sessionVersion: 0, scopes: ["admin"] },
      "test-secret-test-secret-test-secret",
    );
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ sessionVersion: 0 }],
          }),
        }),
      }),
    };
    const auth = await verifyBearerToken(`Bearer ${token}`, db as unknown as Database);
    expect(auth.accountId).toBe(accountId);
    expect(auth.scopes).toEqual(["admin"]);
  });
});

describe("account linking races", () => {
  test("returns the row created by a concurrent insert", async () => {
    const lookup = memoryLookup();
    let calls = 0;
    const original = lookup.create.bind(lookup);
    lookup.create = async (input) => {
      calls += 1;
      if (calls === 1) {
        await original(input);
        throw new Error("unique violation");
      }
      return original(input);
    };
    const identity: ClerkIdentity = {
      userId: "user_abc",
      email: "owner@example.com",
      name: "Owner",
    };
    const account = await accountForClerkIdentity(lookup, identity);
    expect(lookup.rows[0]?.id).toBe(account.id);
  });
});
