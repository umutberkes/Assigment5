// Umut Berke Şenyayla, 2000002240
import { type AppDeps, createApp } from "../src/app.ts";
import { type Config, testConfig } from "../src/config.ts";
import { createDbPool, migrate } from "../src/db.ts";
import { LiveHub } from "../src/live.ts";

export type App = ReturnType<typeof createApp>;
type Overrides = Omit<Partial<AppDeps>, "config"> & { config?: Partial<Config> };

/**
 * Every test gets a fresh, empty database in its own temporary file.
 * (An in-memory database loses its tables after a transaction with libSQL,
 * so a temporary file is the safe choice.) The pool has two connections to that file.
 */
export async function freshContext(overrides: Overrides = {}) {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const pool = await createDbPool(`file:${file}`, 2);
  await pool.use((db) => migrate(db));
  const config = testConfig({
    UPLOAD_DIR: await Deno.makeTempDir(),
    ...overrides.config,
  });
  const hub = overrides.hub ?? new LiveHub();
  const app = createApp({ log: null, ...overrides, pool, config, hub });
  return { app, pool, config, hub, file };
}

export async function freshApp(overrides: Overrides = {}): Promise<App> {
  return (await freshContext(overrides)).app;
}

/** Send JSON with an optional bearer token. */
export async function send(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  return await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const PASSWORD = "kadikoy-1907";

/** Register a user and log in; returns the token. */
export async function loginAs(
  app: App,
  email: string,
  password = PASSWORD,
): Promise<string> {
  await send(app, "POST", "/auth/register", { email, password });
  const res = await send(app, "POST", "/auth/login", { email, password });
  if (res.status !== 200) throw new Error(`loginAs: ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  return token;
}

export type TaskJson = {
  id: number;
  title: string;
  status: string;
  priority: string;
  completedAt: number | null;
  deletedAt: number | null;
};

/** Create a task for the user behind the token; returns the parsed task. */
export async function makeTask(
  app: App,
  token: string,
  body: Record<string, unknown>,
): Promise<TaskJson> {
  const res = await send(app, "POST", "/api/tasks", body, token);
  if (res.status !== 201) throw new Error(`makeTask: ${res.status} ${await res.text()}`);
  return await res.json();
}

/** Every new user gets one welcome task (Bonus 2), so lists start with total 1. */
export const WELCOME_TASKS = 1;
