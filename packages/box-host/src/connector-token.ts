import { OAuthPkceClient, decryptToken, encryptConnectorSecret } from "@agentOS/connectors";
import { type Database, connectorAccounts } from "@agentOS/shared";
import { eq } from "drizzle-orm";
import { oauthConfigFromEnv } from "./connector-oauth.ts";

export type StoredConnector = {
  id: string;
  expiresAt: Date | string | null;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  providerUserId: string | null;
};

export function connectorExpiresAt(value: Date | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** Refresh when the access token is missing an expiry or is inside the next minute. */
export function connectorNeedsRefresh(
  expiresAt: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  const time = connectorExpiresAt(expiresAt);
  if (time == null) return false;
  return time < now + 60_000;
}

function encryptionKey(): { current: string; previous?: string } {
  const current = process.env.CONNECTOR_ENCRYPTION_KEY?.replaceAll("\r", "").trim() ?? "";
  if (!current) throw new Error("connector encryption is not configured");
  const previous = process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS?.replaceAll("\r", "").trim();
  return { current, ...(previous ? { previous } : {}) };
}

/** Decrypt the stored access token and refresh it when it is due. */
export async function accessTokenForConnection(
  db: Database,
  connection: StoredConnector,
  credentialService: string,
  now = Date.now(),
): Promise<{ accessToken: string; instanceUrl: string | null }> {
  const { current, previous } = encryptionKey();
  let accessToken = await decryptToken(
    connection.accessTokenCiphertext,
    current,
    previous,
    async (ciphertext) => {
      await db
        .update(connectorAccounts)
        .set({ accessTokenCiphertext: ciphertext, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, connection.id));
    },
  );
  let instanceUrl = connection.providerUserId;
  if (!connectorNeedsRefresh(connection.expiresAt, now)) return { accessToken, instanceUrl };
  if (!connection.refreshTokenCiphertext)
    throw new Error("connector token expired; reconnect this service");
  const refreshToken = await decryptToken(
    connection.refreshTokenCiphertext,
    current,
    previous,
    async (ciphertext) => {
      await db
        .update(connectorAccounts)
        .set({ refreshTokenCiphertext: ciphertext, updatedAt: new Date() })
        .where(eq(connectorAccounts.id, connection.id));
    },
  );
  const tokens = await new OAuthPkceClient(oauthConfigFromEnv(credentialService)).refresh(
    refreshToken,
  );
  accessToken = tokens.accessToken;
  if (tokens.instanceUrl) instanceUrl = tokens.instanceUrl;
  await db
    .update(connectorAccounts)
    .set({
      accessTokenCiphertext: await encryptConnectorSecret(accessToken, current),
      refreshTokenCiphertext: tokens.refreshToken
        ? await encryptConnectorSecret(tokens.refreshToken, current)
        : connection.refreshTokenCiphertext,
      expiresAt: tokens.expiresIn
        ? new Date(now + tokens.expiresIn * 1000)
        : connectorExpiresAt(connection.expiresAt) == null
          ? null
          : new Date(connectorExpiresAt(connection.expiresAt) as number),
      ...(tokens.instanceUrl ? { providerUserId: tokens.instanceUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(connectorAccounts.id, connection.id));
  return { accessToken, instanceUrl };
}
