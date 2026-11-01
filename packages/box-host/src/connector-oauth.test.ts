import { describe, expect, test } from "bun:test";
import { decryptConnectorSecret } from "@agentOS/connectors";
import { accounts, connectorAccounts } from "@agentOS/shared";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import { validateRuntimeConfig } from "./config.ts";
import { configuredOAuthRedirectUri } from "./connector-oauth.ts";
import { createGateway } from "./gateway.ts";

const ENCRYPTION_KEY = "ab".repeat(32);

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const finish = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = run();
  if (result && typeof (result as Promise<void>).then === "function")
    return (result as Promise<void>).finally(finish);
  finish();
  return result;
}

describe("oauth redirect", () => {
  test("strips a Windows carriage return and prefers OAUTH_REDIRECT_URI", () => {
    return withEnv(
      {
        OAUTH_REDIRECT_URI: "http://127.0.0.1:8787/v1/connectors/oauth/callback\r",
        GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:8787/v1/connectors/oauth/callback",
      },
      () => {
        expect(
          configuredOAuthRedirectUri("http://localhost:8787/v1/connectors/oauth/start/gmail"),
        ).toBe("http://127.0.0.1:8787/v1/connectors/oauth/callback");
      },
    );
  });
});

describe("runtime config", () => {
  test("writes the trimmed connector key back so encryption matches validation", async () => {
    await withEnv(
      {
        NODE_ENV: "development",
        INFERENCE_MOCK: "1",
        PORT: "8787",
        S3_FORCE_PATH_STYLE: "true",
        METRICS_ENABLED: "0",
        MEMORY_SYNTHESIS_ENABLED: "0",
        MCP_STRICT_MODE: "0",
        BOX_HOSTED_FOR_AUTOMATION_SYNC: "1",
        DATABASE_URL: "postgresql://agentos:agentos@127.0.0.1:5432/agentos",
        REDIS_URL: "redis://127.0.0.1:6379",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_ACCESS_KEY: "minio",
        S3_SECRET_KEY: "minio12345",
        JWT_SECRET: "dev-secret-change-me-but-long-enough",
        CONNECTOR_ENCRYPTION_KEY: `${ENCRYPTION_KEY} \r`,
        GOOGLE_OAUTH_CLIENT_ID: "google-client\r",
      },
      () => {
        validateRuntimeConfig();
        expect(process.env.CONNECTOR_ENCRYPTION_KEY).toBe(ENCRYPTION_KEY);
        expect(process.env.GOOGLE_OAUTH_CLIENT_ID).toBe("google-client");
      },
    );
  });
});

