// Umut Berke Şenyayla, 2000002240
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { and, eq, gt, sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db.ts";
import { type Role, ROLES, sessions, users } from "./schema.ts";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const SESSION_SECONDS = 60 * 60; // a session lives for one hour

/** Log a user in: store a random token for them and return it. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  await db.client.execute({
    sql:
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, strftime('%s','now') + ?)",
    args: [token, userId, SESSION_SECONDS],
  });
  return token;
}

/** Return the user id that owns a valid, unexpired token, or null. */
export async function userIdFromToken(db: Db, token: string): Promise<number | null> {
  const res = await db.client.execute({
    sql:
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > strftime('%s','now')",
    args: [token],
  });
  const id = res.rows[0]?.user_id;
  return id === undefined ? null : Number(id);
}

// ---- who is calling ---------------------------------------------------------------------

export type Identity = { userId: number; role: Role };

/** Two ways to make and check a login token; the routes do not care which one runs. */
export interface TokenService {
  readonly kind: "session" | "jwt";
  issue(db: Db, who: Identity): Promise<string>;
  verify(db: Db, token: string): Promise<Identity | null>;
}

/** R3: a random token stored in the sessions table. One lookup per request (with the role). */
export const sessionTokens = (): TokenService => ({
  kind: "session",
  issue: (db, who) => createSession(db, who.userId),
  async verify(db, token) {
    const [row] = await db.db.select({ userId: users.id, role: users.role })
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(eq(sessions.token, token), gt(sessions.expiresAt, sql`strftime('%s','now')`)),
      );
    return row ?? null;
  },
});

/** Bonus 7: a signed JWT. No database lookup; the role travels in a claim. */
export function jwtTokens(secret: string, expiresIn = "1h"): TokenService {
  const key = new TextEncoder().encode(secret);
  return {
    kind: "jwt",
    issue: (_db, who) => signToken(key, who, expiresIn),
    verify: (_db, token) => verifyToken(key, token),
  };
}

export function signToken(
  key: Uint8Array,
  who: Identity,
  expiresIn = "1h",
): Promise<string> {
  return new SignJWT({ role: who.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(who.userId))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(
  key: Uint8Array,
  token: string,
): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const role = ROLES.find((r) => r === payload.role);
    if (!Number.isInteger(userId) || userId < 1 || !role) return null;
    return { userId, role };
  } catch {
    return null; // bad signature, malformed or expired
  }
}

// ---- middleware -------------------------------------------------------------------------

export type Env = {
  Variables: { db: Db; userId: number; role: Role; requestId: string };
};

/** Read "Authorization: Bearer <token>" and return the token, or "" when it is missing. */
export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1] ?? "";
}

type Fail = (
  c: Parameters<MiddlewareHandler<Env>>[0],
  status: 401 | 403,
  error: string,
) => Response;

/**
 * R3: stop with 401 unless the request carries a valid token. On success the user id and
 * role are stored for the routes: c.get("userId"), c.get("role").
 */
export const requireAuth =
  (tokens: TokenService, fail: Fail): MiddlewareHandler<Env> => async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    const who = token ? await tokens.verify(c.get("db"), token) : null;
    if (!who) return fail(c, 401, "unauthorized");
    c.set("userId", who.userId);
    c.set("role", who.role);
    await next();
  };

/** Bonus 9: 401 when nobody is logged in, 403 when the role is not one of `roles`. */
export const requireRole =
  (fail: Fail, ...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    const role = c.get("role");
    if (!role) return fail(c, 401, "unauthorized");
    if (!roles.includes(role)) return fail(c, 403, "forbidden");
    await next();
  };
