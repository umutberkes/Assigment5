// STUDENT NAME, STUDENT NUMBER
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Config } from "./config.ts";
import type { Db, DbPool } from "./db.ts";
import { type Task, tasks, users } from "./schema.ts";
import {
  checkPassword,
  type Env,
  hashPassword,
  jwtTokens,
  requireAuth,
  requireRole,
  sessionTokens,
  type TokenService,
} from "./auth.ts";
import { errorBody, failWith, requestLog, toIssues } from "./http.ts";
import { PoolTimeoutError } from "./pool.ts";
import { LoginLimiter } from "./ratelimit.ts";
import type { TaskCache } from "./cache.ts";
import { type LiveEvent, LiveHub } from "./live.ts";
import { summaryGrouped, usersWithCounts } from "./summary.ts";
import {
  extensionOf,
  isAllowedType,
  MAX_UPLOAD_BYTES,
  sniffImage,
} from "./uploads.ts";
import * as S from "./schemas.ts";

export type AppDeps = {
  pool: DbPool;
  config: Config;
  /** session (R3) or JWT (Bonus 7); chosen from config.AUTH_MODE when not given */
  tokens?: TokenService;
  /** where to write one JSON line per request (Bonus 10); null turns logging off */
  log?: ((line: string) => void) | null;
  limiter?: LoginLimiter;
  cache?: TaskCache | null;
  hub?: LiveHub;
  /** the title of the task every new user gets (Bonus 2) */
  welcomeTitle?: string;
  upgradeWebSocket?: (req: Request) => { socket: WebSocket; response: Response };
};

const now = () => Math.floor(Date.now() / 1000);

