// STUDENT NAME, STUDENT NUMBER
// Bonus 11: health, readiness and configuration.
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { ConfigError, loadConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { createDbPool } from "../src/db.ts";
import { testConfig } from "../src/config.ts";
import { freshApp } from "./helpers.ts";

Deno.test("GET /healthz is 200 and GET /readyz is 200 when the database answers", async () => {
  const app = await freshApp();
  assertEquals((await app.request("/healthz")).status, 200);
  const ready = await app.request("/readyz");
  assertEquals([ready.status, await ready.json()], [200, { ready: true }]);
});

Deno.test("GET /readyz is 503 when the database does not answer", async () => {
  const pool = await createDbPool(`file:${await Deno.makeTempFile({ suffix: ".db" })}`, 1);
  for (const db of pool.items()) db.client.close(); // the database "goes away"
  const app = createApp({ pool, config: testConfig(), log: null });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await app.request("/readyz");
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals([body.ready, body.error], [false, "database not reachable"]);
  } finally {
    console.error = original;
  }
  // the process itself is still alive
  assertEquals((await app.request("/healthz")).status, 200);
});

Deno.test("config: defaults for development", () => {
  const c = loadConfig({});
  assertEquals([c.APP_ENV, c.PORT, c.DATABASE_URL, c.AUTH_MODE], [
    "development",
    8000,
    "file:./tasks.db",
    "session",
  ]);
});

Deno.test("config: a bad value stops start-up with a clear message", () => {
  const err = assertThrows(
    () => loadConfig({ PORT: "eighty", DATABASE_URL: "postgres://x", AUTH_MODE: "magic" }),
    ConfigError,
  ) as ConfigError;
  assertStringIncludes(err.message, "PORT");
  assertStringIncludes(err.message, "DATABASE_URL");
  assertStringIncludes(err.message, "AUTH_MODE");
});

Deno.test("config: production refuses the default or a short secret", () => {
  for (const secret of [undefined, "dev-secret", "change-me", "short"]) {
    const err = assertThrows(
      () => loadConfig({ APP_ENV: "production", JWT_SECRET: secret }),
      ConfigError,
    ) as ConfigError;
    assertStringIncludes(err.message, "JWT_SECRET");
  }
  const ok = loadConfig({ APP_ENV: "production", JWT_SECRET: "x".repeat(40) });
  assertEquals(ok.APP_ENV, "production");
});
