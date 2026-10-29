/** JWT user sessions (REQ-H06). Secret from JWT_SECRET env — no rotation yet. */

import { type Database, accounts } from "@agentOS/shared";
import { eq } from "drizzle-orm";
import { verify } from "hono/jwt";

export type AuthScope = "read-only" | "read-write" | "admin";

export interface AuthPayload {
  accountId: string;
  sub?: string;
  scopes: AuthScope[];
  sessionVersion: number;
}

export async function verifyBearerToken(
  authorization: string | undefined,
  db: Database,
): Promise<AuthPayload> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("missing bearer token");
  }
  const secrets = [process.env.JWT_SECRET, process.env.JWT_SECRET_PREVIOUS]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
  if (!secrets.length) throw new AuthError("JWT_SECRET not configured");
  const token = authorization.slice("Bearer ".length).trim();
  let payload: Awaited<ReturnType<typeof verify>> | undefined;
  for (const secret of secrets) {
    try {
      payload = await verify(token, secret, "HS256");
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
  return {
    accountId,
    sub: typeof payload.sub === "string" ? payload.sub : undefined,
    scopes,
    sessionVersion: tokenVersion,
  };
}

export class AuthError extends Error {
  override readonly name = "AuthError";
}
