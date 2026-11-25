// STUDENT NAME, STUDENT NUMBER
import { assert, assertEquals, assertExists } from "@std/assert";
import { freshApp, send } from "./helpers.ts";

const alice = { email: "alice@example.com", password: "kadikoy-1907" };

Deno.test("register answers 201 with id and email, never the hash", async () => {
  const app = await freshApp();
  const res = await send(app, "POST", "/auth/register", alice);
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.email, alice.email);
  assertEquals(body.role, "user");
  assertExists(body.id);
  assertEquals(body.passwordHash, undefined);
  assertEquals(body.password, undefined);
});

Deno.test("register lowercases the email, so a second sign-up with capitals is 409", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", alice);
  const res = await send(app, "POST", "/auth/register", {
    ...alice,
    email: "Alice@Example.com",
  });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "email already registered");
});

Deno.test("register with a bad body is 400 with the error shape", async () => {
  const app = await freshApp();
  const res = await send(app, "POST", "/auth/register", { email: "nope", password: "short" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  const paths = body.issues.map((i: { path: string[] }) => i.path[0]).sort();
  assertEquals(paths, ["email", "password"]);
});

Deno.test("broken JSON is 400 in the same shape", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"email": "alice@example.com",',
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Malformed JSON in request body");
});

Deno.test("register with no body at all is 400, not a crash", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", { method: "POST" });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "validation failed");
});

Deno.test("login with the right password returns a token", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", alice);
  const res = await send(app, "POST", "/auth/login", alice);
  assertEquals(res.status, 200);
  const { token } = await res.json();
  assert(typeof token === "string" && token.length >= 32);
});

Deno.test("login with a wrong password and with an unknown email give the same 401", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", alice);
  const wrongPassword = await send(app, "POST", "/auth/login", {
    ...alice,
    password: "wrong-password",
  });
  const unknownEmail = await send(app, "POST", "/auth/login", {
    email: "nobody@example.com",
    password: "kadikoy-1907",
  });
  assertEquals(wrongPassword.status, 401);
  assertEquals(unknownEmail.status, 401);
  const a = await wrongPassword.json();
  const b = await unknownEmail.json();
  assertEquals(a.error, "wrong email or password");
  assertEquals(a.error, b.error);
});

Deno.test("a missing, malformed or unknown token is 401 with the error shape", async () => {
  const app = await freshApp();
  for (const auth of [undefined, "Token abc", "Bearer", "Bearer not-a-real-token"]) {
    const res = await app.request("/api/tasks", {
      headers: auth ? { authorization: auth } : {},
    });
    assertEquals(res.status, 401, `authorization: ${auth}`);
    assertEquals((await res.json()).error, "unauthorized");
  }
});

Deno.test("an unknown email takes about as long as a wrong password (no timing leak)", async () => {
  const app = await freshApp();
  await send(app, "POST", "/auth/register", alice);
  await send(app, "POST", "/auth/login", { email: "warm@example.com", password: "x".repeat(8) });
  const time = async (email: string) => {
    const start = performance.now();
    await send(app, "POST", "/auth/login", { email, password: "wrong-password" });
    return performance.now() - start;
  };
  const known = await time(alice.email);
  const unknown = await time("nobody@example.com");
  // both run one bcrypt compare (tens of ms); without the dummy hash, unknown took ~2 ms
  assert(unknown > known / 3, `known ${known.toFixed(1)} ms, unknown ${unknown.toFixed(1)} ms`);
});
