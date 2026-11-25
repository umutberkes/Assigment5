// Umut Berke Şenyayla, 2000002240
import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { users } from "../src/schema.ts";
import { freshContext, loginAs, PASSWORD, send } from "./helpers.ts";

for (const mode of ["session", "jwt"] as const) {
  Deno.test(`RBAC (${mode}): no token 401, normal user 403, operator-promoted admin 200`, async () => {
    const { app, pool } = await freshContext({ config: { AUTH_MODE: mode } });
    assertEquals((await send(app, "GET", "/api/admin/users")).status, 401);
    const ordinary = await loginAs(app, "alice@example.com");
    assertEquals(
      (await send(app, "GET", "/api/admin/users", undefined, ordinary)).status,
      403,
    );
    const registration = await send(app, "POST", "/auth/register", {
      email: "admin@example.com",
      password: PASSWORD,
      role: "admin",
    });
    assertEquals((await registration.json()).role, "user");
    await pool.use(async (db) => {
      await db.db.update(users).set({ role: "admin" }).where(
        eq(users.email, "admin@example.com"),
      );
    });
    const login = await send(app, "POST", "/auth/login", {
      email: "admin@example.com",
      password: PASSWORD,
    });
    const { token } = await login.json();
    const response = await send(app, "GET", "/api/admin/users", undefined, token);
    assertEquals(response.status, 200);
    const list = await response.json();
    assertEquals(
      list.map((
        u: { email: string; role: string; tasks: number },
      ) => [u.email, u.role, u.tasks]),
      [["alice@example.com", "user", 1], ["admin@example.com", "admin", 1]],
    );
    assertEquals("passwordHash" in list[0], false);
  });
}
