import { describe, expect, test } from "bun:test";
import { encryptConnectorSecret } from "@agentOS/connectors";
import type { Database } from "@agentOS/shared";
import { describeConnectedConnectors } from "./connector-availability.ts";
import { accessTokenForConnection, connectorNeedsRefresh } from "./connector-token.ts";

const KEY = "cd".repeat(32);

describe("connected connector prompt", () => {
  test("names Gmail send when gmail is connected and does not invent other services", () => {
    const text = describeConnectedConnectors(["gmail"]);
    expect(text).toContain("gmail is connected");
    expect(text).toContain('action "SendMessage"');
    expect(text).not.toContain("google-drive is connected");
  });
});

describe("connector access tokens", () => {
  const previous = new Map<string, string | undefined>();
  function setEnv(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      if (!previous.has(key)) previous.set(key, process.env[key]);
      process.env[key] = value;
    }
  }
  function restoreEnv() {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  }

  test("returns the stored token while it is still valid", async () => {
    setEnv({ CONNECTOR_ENCRYPTION_KEY: KEY });
    const access = await encryptConnectorSecret("ya29.current", KEY);
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await accessTokenForConnection(
        { update: () => ({ set: () => ({ where: async () => [] }) }) } as unknown as Database,
        {
          id: "conn-1",
          expiresAt: new Date(Date.now() + 60 * 60_000),
          accessTokenCiphertext: access,
          refreshTokenCiphertext: null,
          providerUserId: null,
        },
        "gmail",
      );
      expect(result.accessToken).toBe("ya29.current");
      expect(fetches).toBe(0);
      expect(connectorNeedsRefresh(new Date(Date.now() + 60 * 60_000))).toBe(false);
    } finally {
      globalThis.fetch = original;
      restoreEnv();
    }
  });

  test("refreshes a token that expires within a minute and keeps the old refresh token", async () => {
    setEnv({
      CONNECTOR_ENCRYPTION_KEY: KEY,
      GOOGLE_OAUTH_CLIENT_ID: "google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    });
    const access = await encryptConnectorSecret("ya29.old", KEY);
    const refresh = await encryptConnectorSecret("refresh-1", KEY);
    const saved: Record<string, unknown>[] = [];
    const db = {
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            saved.push(patch);
            return [];
          },
        }),
      }),
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=refresh-1");
      return new Response(JSON.stringify({ access_token: "ya29.new", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await accessTokenForConnection(
        db as unknown as Database,
        {
          id: "conn-1",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          accessTokenCiphertext: access,
          refreshTokenCiphertext: refresh,
          providerUserId: null,
        },
        "gmail",
      );
      expect(result.accessToken).toBe("ya29.new");
      expect(saved.some((patch) => patch.accessTokenCiphertext)).toBe(true);
      const written = saved.find((patch) => patch.refreshTokenCiphertext);
      expect(written?.refreshTokenCiphertext).toBe(refresh);
    } finally {
      globalThis.fetch = original;
      restoreEnv();
    }
  });
});