describe("oauth connect flow", () => {
  test("stores a trimmed Google client and keeps the old refresh token", async () => {
    await withEnv(
      {
        JWT_SECRET: "connector-test-secret",
        CONNECTOR_ENCRYPTION_KEY: ENCRYPTION_KEY,
        GOOGLE_OAUTH_CLIENT_ID: "google-client\r",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret\r",
        GOOGLE_OAUTH_REDIRECT_URI: "http://127.0.0.1:8787/v1/connectors/oauth/callback\r",
        MICROSOFT_OAUTH_CLIENT_ID: "ms-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "ms-secret",
        MICROSOFT_OAUTH_EXTRA_SCOPES: undefined,
      },
      async () => {
        const accountId = crypto.randomUUID();
        const kv = new Map<string, string>();
        const connections: Array<Record<string, unknown>> = [];
        const db = {
          select: () => ({
            from: (table: unknown) => {
              const load = () => (table === accounts ? [{ id: accountId, sessionVersion: 0 }] : []);
              const chain = Object.assign(Promise.resolve().then(load), {
                where() {
                  return chain;
                },
                limit(n: number) {
                  return Promise.resolve(load().slice(0, n));
                },
              });
              return chain;
            },
          }),
          insert: (table: unknown) => ({
            values(row: Record<string, unknown>) {
              return {
                async onConflictDoUpdate(update: { set: Record<string, unknown> }) {
                  if (table !== connectorAccounts) return;
                  const existing = connections.find(
                    (item) => item.accountId === row.accountId && item.service === row.service,
                  );
                  if (!existing) {
                    connections.push({ ...row });
                    return;
                  }
                  for (const [key, value] of Object.entries(update.set)) {
                    if (typeof value === "string" || value instanceof Date || Array.isArray(value))
                      existing[key] = value;
                  }
                },
              };
            },
          }),
          update: () => ({ set: () => ({ where: async () => [] }) }),
          execute: async () => [],
        };
        const redis = {
          async incr() {
            return 1;
          },
          async expire() {
            return 1;
          },
          async set(key: string, value: string) {
            kv.set(key, value);
            return "OK";
          },
          async getdel(key: string) {
            const value = kv.get(key) ?? null;
            kv.delete(key);
            return value;
          },
          async del(key: string) {
            kv.delete(key);
            return 1;
          },
        };
        const app = new Hono();
        createGateway(app, {
          db: db as never,
          redis: redis as never,
          blob: {} as never,
          providers: [],
          vm: {} as never,
          accountVms: new Map(),
        });
        const token = await sign({ accountId, sessionVersion: 0 }, "connector-test-secret");
        const started = await app.request("http://127.0.0.1:8787/v1/connectors/oauth/start/gmail", {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(started.status).toBe(302);
        const location = new URL(started.headers.get("location") ?? "");
        expect(location.origin).toBe("https://accounts.google.com");
        expect(location.searchParams.get("client_id")).toBe("google-client");
        expect(location.searchParams.get("redirect_uri")).toBe(
          "http://127.0.0.1:8787/v1/connectors/oauth/callback",
        );
        expect(location.searchParams.get("code_challenge_method")).toBe("S256");
        expect(location.searchParams.get("access_type")).toBe("offline");
        expect(location.searchParams.get("scope")).toContain("gmail.modify");
        expect(location.searchParams.get("scope")).not.toContain("drive");

        const state = location.searchParams.get("state") ?? "";
        let refreshIncluded = true;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: string | URL | Request) => {
          if (!String(input).includes("oauth2.googleapis.com/token"))
            throw new Error(`unexpected fetch ${String(input)}`);
          return new Response(
            JSON.stringify({
              access_token: refreshIncluded ? "access-1" : "access-2",
              ...(refreshIncluded ? { refresh_token: "refresh-1" } : {}),
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/gmail.modify",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch;
        try {
          const callback = await app.request(
            `http://127.0.0.1:8787/v1/connectors/oauth/callback?state=${state}&code=auth-code`,
          );
          expect(callback.status).toBe(200);
          expect(await callback.text()).toContain("Service connected");
          const first = connections[0];
          expect(first?.service).toBe("gmail");
          expect(
            await decryptConnectorSecret(String(first?.refreshTokenCiphertext), ENCRYPTION_KEY),
          ).toBe("refresh-1");

          const again = await app.request("http://127.0.0.1:8787/v1/connectors/oauth/start/gmail", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const nextState = new URL(again.headers.get("location") ?? "").searchParams.get("state");
          refreshIncluded = false;
          const reconnected = await app.request(
            `http://127.0.0.1:8787/v1/connectors/oauth/callback?state=${nextState}&code=auth-code`,
          );
          expect(reconnected.status).toBe(200);
          expect(connections).toHaveLength(1);
          expect(
            await decryptConnectorSecret(
              String(connections[0]?.refreshTokenCiphertext),
              ENCRYPTION_KEY,
            ),
          ).toBe("refresh-1");
          expect(
            await decryptConnectorSecret(
              String(connections[0]?.accessTokenCiphertext),
              ENCRYPTION_KEY,
            ),
          ).toBe("access-2");

          const microsoft = await app.request(
            "http://127.0.0.1:8787/v1/connectors/oauth/start/microsoft",
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const microsoftScope =
            new URL(microsoft.headers.get("location") ?? "").searchParams.get("scope") ?? "";
          expect(microsoftScope).toContain("Files.ReadWrite");
          expect(microsoftScope).not.toContain("Sites.ReadWrite.All");

          const denied = await app.request(
            `http://127.0.0.1:8787/v1/connectors/oauth/callback?error=access_denied&error_description=${encodeURIComponent("user said <no>")}&state=unused`,
          );
          expect(denied.status).toBe(400);
          const deniedText = await denied.text();
          expect(deniedText).toContain("user said &lt;no&gt;");
          expect(deniedText).not.toContain("<no>");
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  });
});
