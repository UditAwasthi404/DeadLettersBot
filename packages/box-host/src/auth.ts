/** JWT user sessions. Verification accepts JWT_SECRET, then JWT_SECRET_PREVIOUS during overlap. */

import { type Database, accounts } from "@agentOS/shared";
import { eq } from "drizzle-orm";
import { sign, verify } from "hono/jwt";

export type AuthScope = "read-only" | "read-write" | "admin";

export interface AuthPayload {
  accountId: string;
  sub?: string;
  scopes: AuthScope[];
  sessionVersion: number;
  /** Present when the presented JWT verified with JWT_SECRET_PREVIOUS and was re-signed. */
  refreshedToken?: string;
}

export async function verifyBearerToken(
  authorization: string | undefined,
  db: Database,
): Promise<AuthPayload> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("missing bearer token");
  }
  const currentSecret = process.env.JWT_SECRET?.trim();
  const previousSecret = process.env.JWT_SECRET_PREVIOUS?.trim();
  const secrets = [currentSecret, previousSecret].filter((secret): secret is string =>
    Boolean(secret),
  );
  if (!secrets.length) throw new AuthError("JWT_SECRET not configured");
  const token = authorization.slice("Bearer ".length).trim();
  let payload: Awaited<ReturnType<typeof verify>> | undefined;
  let usedPrevious = false;
  for (const secret of secrets) {
    try {
      payload = await verify(token, secret, "HS256");
      usedPrevious =
        Boolean(previousSecret) && secret === previousSecret && secret !== currentSecret;
      break;
    } catch {
      // During key rotation tokens signed by the previous key remain valid
      // until their normal expiry; remove that key after the overlap window.
    }
  }
  if (!payload) throw new AuthError("invalid token");
  const accountId = payload.accountId;
  if (typeof accountId !== "string" || !accountId) throw new AuthError("token missing accountId");
  const tokenVersion = payload.sessionVersion === undefined ? 0 : payload.sessionVersion;
  if (!Number.isInteger(tokenVersion) || Number(tokenVersion) < 0)
    throw new AuthError("invalid token session version");
  const [account] = await db
    .select({ sessionVersion: accounts.sessionVersion })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account || account.sessionVersion !== tokenVersion) throw new AuthError("session revoked");
  const rawScopes = payload.scopes;
  const scopes: AuthScope[] =
    rawScopes === undefined
      ? ["admin"]
      : Array.isArray(rawScopes) &&
          rawScopes.every((scope) => ["read-only", "read-write", "admin"].includes(String(scope)))
        ? (rawScopes as AuthScope[])
        : [];
  if (!scopes.length) throw new AuthError("invalid token scopes");
  const exp =
    typeof payload.exp === "number" ? payload.exp : Math.floor(Date.now() / 1000) + 86_400;
  const refreshedToken =
    usedPrevious && currentSecret
      ? await sign(
          {
            accountId,
            ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}),
            scopes,
            sessionVersion: tokenVersion,
            exp,
          },
          currentSecret,
        )
      : undefined;
  return {
    accountId,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    scopes,
    sessionVersion: tokenVersion,
    refreshedToken,
  };
}

export class AuthError extends Error {
  override readonly name = "AuthError";
}
