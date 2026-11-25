// STUDENT NAME, STUDENT NUMBER
// Bonus 9: an admin role and an admin-only route.
import { assertEquals } from "@std/assert";
import { freshApp, loginAs, send } from "./helpers.ts";

const ADMIN = "hoca@example.com";

Deno.test("GET /api/admin/users: no token is 401", async () => {
  const app = await freshApp({ config: { ADMIN_EMAIL: ADMIN } });
  const res = await send(app, "GET", "/api/admin/users");
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "unauthorized");
});

Deno.test("GET /api/admin/users: a normal user is 403", async () => {
  const app = await freshApp({ config: { ADMIN_EMAIL: ADMIN } });
  const token = await loginAs(app, "alice@example.com");
  const res = await send(app, "GET", "/api/admin/users", undefined, token);
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "forbidden");
});

Deno.test("GET /api/admin/users: the admin gets every user with a task count", async () => {
  const app = await freshApp({ config: { ADMIN_EMAIL: ADMIN } });
  await loginAs(app, "alice@example.com");
  const admin = await loginAs(app, "Hoca@Example.com"); // emails are compared in lower case
  const res = await send(app, "GET", "/api/admin/users", undefined, admin);
  assertEquals(res.status, 200);
  const list = await res.json();
  assertEquals(
    list.map((u: { email: string; role: string; tasks: number }) => [u.email, u.role, u.tasks]),
    [["alice@example.com", "user", 1], [ADMIN, "admin", 1]],
  );
  assertEquals("passwordHash" in list[0], false);
});

Deno.test("works the same with JWT: the role comes from the claim", async () => {
  const app = await freshApp({
    config: {
      ADMIN_EMAIL: ADMIN,
      AUTH_MODE: "jwt",
      JWT_SECRET: "test-secret-that-is-long-enough-1234567890",
    },
  });
  const user = await loginAs(app, "alice@example.com");
  const admin = await loginAs(app, ADMIN);
  assertEquals((await send(app, "GET", "/api/admin/users", undefined, user)).status, 403);
  assertEquals((await send(app, "GET", "/api/admin/users", undefined, admin)).status, 200);
});
