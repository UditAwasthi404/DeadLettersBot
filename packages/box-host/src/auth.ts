/**
 * Session verification.
 * Clerk session tokens are used when CLERK_SECRET_KEY is set.
 * CLERK_MOCK=1, INFERENCE_MOCK=1, or a missing Clerk secret (outside production)
 * keeps the local JWT_SECRET tokens the tests and the desktop fallback use.
 */

import { type Database, accounts } from "@agentOS/shared";
import { createClerkClient, verifyToken } from "@clerk/backend";
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
  /** Clerk session id (`sess_...`) when the bearer token is a Clerk session token. */
  clerkSessionId?: string;
}

export interface ClerkIdentity {
  userId: string;
  email: string;
  name: string | null;
  sessionId?: string;
}

export type ClerkSessionVerifier = (token: string) => Promise<ClerkIdentity>;

export interface AccountLookup {
  findByClerkUserId(userId: string): Promise<{ id: string; sessionVersion: number } | null>;
  findByEmail(email: string): Promise<{ id: string; sessionVersion: number } | null>;
  linkClerkUser(id: string, userId: string): Promise<void>;
  create(input: {
    email: string;
    displayName: string | null;
    clerkUserId: string;
  }): Promise<{ id: string; sessionVersion: number }>;
}

function clean(value: string | undefined): string {
  return (value ?? "").replaceAll("\r", "").trim();
}

export function clerkSecretKey(): string {
  return clean(process.env.CLERK_SECRET_KEY);
}

export function clerkPublishableKey(): string {
  return clean(process.env.CLERK_PUBLISHABLE_KEY);
}

/** Local JWTs signed with JWT_SECRET. Production always uses Clerk. */
export function useMockAuth(): boolean {
  if (process.env.CLERK_MOCK === "1" || process.env.INFERENCE_MOCK === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return !clerkSecretKey();
}

async function defaultClerkVerifier(token: string): Promise<ClerkIdentity> {
  const secretKey = clerkSecretKey();
  if (!secretKey) throw new AuthError("CLERK_SECRET_KEY is not configured");
  const parties = clean(process.env.CLERK_AUTHORIZED_PARTIES)
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
  let payload: { sub?: string; sid?: string };
  try {
    payload = await verifyToken(token, {
      secretKey,
      ...(parties.length ? { authorizedParties: parties } : {}),
    });
  } catch {
    throw new AuthError("invalid token");
  }
  if (!payload.sub) throw new AuthError("token missing subject");
  const user = await createClerkClient({ secretKey }).users.getUser(payload.sub);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses.find((item) => item.emailAddress)?.emailAddress;
  if (!email) throw new AuthError("Clerk user has no email address");
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
  return {
    userId: payload.sub,
    email,
    name,
    ...(payload.sid ? { sessionId: payload.sid } : {}),
  };
}

let clerkVerifier: ClerkSessionVerifier = defaultClerkVerifier;

/** Tests inject a verifier. Pass null to restore the Clerk Backend SDK. */
export function setClerkSessionVerifier(verifier: ClerkSessionVerifier | null): void {
  clerkVerifier = verifier ?? defaultClerkVerifier;
}

export function drizzleAccountLookup(db: Database): AccountLookup {
  return {
    async findByClerkUserId(userId) {
      const [row] = await db
        .select({ id: accounts.id, sessionVersion: accounts.sessionVersion })
        .from(accounts)
        .where(eq(accounts.clerkUserId, userId))
        .limit(1);
      return row ?? null;
    },
    async findByEmail(email) {
      const [row] = await db
        .select({ id: accounts.id, sessionVersion: accounts.sessionVersion })
        .from(accounts)
        .where(eq(accounts.email, email))
        .limit(1);
      return row ?? null;
    },
    async linkClerkUser(id, userId) {
      await db
        .update(accounts)
        .set({ clerkUserId: userId, updatedAt: new Date() })
        .where(eq(accounts.id, id));
    },
    async create(input) {
      const [row] = await db
        .insert(accounts)
        .values({
          email: input.email,
          displayName: input.displayName,
          clerkUserId: input.clerkUserId,
        })
        .returning({ id: accounts.id, sessionVersion: accounts.sessionVersion });
      if (!row) throw new AuthError("account could not be created");
      return row;
    },
  };
}

/** Find the local account for a Clerk user, or create one. Same email keeps the existing row. */
export async function accountForClerkIdentity(
  lookup: AccountLookup,
  identity: ClerkIdentity,
): Promise<{ id: string; sessionVersion: number }> {
  const linked = await lookup.findByClerkUserId(identity.userId);
  if (linked) return linked;
  const email = identity.email.toLowerCase();
  const existing = await lookup.findByEmail(email);
  if (existing) {
    await lookup.linkClerkUser(existing.id, identity.userId);
    return existing;
  }
  try {
    return await lookup.create({
      email,
      displayName: identity.name,
      clerkUserId: identity.userId,
    });
  } catch (err) {
    const raced =
      (await lookup.findByClerkUserId(identity.userId)) ?? (await lookup.findByEmail(email));
    if (raced) return raced;
    throw err instanceof AuthError ? err : new AuthError("account could not be created");
  }
}

export async function revokeClerkSession(sessionId: string | undefined): Promise<void> {
  const secretKey = clerkSecretKey();
  if (!sessionId || !secretKey || useMockAuth()) return;
  await createClerkClient({ secretKey }).sessions.revokeSession(sessionId);
}

export async function verifyBearerToken(
  authorization: string | undefined,
  db: Database,
  lookup: AccountLookup = drizzleAccountLookup(db),
): Promise<AuthPayload> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AuthError("missing bearer token");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!useMockAuth()) {
    let identity: ClerkIdentity;
    try {
      identity = await clerkVerifier(token);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError("invalid token");
    }
    const account = await accountForClerkIdentity(lookup, identity);
    return {
      accountId: account.id,
      sub: identity.userId,
      scopes: ["admin"],
      sessionVersion: account.sessionVersion,
      ...(identity.sessionId ? { clerkSessionId: identity.sessionId } : {}),
    };
  }

  const currentSecret = clean(process.env.JWT_SECRET);
  const previousSecret = clean(process.env.JWT_SECRET_PREVIOUS);
  const secrets = [currentSecret, previousSecret].filter((secret) => Boolean(secret));
  if (!secrets.length) throw new AuthError("JWT_SECRET not configured");
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
