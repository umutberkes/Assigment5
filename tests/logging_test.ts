// STUDENT NAME, STUDENT NUMBER
// Bonus 10: one JSON log line per request, and a request id everywhere.
import { assert, assertEquals, assertMatch } from "@std/assert";
import { freshApp, PASSWORD, send } from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test("every response has an x-request-id header, and error bodies carry the same id", async () => {
  const app = await freshApp();
  const ok = await app.request("/health");
  assertMatch(ok.headers.get("x-request-id") ?? "", UUID);

  for (const res of [await app.request("/nope"), await app.request("/api/tasks")]) {
    const id = res.headers.get("x-request-id");
    assertMatch(id ?? "", UUID);
    assertEquals((await res.json()).requestId, id);
  }
  // two requests never share an id
  const again = await app.request("/health");
  assert(again.headers.get("x-request-id") !== ok.headers.get("x-request-id"));
});

Deno.test("one JSON line per request, with method, path, status, ms and the user id", async () => {
  const lines: string[] = [];
  const app = await freshApp({ log: (l) => lines.push(l) });
  await send(app, "POST", "/auth/register", { email: "alice@example.com", password: PASSWORD });
  const login = await send(app, "POST", "/auth/login", {
    email: "alice@example.com",
    password: PASSWORD,
  });
  const { token } = await login.json();
  await send(app, "GET", "/api/tasks?page=1", undefined, token);

  assertEquals(lines.length, 3);
  const last = JSON.parse(lines[2]!);
  assertEquals([last.method, last.path, last.status, last.userId], ["GET", "/api/tasks", 200, 1]);
  assertEquals(typeof last.ms, "number");
  assertMatch(last.requestId, UUID);
});

Deno.test("no log line contains a password, a token, or a query string", async () => {
  const lines: string[] = [];
  const app = await freshApp({ log: (l) => lines.push(l) });
  await send(app, "POST", "/auth/register", { email: "alice@example.com", password: PASSWORD });
  const { token } = await (await send(app, "POST", "/auth/login", {
    email: "alice@example.com",
    password: PASSWORD,
  })).json();
  await send(app, "GET", "/api/tasks", undefined, token);
  await app.request(`/ws?token=${token}`); // the WebSocket token travels in the query

  const all = lines.join("\n");
  assertEquals(all.includes(PASSWORD), false);
  assertEquals(all.includes(token), false);
  assertEquals(all.includes("?"), false);
  assertEquals(lines.length, 4);
});