/** Build the whole application around its dependencies, so tests can give it their own. */
export function createApp(deps: AppDeps) {
  const { pool, config } = deps;
  const tokens = deps.tokens ??
    (config.AUTH_MODE === "jwt" ? jwtTokens(config.JWT_SECRET) : sessionTokens());
  const limiter = deps.limiter ?? new LoginLimiter();
  const hub = deps.hub ?? new LiveHub();
  const cache = deps.cache ?? null;
  const welcomeTitle = deps.welcomeTitle ?? "Welcome! Click Next to move me along.";
  const log = deps.log === undefined
    ? (config.LOG_REQUESTS ? (line: string) => console.log(line) : null)
    : deps.log;

  const app = new OpenAPIHono<Env>({
    // R5: a failed Zod check anywhere (body, query, params) answers in the one shape
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody(c, "validation failed", toIssues(result.error)), 400);
      }
    },
  });

  // ---- middleware for every request ------------------------------------------------------
  app.use("*", requestLog(log)); // Bonus 10
  app.use("*", async (c, next) => { // Bonus 6: borrow one connection per request
    await pool.use(async (db) => {
      c.set("db", db);
      await next();
    });
  });

  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));
  const findOwn = async (db: Db, id: number, userId: number): Promise<Task | undefined> => {
    const [task] = await db.db.select().from(tasks).where(own(id, userId));
    return task;
  };
  const changed = async (userId: number, type: LiveEvent["type"], task: Task) => {
    await cache?.drop(userId, task.id);
    hub.publish(userId, { type, task });
  };
  const authed = { security: [{ Bearer: [] }] };
  const unauthorized = S.errorResponse("missing, unknown or expired token");
  const notFoundRes = S.errorResponse("no such task for this user");
  const badRequest = S.errorResponse("validation failed");

  // ---- health (given), Bonus 11 health and readiness -------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/health",
      tags: ["health"],
      responses: { 200: S.jsonResponse(S.Ok, "the API answers") },
    }),
    (c) => c.json({ ok: true as const }, 200),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    try {
      await c.get("db").db.run(sql`SELECT 1`);
      return c.json({ ready: true });
    } catch (err) {
      console.error(err);
      return c.json({ ...errorBody(c, "database not reachable"), ready: false }, 503);
    }
  });

  // ---- R3: register and login ---------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/auth/register",
      tags: ["auth"],
      request: { body: S.jsonBody(S.Credentials) },
      responses: {
        201: S.jsonResponse(S.PublicUser, "the new user, without the password hash"),
        400: badRequest,
        409: S.errorResponse("the email is already registered"),
      },
    }),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const db = c.get("db");
      const [taken] = await db.db.select({ id: users.id }).from(users)
        .where(eq(users.email, email));
      if (taken) return c.json(errorBody(c, "email already registered"), 409);

      const passwordHash = await hashPassword(password);
      const role = config.ADMIN_EMAIL === email ? "admin" as const : "user" as const;
      // Bonus 2: the user and the welcome task are saved together or not at all
      const user = await db.db.transaction(async (tx) => {
        const [created] = await tx.insert(users).values({ email, passwordHash, role })
          .returning({
            id: users.id,
            email: users.email,
            role: users.role,
            createdAt: users.createdAt,
          });
        if (!created) throw new Error("insert returned no row");
        await tx.insert(tasks).values({ userId: created.id, title: welcomeTitle });
        return created;
      });
      return c.json(user, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/auth/login",
      tags: ["auth"],
      request: { body: S.jsonBody(S.Credentials) },
      responses: {
        200: S.jsonResponse(S.Token, "a token for the Authorization header"),
        400: badRequest,
        401: S.errorResponse("wrong email or password"),
        429: S.errorResponse("too many failed logins for this email; see Retry-After"),
      },
    }),
    async (c) => {
      const { email, password } = c.req.valid("json");
      // Bonus 15: refuse before the (slow) password check
      const wait = limiter.retryAfter(email);
      if (wait > 0) {
        c.header("Retry-After", String(wait));
        return c.json(errorBody(c, "too many failed logins, try again later"), 429);
      }
      const db = c.get("db");
      const [user] = await db.db.select().from(users).where(eq(users.email, email));
      // the same answer for "no such email" and "wrong password"
      if (!user || !(await checkPassword(password, user.passwordHash))) {
        limiter.recordFailure(email);
        return c.json(errorBody(c, "wrong email or password"), 401);
      }
      limiter.reset(email);
      return c.json({ token: await tokens.issue(db, { userId: user.id, role: user.role }) }, 200);
    },
  );

  // ---- everything under /api needs a token ------------------------------------------------
  app.use("/api/*", requireAuth(tokens, failWith));

  // ---- R4, R6: the task routes ----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/tasks",
      tags: ["tasks"],
      ...authed,
      request: { query: S.ListQuery },
      responses: {
        200: S.jsonResponse(S.TaskPage, "one page of my tasks, newest first"),
        400: badRequest,
        401: unauthorized,
      },
    }),
    async (c) => {
      const { page, limit, status } = c.req.valid("query");
      const db = c.get("db");
      const where = and(
        eq(tasks.userId, c.get("userId")),
        isNull(tasks.deletedAt),
        status ? eq(tasks.status, status) : undefined,
      );
      const items = await db.db.select().from(tasks).where(where)
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(limit).offset((page - 1) * limit);
      const [row] = await db.db.select({ total: count() }).from(tasks).where(where);
      return c.json({ items, page, limit, total: row?.total ?? 0 }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/tasks",
      tags: ["tasks"],
      ...authed,
      request: { body: S.jsonBody(S.TaskBody) },
      responses: {
        201: S.jsonResponse(S.Task, "the new task"),
        400: badRequest,
        401: unauthorized,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const userId = c.get("userId");
      const [task] = await c.get("db").db.insert(tasks).values({
        ...body,
        userId,
        completedAt: body.status === "done" ? now() : null,
      }).returning();
      if (!task) throw new Error("insert returned no row");
      hub.publish(userId, { type: "created", task });
      return c.json(task, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/tasks/{id}",
      tags: ["tasks"],
      ...authed,
      request: { params: S.IdParams },
      responses: {
        200: S.jsonResponse(S.Task, "one task"),
        400: badRequest,
        401: unauthorized,
        404: notFoundRes,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const db = c.get("db");
      const load = () => findOwn(db, id, userId);
      const task = cache ? await cache.getOrLoad(userId, id, load) : await load();
      return task ? c.json(task, 200) : c.json(errorBody(c, "task not found"), 404);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/api/tasks/{id}",
      tags: ["tasks"],
      ...authed,
      request: { params: S.IdParams, body: S.jsonBody(S.TaskUpdate) },
      responses: {
        200: S.jsonResponse(S.Task, "the updated task"),
        400: badRequest,
        401: unauthorized,
        404: notFoundRes,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const userId = c.get("userId");
      const db = c.get("db");
      const old = await findOwn(db, id, userId);
      if (!old) return c.json(errorBody(c, "task not found"), 404);
      const status = body.status ?? old.status;
      // keep the first completion time while a task stays done (Bonus 14 uses it)
      const completedAt = status !== "done"
        ? null
        : old.status === "done"
        ? old.completedAt
        : now();
      const [task] = await db.db.update(tasks)
        .set({
          title: body.title,
          status,
          priority: body.priority ?? old.priority,
          notes: body.notes === undefined ? old.notes : body.notes,
          dueDate: body.dueDate === undefined ? old.dueDate : body.dueDate,
          completedAt,
          updatedAt: now(),
        })
        .where(own(id, userId)).returning();
      if (!task) return c.json(errorBody(c, "task not found"), 404);
      await changed(userId, "updated", task);
      return c.json(task, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/api/tasks/{id}",
      tags: ["tasks"],
      description: "Soft delete: the task is marked, and POST /restore brings it back.",
      ...authed,
      request: { params: S.IdParams },
      responses: {
        200: S.jsonResponse(S.Ok, "deleted"),
        400: badRequest,
        401: unauthorized,
        404: notFoundRes,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const [task] = await c.get("db").db.update(tasks)
        .set({ deletedAt: now() })
        .where(own(id, userId)).returning();
      if (!task) return c.json(errorBody(c, "task not found"), 404);
      await changed(userId, "deleted", task);
      return c.json({ ok: true as const }, 200);
    },
  );

  // ---- Bonus 2: restore ------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/restore",
      tags: ["tasks"],
      ...authed,
      request: { params: S.IdParams },
      responses: {
        200: S.jsonResponse(S.Task, "the restored task"),
        400: badRequest,
        401: unauthorized,
        404: S.errorResponse("no deleted task with this id for this user"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const [task] = await c.get("db").db.update(tasks)
        .set({ deletedAt: null })
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
        .returning();
      if (!task) return c.json(errorBody(c, "no deleted task with this id"), 404);
      await changed(userId, "restored", task);
      return c.json(task, 200);
    },
  );

  // ---- Bonus 12: attachments -----------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/tasks/{id}/attachment",
      tags: ["attachments"],
      description: "multipart/form-data with one field `file`: a PNG or JPEG of at most 1 MB.",
      ...authed,
      middleware: [bodyLimit({
        maxSize: MAX_UPLOAD_BYTES + 64 * 1024, // the file plus the multipart framing
        onError: (c) => c.json(errorBody(c, "file too large (max 1 MB)"), 413),
      })] as const,
      request: { params: S.IdParams },
      responses: {
        200: S.jsonResponse(S.Task, "the task with its attachment"),
        400: S.errorResponse("no file in the form"),
        401: unauthorized,
        404: notFoundRes,
        413: S.errorResponse("larger than 1 MB"),
        415: S.errorResponse("not a PNG or JPEG"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const db = c.get("db");
      const old = await findOwn(db, id, userId);
      if (!old) return c.json(errorBody(c, "task not found"), 404);

      const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
      const f = form["file"];
      if (!(f instanceof File)) return c.json(errorBody(c, "file required"), 400);
      if (f.size > MAX_UPLOAD_BYTES) {
        return c.json(errorBody(c, "file too large (max 1 MB)"), 413);
      }
      if (!isAllowedType(f.type)) {
        return c.json(errorBody(c, "type not allowed (PNG or JPEG only)"), 415);
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (sniffImage(bytes) !== f.type) {
        return c.json(errorBody(c, "the file content is not a real " + f.type), 415);
      }

      // a generated name, never the user's file name
      const name = `${crypto.randomUUID()}.${extensionOf(f.type)}`;
      await Deno.mkdir(config.UPLOAD_DIR, { recursive: true });
      await Deno.writeFile(`${config.UPLOAD_DIR}/${name}`, bytes);
      const [task] = await db.db.update(tasks)
        .set({ attachment: name, attachmentType: f.type, updatedAt: now() })
        .where(own(id, userId)).returning();
      if (old.attachment) {
        await Deno.remove(`${config.UPLOAD_DIR}/${old.attachment}`).catch(() => {});
      }
      if (!task) return c.json(errorBody(c, "task not found"), 404);
      await changed(userId, "updated", task);
      return c.json(task, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/api/tasks/{id}/attachment",
      tags: ["attachments"],
      ...authed,
      request: { params: S.IdParams },
      responses: {
        200: {
          description: "the image bytes",
          content: {
            "image/png": { schema: S.Binary },
            "image/jpeg": { schema: S.Binary },
          },
        },
        400: badRequest,
        401: unauthorized,
        404: S.errorResponse("no such task, or it has no attachment"),
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const task = await findOwn(c.get("db"), id, c.get("userId"));
      if (!task?.attachment || !task.attachmentType) {
        return c.json(errorBody(c, task ? "this task has no attachment" : "task not found"), 404);
      }
      const bytes = await Deno.readFile(`${config.UPLOAD_DIR}/${task.attachment}`);
      return c.body(bytes, 200, {
        "content-type": task.attachmentType,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=60",
      });
    },
  );

  // ---- Bonus 3: my summary -------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/me/summary",
      tags: ["tasks"],
      ...authed,
      responses: {
        200: S.jsonResponse(S.Summary, "how many of my tasks are in each status"),
        401: unauthorized,
      },
    }),
    async (c) => c.json(await summaryGrouped(c.get("db"), c.get("userId")), 200),
  );

  // ---- Bonus 9: admin only ---------------------------------------------------------------------
  app.use("/api/admin/*", requireRole(failWith, "admin"));
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/admin/users",
      tags: ["admin"],
      ...authed,
      responses: {
        200: S.jsonResponse(S.AdminUser.array(), "every user with the number of tasks"),
        401: unauthorized,
        403: S.errorResponse("logged in, but not an admin"),
      },
    }),
    async (c) => c.json(await usersWithCounts(c.get("db")), 200),
  );

  // ---- Bonus 13: live updates over a WebSocket -------------------------------------------------
  app.get("/ws", async (c) => {
    // a browser cannot set headers on a WebSocket, so the token comes in the query string;
    // check it BEFORE the upgrade
    const who = await tokens.verify(c.get("db"), c.req.query("token") ?? "");
    if (!who) return c.json(errorBody(c, "unauthorized"), 401);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json(errorBody(c, "expected a WebSocket upgrade"), 426);
    }
    const upgrade = deps.upgradeWebSocket ?? ((req: Request) => Deno.upgradeWebSocket(req));
    const { socket, response } = upgrade(c.req.raw);
    socket.onopen = () => hub.add(who.userId, socket);
    socket.onclose = () => hub.remove(who.userId, socket);
    return response;
  });

  // ---- Bonus 8: the OpenAPI document and a docs page ---------------------------------------
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: tokens.kind === "jwt" ? "JWT" : "opaque session token",
  });
  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Tasks API",
      version: "1.0.0",
      description: "SEN0415 Assignment 5. Log in with POST /auth/login, then press " +
        "Authorize and paste the token.",
    },
  });
  app.get("/docs", (c) => c.html(DOCS_PAGE));

  // ---- R5: one error shape for everything else -------------------------------------------------
  app.notFound((c) => c.json(errorBody(c, "not found"), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json(errorBody(c, err.message), err.status);
    if (err instanceof PoolTimeoutError) {
      c.header("Retry-After", "1");
      return c.json(errorBody(c, "database busy, try again"), 503);
    }
    console.error(err); // details go to the log, not to the client
    return c.json(errorBody(c, "internal error"), 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;

const DOCS_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tasks API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/openapi.json", dom_id: "#ui", persistAuthorization: true });
  </script>
</body>
</html>`;
