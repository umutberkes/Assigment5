// STUDENT NAME, STUDENT NUMBER
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import { PRIORITIES, STATUSES, tasks, users } from "./schema.ts";
import {
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
} from "./auth.ts";

const Credentials = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
});

const TaskBody = z.object({
  title: z.string().trim().min(1).max(100),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  notes: z.string().max(2000).nullable().default(null),
  dueDate: z.iso.date().nullable().default(null),
});

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
});

const IdParam = z.coerce.number().int().positive();

/** The one error shape: { error, issues? }. */
type Issue = { path: PropertyKey[]; message: string };
const fail = (error: string, issues?: Issue[]) => (issues ? { error, issues } : { error });
const toIssues = (e: z.ZodError): Issue[] =>
  e.issues.map((i) => ({ path: i.path, message: i.message }));

/** Read a JSON body; a missing or broken body becomes {} so that Zod reports what is missing. */
async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return await c.req.json().catch(() => ({}));
}

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(db: Db) {
  const app = new Hono<Env>();
  const own = (id: number, userId: number) => and(eq(tasks.id, id), eq(tasks.userId, userId));

  // Worked example: a health check.
  app.get("/health", (c) => c.json({ ok: true }));

  // ---- R3: register and login -------------------------------------------------------
  app.post("/auth/register", async (c) => {
    const parsed = Credentials.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json(fail("validation failed", toIssues(parsed.error)), 400);
    const { email, password } = parsed.data;

    const [taken] = await db.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) return c.json(fail("email already registered"), 409);

    const [user] = await db.db.insert(users)
      .values({ email, passwordHash: await hashPassword(password) })
      .returning({ id: users.id, email: users.email, createdAt: users.createdAt });
    return c.json(user, 201);
  });

  app.post("/auth/login", async (c) => {
    const parsed = Credentials.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json(fail("validation failed", toIssues(parsed.error)), 400);
    const { email, password } = parsed.data;

    const [user] = await db.db.select().from(users).where(eq(users.email, email));
    // the same answer for "no such email" and "wrong password"
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      return c.json(fail("wrong email or password"), 401);
    }
    return c.json({ token: await createSession(db, user.id) });
  });

  // ---- R4, R5, R6: tasks of the logged-in user --------------------------------------
  app.use("/api/*", requireAuth(db));

  app.get("/api/tasks", async (c) => {
    const parsed = ListQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json(fail("validation failed", toIssues(parsed.error)), 400);
    const { page, limit, status } = parsed.data;
    const where = and(
      eq(tasks.userId, c.get("userId")),
      status ? eq(tasks.status, status) : undefined,
    );
    const items = await db.db.select().from(tasks).where(where)
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit).offset((page - 1) * limit);
    const [row] = await db.db.select({ total: count() }).from(tasks).where(where);
    return c.json({ items, page, limit, total: row?.total ?? 0 });
  });

  app.post("/api/tasks", async (c) => {
    const parsed = TaskBody.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json(fail("validation failed", toIssues(parsed.error)), 400);
    const body = parsed.data;
    const [task] = await db.db.insert(tasks).values({
      ...body,
      userId: c.get("userId"),
      completedAt: body.status === "done" ? Math.floor(Date.now() / 1000) : null,
    }).returning();
    return c.json(task, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = IdParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json(fail("validation failed", toIssues(id.error)), 400);
    const [task] = await db.db.select().from(tasks).where(own(id.data, c.get("userId")));
    return task ? c.json(task) : c.json(fail("task not found"), 404);
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = IdParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json(fail("validation failed", toIssues(id.error)), 400);
    const parsed = TaskBody.safeParse(await jsonBody(c));
    if (!parsed.success) return c.json(fail("validation failed", toIssues(parsed.error)), 400);
    const body = parsed.data;
    const now = Math.floor(Date.now() / 1000);

    const [old] = await db.db.select({ status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks).where(own(id.data, c.get("userId")));
    if (!old) return c.json(fail("task not found"), 404);
    // keep the first completion time while a task stays done
    const completedAt = body.status !== "done" ? null : old.status === "done" ? old.completedAt : now;

    const [task] = await db.db.update(tasks).set({ ...body, completedAt, updatedAt: now })
      .where(own(id.data, c.get("userId"))).returning();
    return task ? c.json(task) : c.json(fail("task not found"), 404);
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = IdParam.safeParse(c.req.param("id"));
    if (!id.success) return c.json(fail("validation failed", toIssues(id.error)), 400);
    const deleted = await db.db.delete(tasks).where(own(id.data, c.get("userId")))
      .returning({ id: tasks.id });
    return deleted.length ? c.json({ ok: true }) : c.json(fail("task not found"), 404);
  });

  // ---- R5: one error shape for everything else ----------------------------------------
  app.notFound((c) => c.json(fail("not found"), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json(fail(err.message), err.status);
    console.error(err); // details go to the log, not to the client
    return c.json(fail("internal error"), 500);
  });
  return app;
}
