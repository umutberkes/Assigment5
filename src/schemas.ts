// Umut Berke Şenyayla, 2000002240
// R5 and Bonus 8: every Zod schema in one place. The same schemas validate the requests and
// describe the API in /openapi.json, so the docs cannot drift away from the code.
import { z } from "@hono/zod-openapi";
import { PRIORITIES, ROLES, STATUSES } from "./schema.ts";

export const Credentials = z.object({
  email: z.email().transform((e) => e.toLowerCase())
    .openapi({ example: "alice@example.com" }),
  password: z.string().min(8).max(200).openapi({ example: "kadikoy-1907" }),
}).openapi("Credentials");

export const TaskBody = z.object({
  title: z.string().trim().min(1).max(100).openapi({ example: "Buy a ferry card" }),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  notes: z.string().max(2000).nullable().default(null),
  estimateMinutes: z.number().int().min(0).max(100000).nullable().default(null),
  dueDate: z.iso.date().nullable().default(null).openapi({ example: "2026-12-01" }),
}).openapi("TaskBody");

/**
 * PUT uses the required status/priority defaults, just like POST. Extra optional
 * fields retain their previous values when absent; null explicitly clears them.
 */
export const TaskUpdate = z.object({
  title: TaskBody.shape.title,
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  notes: z.string().max(2000).nullable().optional(),
  estimateMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
}).openapi("TaskUpdate");

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
});

export const IdParams = z.object({
  id: z.coerce.number().int().positive().openapi({
    param: { name: "id", in: "path" },
    example: 1,
  }),
});

export const Task = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  title: z.string(),
  notes: z.string().nullable(),
  estimateMinutes: z.number().int().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  createdAt: z.number().int().openapi({ description: "Unix seconds" }),
  updatedAt: z.number().int(),
  completedAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
  attachment: z.string().nullable(),
  attachmentType: z.string().nullable(),
}).openapi("Task");

export const TaskPage = z.object({
  items: z.array(Task),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
}).openapi("TaskPage");

export const PublicUser = z.object({
  id: z.number().int(),
  email: z.string(),
  role: z.enum(ROLES),
  createdAt: z.number().int(),
}).openapi("User");

export const AdminUser = PublicUser.extend({ tasks: z.number().int() }).openapi(
  "AdminUser",
);

export const Token = z.object({ token: z.string() }).openapi("Token");
export const Ok = z.object({ ok: z.literal(true) }).openapi("Ok");

export const Summary = z.object({
  "todo": z.number().int(),
  "in-progress": z.number().int(),
  "done": z.number().int(),
  total: z.number().int(),
}).openapi("Summary");

export const ErrorBody = z.object({
  error: z.string().openapi({ example: "validation failed" }),
  issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })).optional(),
  requestId: z.string().optional(),
}).openapi("Error");

/** A response that carries the error shape, for createRoute's `responses`. */
export const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorBody } },
});

export const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

export const Binary = z.string().openapi({ type: "string", format: "binary" });

export const UploadBody = z.object({
  file: z.instanceof(File).openapi({ type: "string", format: "binary" }),
});

export const Ready = z.object({ ready: z.boolean() });
export const WebSocketQuery = z.object({ token: z.string().optional() });
