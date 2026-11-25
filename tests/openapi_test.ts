// Umut Berke Şenyayla, 2000002240
// Bonus 8: /openapi.json and the docs page.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { freshApp } from "./helpers.ts";

Deno.test("/openapi.json lists every route with its error responses and the Bearer scheme", async () => {
  const app = await freshApp();
  const res = await app.request("/openapi.json");
  assertEquals(res.status, 200);
  const doc = await res.json();
  assertEquals(doc.openapi, "3.0.0");
  const routes = Object.entries(doc.paths as Record<string, Record<string, unknown>>)
    .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`))
    .sort();
  assertEquals(
    routes,
    [
      "DELETE /api/tasks/{id}",
      "GET /api/admin/users",
      "GET /api/me/summary",
      "GET /api/tasks",
      "GET /api/tasks/{id}",
      "GET /api/tasks/{id}/attachment",
      "GET /health",
      "GET /healthz",
      "GET /readyz",
      "GET /ws",
      "GET /docs",
      "GET /openapi.json",
      "POST /api/tasks",
      "POST /api/tasks/{id}/attachment",
      "POST /api/tasks/{id}/restore",
      "POST /auth/login",
      "POST /auth/register",
      "PUT /api/tasks/{id}",
    ].sort(),
  );
  assertEquals(doc.components.securitySchemes.Bearer, {
    type: "http",
    scheme: "bearer",
    bearerFormat: "opaque session token",
  });
  // every protected route asks for the token and documents 401; the id routes document 404
  for (
    const [path, ops] of Object.entries(doc.paths as Record<string, Record<string, Op>>)
  ) {
    for (const op of Object.values(ops)) {
      if (!path.startsWith("/api/")) continue;
      assertEquals(op.security, [{ Bearer: [] }], path);
      assert("401" in op.responses, path);
      if (path.includes("{id}")) assert("404" in op.responses, path);
    }
  }
});

type Op = { security?: unknown; responses: Record<string, unknown> };

Deno.test("/docs serves a Swagger UI page that loads /openapi.json", async () => {
  const app = await freshApp();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "swagger-ui");
  assertStringIncludes(html, 'url: "/openapi.json"');
});
