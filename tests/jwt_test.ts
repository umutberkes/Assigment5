// Umut Berke Şenyayla, 2000002240
// Bonus 7: JWT instead of sessions (AUTH_MODE=jwt).
import { assertEquals } from "@std/assert";
import { count } from "drizzle-orm";
import { signToken } from "../src/auth.ts";
import { sessions } from "../src/schema.ts";
import { freshContext, loginAs, send } from "./helpers.ts";

const SECRET = "test-secret-that-is-long-enough-1234567890";
const key = (s: string) => new TextEncoder().encode(s);

async function jwtApp() {
  return await freshContext({ config: { AUTH_MODE: "jwt", JWT_SECRET: SECRET } });
}

Deno.test("jwt mode: login returns a JWT, the routes work, and no session row is written", async () => {
  const { app, pool } = await jwtApp();
  const token = await loginAs(app, "alice@example.com");
  assertEquals(token.split(".").length, 3); // header.payload.signature
  const res = await send(app, "GET", "/api/tasks", undefined, token);
  assertEquals(res.status, 200);
  const [row] = await pool.use((db) => db.db.select({ n: count() }).from(sessions));
  assertEquals(row?.n, 0);
});

Deno.test("a tampered JWT is 401", async () => {
  const { app } = await jwtApp();
  const token = await loginAs(app, "alice@example.com");
  // change one character of the payload: the signature no longer matches
  const [h, p, s] = token.split(".");
  const flipped = p!.slice(0, -2) + (p!.at(-2) === "A" ? "B" : "A") + p!.at(-1);
  const res = await send(app, "GET", "/api/tasks", undefined, `${h}.${flipped}.${s}`);
  assertEquals(res.status, 401);
});

Deno.test("an expired JWT is 401", async () => {
  const { app } = await jwtApp();
  await loginAs(app, "alice@example.com");
  const expired = await signToken(key(SECRET), { userId: 1, role: "user" }, "-1s");
  const res = await send(app, "GET", "/api/tasks", undefined, expired);
  assertEquals(res.status, 401);
});

Deno.test("a JWT signed with another secret is 401", async () => {
  const { app } = await jwtApp();
  await loginAs(app, "alice@example.com");
  const forged = await signToken(key("some-other-secret-0000000000000000000"), {
    userId: 1,
    role: "admin",
  });
  const res = await send(app, "GET", "/api/admin/users", undefined, forged);
  assertEquals(res.status, 401);
});

Deno.test("a session token is not accepted in jwt mode, and the reverse", async () => {
  const jwt = await jwtApp();
  const session = await freshContext();
  const sessionToken = await loginAs(session.app, "alice@example.com");
  const jwtToken = await loginAs(jwt.app, "alice@example.com");
  assertEquals(
    (await send(jwt.app, "GET", "/api/tasks", undefined, sessionToken)).status,
    401,
  );
  assertEquals(
    (await send(session.app, "GET", "/api/tasks", undefined, jwtToken)).status,
    401,
  );
});
