// STUDENT NAME, STUDENT NUMBER
// R5 and Bonus 10: the one error shape, request ids and one JSON log line per request.
import type { Context, MiddlewareHandler } from "hono";
import type { ZodError } from "zod";
import type { Env } from "./auth.ts";

export type Issue = { path: (string | number)[]; message: string };

/** { error, issues?, requestId }: the same shape for every failure. */
export function errorBody(c: Context<Env>, error: string, issues?: Issue[]) {
  return issues
    ? { error, issues, requestId: c.get("requestId") }
    : { error, requestId: c.get("requestId") };
}

export function toIssues(e: ZodError): Issue[] {
  return e.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: i.message,
  }));
}

/** A small helper with the signature the auth middleware expects. */
export function failWith(c: Context<Env>, status: 401 | 403, error: string): Response {
  return c.json(errorBody(c, error), status);
}

export type LogLine = {
  time: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  userId?: number;
};

/**
 * Give every request an id (x-request-id header, also in error bodies) and log one JSON line
 * when it is done. Only the method, the path (without the query string, which may hold a
 * WebSocket token), the status, the time and the user id are logged: never a body or a header.
 */
export const requestLog = (log: ((line: string) => void) | null): MiddlewareHandler<Env> =>
async (c, next) => {
  const start = performance.now();
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next(); // run the route first, then log
  c.res.headers.set("x-request-id", requestId); // also on responses made by onError/notFound
  if (!log) return;
  const line: LogLine = {
    time: new Date().toISOString(),
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Math.round(performance.now() - start),
  };
  const userId = c.get("userId");
  if (userId !== undefined) line.userId = userId;
  log(JSON.stringify(line));
};
