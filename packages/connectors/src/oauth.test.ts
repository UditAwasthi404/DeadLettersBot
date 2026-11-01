import { describe, expect, test } from "bun:test";
import {
  GoogleConnector,
  OAuthPkceClient,
  decryptConnectorSecret,
  encryptConnectorSecret,
  oauthConfigFor,
} from "./index.ts";

describe("connector oauth", () => {
  test("personal Microsoft consent does not request Teams or SharePoint scopes", () => {
    const config = oauthConfigFor("microsoft", {
      microsoftClientId: "ms-client",
      microsoftClientSecret: "ms-secret",
    });
    expect(config.scopes).toContain("Files.ReadWrite");
    expect(config.scopes).toContain("offline_access");
    expect(config.scopes.join(" ")).not.toContain("Team.");
    expect(config.scopes).not.toContain("Sites.ReadWrite.All");
  });

  test("work Microsoft scopes are added only when requested", () => {
    const config = oauthConfigFor("microsoft", {
      microsoftClientId: "ms-client",
      microsoftExtraScopes: "Sites.ReadWrite.All, Team.ReadBasic.All",
    });
    expect(config.scopes).toContain("Sites.ReadWrite.All");
    expect(config.scopes).toContain("Team.ReadBasic.All");
    expect(config.scopes.filter((scope) => scope === "Files.ReadWrite")).toHaveLength(1);
  });

  test("refresh sends the refresh grant and keeps the token endpoint", async () => {
    let posted = "";
    let url = "";
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      posted = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "next", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new OAuthPkceClient(
      oauthConfigFor("gmail", { googleClientId: "google-client", googleClientSecret: "secret" }),
      fetchImpl as typeof fetch,
    );
    const tokens = await client.refresh("refresh-1");
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(posted).toContain("grant_type=refresh_token");
    expect(posted).toContain("refresh_token=refresh-1");
    expect(posted).toContain("client_id=google-client");
    expect(tokens.accessToken).toBe("next");
    expect(tokens.refreshToken).toBeUndefined();
  });

  test("calendar free/busy sends the raw calendar id", async () => {
    let body = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      body = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };
    await new GoogleConnector(fetchImpl as typeof fetch).call(
      "calendar",
      "GetFreeBusy",
      { calendarId: "owner@example.com" },
      "token",
    );
    expect(JSON.parse(body).items).toEqual([{ id: "owner@example.com" }]);
  });

  test("a Windows carriage return on the encryption key still round-trips", async () => {
    const key = `${"ab".repeat(32)}\r`;
    const ciphertext = await encryptConnectorSecret("ya29.access", key);
    expect(await decryptConnectorSecret(ciphertext, key.trim())).toBe("ya29.access");
  });
});
