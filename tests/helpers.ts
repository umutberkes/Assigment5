// STUDENT NAME, STUDENT NUMBER
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";

type App = ReturnType<typeof createApp>;

/**
 * Every test gets a fresh, empty database in its own temporary file.
 * (An in-memory database loses its tables after a transaction with libSQL,
 * so a temporary file is the safe choice.)
 */
export async function freshApp(): Promise<App> {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  return createApp(db);
}

/** Send JSON with an optional bearer token. */
export function send(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  return Promise.resolve(app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

/** Register a user and log in; returns the token. */
export async function loginAs(app: App, email: string, password = "kadikoy-1907"): Promise<string> {
  await send(app, "POST", "/auth/register", { email, password });
  const res = await send(app, "POST", "/auth/login", { email, password });
  const { token } = await res.json();
  return token;
}

/** Create a task for the user behind the token; returns the parsed task. */
export async function makeTask(
  app: App,
  token: string,
  body: Record<string, unknown>,
): Promise<{ id: number; title: string; status: string }> {
  const res = await send(app, "POST", "/api/tasks", body, token);
  if (res.status !== 201) throw new Error(`makeTask: ${res.status} ${await res.text()}`);
  return await res.json();
}
