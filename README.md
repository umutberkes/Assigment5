# Tasks API — Umut Berke Şenyayla, 2000002240

SEN0415 Advanced Web Programming, Assignment 5. Verified on 25 November 2026.

## Run and verify

Deno 2.9.7 is the version used locally, in CI and in Docker. No separate Node installation
is required for the API.

```sh
cp .env.example .env
deno task dev
# In another terminal:
deno task check
deno fmt --check
deno lint
deno task test
```

The API is at `http://localhost:8000`; interactive documentation is at `/docs`. The
startup applies the two committed Drizzle migrations. `.env` is local only and is not
included in the submission. The normal test command passes without `--no-check`: 80 tests.
See [test evidence](evidence/tests.txt).

Optional UI, in a second terminal:

```sh
deno task ui:install
deno task ui:dev
```

Open `http://localhost:5173` twice and log into the same account. Creating, updating or
deleting a task in one tab refreshes the other through a WebSocket. The UI sends the
existing priority when advancing a task, because PUT has the required default of `medium`
when priority is absent.

## Design and decisions (R2–R8)

| Table    | Contents and constraints                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| users    | id, unique lowercase email, bcrypt password hash, role, SQL-default created_at                                                                                                    |
| sessions | random token, user_id foreign key, expires_at; one-hour lifetime                                                                                                                  |
| tasks    | id, user_id foreign key, title, status, priority, SQL-default created_at and updated_at; notes, due_date, estimate_minutes, completed_at, deleted_at, attachment, attachment_type |

Task status is `todo`, `in-progress` or `done`; priority is `low`, `medium` or `high`. SQL
CHECK constraints enforce these values and title length 1–100 as well as the Zod input
checks. `schema.ts`, the generated migrations and the fallback SQL describe the same final
table. Timestamps are Unix seconds; SQL defaults are evaluated per inserted row.

- Authentication is middleware on every `/api/*` route. The default is a random
  database-backed session token; `AUTH_MODE=jwt` switches to signed JWTs.
- Registration saves a bcrypt hash and never returns it. Unknown email and wrong password
  use the same 401 message. A dummy bcrypt comparison avoids the obvious fast
  unknown-email path. Invalid bodies are 400. A duplicate email is 409, including
  concurrent duplicate requests.
- Public registration always assigns `user`. To grant admin privileges, the trusted
  operator runs `deno task admin existing@email.com`. This command requires direct access
  to the server configuration; an HTTP request cannot promote its caller. Log in again
  after promotion when using JWT.
- Every task query includes its owner. Another user's task returns 404, which does not
  disclose whether the id exists. Queries use Drizzle operators or bound parameters.
- POST and PUT require a nonempty title and default omitted status to `todo` and priority
  to `medium`, as specified in the assignment. Optional extra fields are retained on PUT
  when absent; `null` clears them.
- Lists default to page 1 and limit 20; limit is at most 100. Sorting is
  `created_at DESC, id DESC` for deterministic page boundaries. `total` uses the same
  ownership/status/deletion filters as the items.
- All failures use `{ error, issues?, requestId }`, including malformed JSON, validation,
  missing authentication, unknown routes and internal errors. Unexpected details are
  logged only on the server.
- Dependencies (pool, token service, cache, event hub and clock) can be replaced in tests.
  Test databases are isolated temporary files. Additional regression tests exercise
  failures not covered by the original suite.

## Routes

| Method and path                | Access        | Result                                                    |
| ------------------------------ | ------------- | --------------------------------------------------------- |
| GET /health                    | public        | 200 `{ok:true}`                                           |
| POST /auth/register            | public        | 201 user; 400 validation; 409 duplicate                   |
| POST /auth/login               | public        | 200 token; 400 validation; 401 credentials; 429 throttled |
| GET /api/tasks                 | authenticated | paginated items, page, limit, total                       |
| POST /api/tasks                | authenticated | 201 created task                                          |
| GET /api/tasks/:id             | owner         | 200 task or 404                                           |
| PUT /api/tasks/:id             | owner         | 200 updated task or 404                                   |
| DELETE /api/tasks/:id          | owner         | 200 `{ok:true}`; soft delete                              |
| POST /api/tasks/:id/restore    | owner         | restore a deleted task                                    |
| GET /api/me/summary            | authenticated | counts per status and total                               |
| GET /api/admin/users           | admin         | users and task counts; 401/403 otherwise                  |
| POST /api/tasks/:id/attachment | owner         | multipart PNG/JPEG upload                                 |
| GET /api/tasks/:id/attachment  | owner         | stored image bytes                                        |
| GET /healthz                   | public        | process liveness; no database connection required         |
| GET /readyz                    | public        | database readiness; 503 when unavailable                  |
| GET /ws?token=...              | token         | WebSocket upgrade; 401 invalid token, 426 missing upgrade |
| GET /openapi.json              | public        | route/schema document                                     |
| GET /docs                      | public        | Swagger UI                                                |

## Real curl examples (R8)

The following commands were executed against an isolated API on port 18767; the normal
development port is 8000. Tokens are redacted as `$TOKEN`, and local evidence file paths
are shortened. The downloaded PNG was compared byte-for-byte with the uploaded file. For
successful WebSocket traffic see Bonus 13.

### Health

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/health
{"ok":true}
HTTP 200
```

### Register

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/auth/register -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"evidence-password"}'
{"id":1,"email":"alice@example.com","role":"user","createdAt":1795609674}
HTTP 201
```

### Duplicate email

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/auth/register -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"evidence-password"}'
{"error":"email already registered","requestId":"78ce8e05-e8ab-44ca-94e0-89c2760cade2"}
HTTP 409
```

### Invalid registration

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/auth/register -H 'content-type: application/json' -d '{"email":"bad","password":"short"}'
{"error":"validation failed","issues":[{"path":["email"],"message":"Invalid email address"},{"path":["password"],"message":"Too small: expected string to have >=8 characters"}],"requestId":"c3be85a0-fa71-442a-8a46-fa4190fbe03a"}
HTTP 400
```

### Login

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/auth/login -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"evidence-password"}'
{"token":"$TOKEN"}
HTTP 200
```

### Wrong password

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/auth/login -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"wrong-password"}'
{"error":"wrong email or password","requestId":"564fa75c-4e2d-485a-91c2-bcf63ec7f7d4"}
HTTP 401
```

### Missing token

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/tasks
{"error":"unauthorized","requestId":"61795d9e-1666-412c-bf72-b90024f38aed"}
HTTP 401
```

### Create task

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/api/tasks -H 'content-type: application/json' -d '{"title":"Study migrations","priority":"high","estimateMinutes":45}' -H 'Authorization: Bearer $TOKEN'
{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"todo","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}
HTTP 201
```

### List with pagination

```sh
curl -sS -w '
HTTP %{http_code}
' 'http://127.0.0.1:18767/api/tasks?page=1&limit=2' -H 'Authorization: Bearer $TOKEN'
{"items":[{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"todo","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null},{"id":1,"userId":1,"title":"Welcome! Click Next to move me along.","notes":null,"estimateMinutes":null,"dueDate":null,"status":"todo","priority":"medium","createdAt":1795609674,"updatedAt":1795609674,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}],"page":1,"limit":2,"total":2}
HTTP 200
```

### Read task

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/tasks/2 -H 'Authorization: Bearer $TOKEN'
{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"todo","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}
HTTP 200
```

### Update with explicit priority

```sh
curl -sS -w '
HTTP %{http_code}
' -X PUT http://127.0.0.1:18767/api/tasks/2 -H 'content-type: application/json' -d '{"title":"Study migrations","status":"done","priority":"high"}' -H 'Authorization: Bearer $TOKEN'
{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"done","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":1795609674,"deletedAt":null,"attachment":null,"attachmentType":null}
HTTP 200
```

### Filter

```sh
curl -sS -w '
HTTP %{http_code}
' 'http://127.0.0.1:18767/api/tasks?status=done' -H 'Authorization: Bearer $TOKEN'
{"items":[{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"done","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":1795609674,"deletedAt":null,"attachment":null,"attachmentType":null}],"page":1,"limit":20,"total":1}
HTTP 200
```

### Invalid query

```sh
curl -sS -w '
HTTP %{http_code}
' 'http://127.0.0.1:18767/api/tasks?limit=101' -H 'Authorization: Bearer $TOKEN'
{"error":"validation failed","issues":[{"path":["limit"],"message":"Too big: expected number to be <=100"}],"requestId":"61fb7823-5029-4408-9510-a16bdaeaa5ff"}
HTTP 400
```

### Upload image

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/api/tasks/2/attachment -H 'Authorization: Bearer $TOKEN' -F 'file=@./evidence.png;type=image/png'
{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"done","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":1795609674,"deletedAt":null,"attachment":"49eb55e5-545c-49f6-9b27-533329cf9765.png","attachmentType":"image/png"}
HTTP 200
```

### Download image

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/tasks/2/attachment -H 'Authorization: Bearer $TOKEN' -o ./download.png

HTTP 200
```

### Delete task

```sh
curl -sS -w '
HTTP %{http_code}
' -X DELETE http://127.0.0.1:18767/api/tasks/2 -H 'Authorization: Bearer $TOKEN'
{"ok":true}
HTTP 200
```

### Deleted task

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/tasks/2 -H 'Authorization: Bearer $TOKEN'
{"error":"task not found","requestId":"ba381bf1-5b49-4582-995f-b94c4cf92cc6"}
HTTP 404
```

### Restore task

```sh
curl -sS -w '
HTTP %{http_code}
' -X POST http://127.0.0.1:18767/api/tasks/2/restore -H 'Authorization: Bearer $TOKEN'
{"id":2,"userId":1,"title":"Study migrations","notes":null,"estimateMinutes":45,"dueDate":null,"status":"done","priority":"high","createdAt":1795609674,"updatedAt":1795609674,"completedAt":1795609674,"deletedAt":null,"attachment":"49eb55e5-545c-49f6-9b27-533329cf9765.png","attachmentType":"image/png"}
HTTP 200
```

### Summary

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/me/summary -H 'Authorization: Bearer $TOKEN'
{"todo":1,"in-progress":0,"done":1,"total":2}
HTTP 200
```

### Normal user cannot access admin route

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/admin/users -H 'Authorization: Bearer $TOKEN'
{"error":"forbidden","requestId":"a4125fd8-c2b5-4255-b7bd-55362ac6fa80"}
HTTP 403
```

### Admin route after trusted operator promotion

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/api/admin/users -H 'Authorization: Bearer $TOKEN'
[{"id":1,"email":"alice@example.com","role":"admin","createdAt":1795609674,"tasks":2}]
HTTP 200
```

### Liveness

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/healthz
{"ok":true}
HTTP 200
```

### Readiness

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/readyz
{"ready":true}
HTTP 200
```

### WebSocket rejects invalid token

```sh
curl -sS -w '
HTTP %{http_code}
' 'http://127.0.0.1:18767/ws?token=invalid'
{"error":"unauthorized","requestId":"db0c1f90-05d7-481c-82ee-055418a95c25"}
HTTP 401
```

### Docs page

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/docs -o /dev/null

HTTP 200
```

### OpenAPI document

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/openapi.json -o ./openapi.json

HTTP 200
```

### Unknown route

```sh
curl -sS -w '
HTTP %{http_code}
' http://127.0.0.1:18767/not-found
{"error":"not found","requestId":"c741d202-c0a2-4eea-9e4c-5d4f0a1d69fc"}
HTTP 404
```

## Bonus status

Bonuses 1–18 are implemented, with code, tests and the evidence below. Bonus 6 uses option
B (the custom SQLite pool, worth 10+ rather than 5+). Bonus 19 is blocked by the hosting
provider and is **not claimed as complete**. Bonus 20 has a repository, but the required
multi-day history is still pending. The instructor determines credit; this document does
not claim a guaranteed score.

## Bonus 1: Migrations with Drizzle Kit

Commands actually used:

```sh
deno task db:generate
# Add nullable estimateMinutes to the Drizzle tasks schema.
deno task db:generate
deno task db:migrate
```

`drizzle/0000_open_spacker_dave.sql` creates the original tables, constraints and indexes.
The second generated file, `drizzle/0001_luxuriant_hydra.sql`, contains:

```sql
ALTER TABLE `tasks` ADD `estimate_minutes` integer;
```

It is nullable so existing rows remain valid. The API accepts a nonnegative integer
estimate (up to 100000 minutes) or null. `main.ts`, seed and admin setup use the generated
migration runner. `tests/migrations_test.ts` applies the first migration, inserts a user
and task, applies the second, verifies the original title and null estimate, and confirms
that running the migrations again leaves exactly two migration records.

## Bonus 2: Soft delete, restore and a transaction

Delete sets `deleted_at`; active lists, reads, updates, summaries and admin counts exclude
deleted rows. Restore only acts on a deleted row owned by the caller. Registration creates
both the user and a welcome task in one transaction. `tests/softdelete_test.ts`
deliberately fails the welcome-task insertion and verifies rollback of the user as well as
the task. It also covers delete/list/restore and ownership.

## Bonus 3: Joins and the N+1 problem

`GET /api/me/summary` uses one GROUP BY query. For the admin list, the naive version makes
one user query plus one count query per user: five users require six queries. LEFT JOIN +
GROUP BY needs one query and includes users with zero tasks. The naive per-user summary is
four queries (not N+1 in the number of users); its first query unnecessarily loads all the
user's rows. The grouped version returns at most three rows.

`deno task n+1` produced the following real SQL and counts:

```text
Task n+1 deno run -A scripts/n_plus_one.ts

users with task counts, naive (5 users):
  [1] select "id", "email", "role", "created_at" from "users" order by "users"."id"
  [2] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [1]
  [3] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [2]
  [4] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [3]
  [5] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [4]
  [6] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [5]
  => 6 queries, result: [{"id":1,"email":"user1@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":2,"email":"user2@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":3,"email":"user3@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":4,"email":"user4@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":5,"email":"user5@example.com","role":"user","createdAt":1795609675,"tasks":4}]

users with task counts, LEFT JOIN + GROUP BY:
  [1] select "users"."id", "users"."email", "users"."role", "users"."created_at", count("tasks"."id") from "users" left join "tasks" on ("tasks"."user_id" = "users"."id" and "tasks"."deleted_at" is null) group by "users"."id" order by "users"."id"
  => 1 queries, result: [{"id":1,"email":"user1@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":2,"email":"user2@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":3,"email":"user3@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":4,"email":"user4@example.com","role":"user","createdAt":1795609675,"tasks":4},{"id":5,"email":"user5@example.com","role":"user","createdAt":1795609675,"tasks":4}]

my summary, naive:
  [1] select "id", "user_id", "title", "notes", "estimate_minutes", "due_date", "status", "priority", "created_at", "updated_at", "completed_at", "deleted_at", "attachment", "attachment_type" from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [1]
  [2] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"todo"]
  [3] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"in-progress"]
  [4] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"done"]
  => 4 queries, result: {"todo":4,"in-progress":0,"done":0,"total":4}

my summary, GROUP BY:
  [1] select "status", count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null) group by "tasks"."status"  -- [1]
  => 1 queries, result: {"todo":4,"in-progress":0,"done":0,"total":4}
```

`tests/summary_test.ts` checks the result and query counts for different numbers of users.

## Bonus 4: Indexes and EXPLAIN

`deno task explain` measures the actual filtered list query, including
`created_at DESC, id DESC`, over identical data in three separate database copies.
Separating the files prevents native prepared statements retaining schema locks between
index changes. Each result is an average of 200 queries; timings vary by machine.

```text
Task explain deno run -A scripts/explain.ts
20000 tasks for 20 users; identical data in every scenario

1. no index: EXPLAIN QUERY PLAN
  SCAN tasks
  USE TEMP B-TREE FOR ORDER BY
1. no index: 0.858 ms per query (average of 200)

2. index on (user_id, status): EXPLAIN QUERY PLAN
  SEARCH tasks USING INDEX idx_two (user_id=? AND status=?)
  USE TEMP B-TREE FOR ORDER BY
2. index on (user_id, status): 0.362 ms per query (average of 200)

3. index on (user_id, status, created_at): EXPLAIN QUERY PLAN
  SEARCH tasks USING INDEX idx_tasks_user_status_created (user_id=? AND status=?)
3. index on (user_id, status, created_at): 0.217 ms per query (average of 200)

size on disk:
  idx_tasks_user_status_created: 430080 bytes
  tasks: 1032192 bytes
```

Without an index SQLite scans and sorts. The two-column index narrows the search but still
needs a temporary sort. The three-column index also supplies the order. It costs storage
(shown above) and extra work on writes. The schema and migrations include the final index;
a test checks that the plan uses it.

## Bonus 5: Seed data

`deno task seed` creates three demo users and 18 tasks. Running it twice preserves
existing data and creates no duplicates. Production mode explicitly refuses demo seeding.
Demo password: `demo-password-2026`; accounts: `alice@example.com`, `bob@example.com`,
`admin@example.com`. Use these only with local demo data.

```text
Run 1: deno task seed
seed: 3 users and 18 tasks created in file:/Users/umutberkesenyayla/Documents/Codex/2026-11-15/as/work/assignment5-build/seed-evidence.db
log in as alice@example.com, bob@example.com or admin@example.com
with the password demo-password-2026

Run 2: deno task seed
seed: 0 users and 0 tasks created in file:/Users/umutberkesenyayla/Documents/Codex/2026-11-15/as/work/assignment5-build/seed-evidence.db
log in as alice@example.com, bob@example.com or admin@example.com
with the password demo-password-2026
```

Tests verify idempotence and login as a seeded user.

## Bonus 6: A connection pool (Postgres or SQLite)

**Option B: a custom SQLite pool.** `Pool<T>` implements acquire, FIFO wait, release and
`use(fn)` with a finally block. Each local connection enables WAL, busy_timeout=5000 and
foreign keys. The default pool size is four: reads can overlap with the single SQLite
writer without keeping unnecessarily many handles. Memory and remote databases use one
client.

When all connections are busy, requests queue until a connection is released; after ten
seconds they receive 503 and Retry-After. `/healthz` does not enter this queue. SQLite is
an in-process library with serialized writes, so pooling has less benefit than reusing
network/server connections in Postgres.

Tests start 20 jobs on three items, verify no more than three are active, FIFO service,
timeout, release after exceptions, and concurrent real database writes. The timer uses
`ReturnType<typeof setTimeout>` to work with the actual runtime types.

## Bonus 7: JWT instead of sessions

Set `AUTH_MODE=jwt` and a strong `JWT_SECRET`. Tokens use HS256, a user-id subject, a role
claim and one-hour expiration. Authentication checks the signature and expiry without a
database identity lookup; session mode remains available for R3. Tests cover successful
use, tampering, wrong signing key, expiry and incompatible token modes.

| Property             | Sessions                     | JWT                                            |
| -------------------- | ---------------------------- | ---------------------------------------------- |
| Authentication check | database lookup              | signature verification                         |
| Multiple servers     | shared session database      | shared signing secret                          |
| Logout/revocation    | delete token row immediately | valid until expiry unless a deny-list is added |
| Role changes         | visible on next request      | need a new token                               |
| Stolen token         | usable until revoked/expired | usable until expiry without a deny-list        |

## Bonus 8: OpenAPI and a docs page

`OpenAPIHono` and the same Zod schemas drive validation and documentation. All HTTP
endpoints are listed, including health, readiness, WebSocket handshake and the
documentation endpoints. Upload has a multipart binary `file` field. Protected routes
declare Bearer security and error schemas.

At `/docs`, register/login, copy the returned token into Authorize, and try the protected
task operations. A WebSocket requires an actual WebSocket client rather than Swagger's
ordinary HTTP fetch. Tests check route coverage, security, errors and the upload schema.

## Bonus 9: Roles (RBAC)

`requireRole` protects `/api/admin/users`. No authentication is 401; a valid ordinary-user
identity is 403. Registration ignores an attempted `role: admin` and creates a user. A
trusted operator promotes an existing account with `deno task admin user@example.com`.
Tests cover 401, 403 and 200 in both session and JWT modes and verify no password hash is
exposed.

## Bonus 10: Logging and request ids

Every request receives `x-request-id`; the same id appears in its JSON log and error body.
Logs contain method, path, status, duration and authenticated user id, never passwords,
bodies or the WebSocket token query. Example from the actual cron verification server:

```json
{
  "time": "2026-11-25T12:26:16.675Z",
  "requestId": "376a29a4-0a20-4656-b2cc-60a93f70ee05",
  "method": "GET",
  "path": "/health",
  "status": 200,
  "ms": 9
}
```

`tests/logging_test.ts` checks the header, matching error id and structured log.

## Bonus 11: Health, readiness and configuration

`loadConfig` validates environment values once at startup. `/healthz` remains 200 even
when the database pool is occupied; `/readyz` checks SELECT 1 and returns 503 when
unavailable. Production refuses default/short signing secrets and missing tokens for
remote libSQL URLs. `.env.production.example` is a template, `.env.test` contains test
values only, and real `.env.production` is excluded from Git and ZIP.

```sh
cp .env.production.example .env.production
# Set a random JWT_SECRET and the server's database/upload locations.
deno task start:prod
```

An actual bad-configuration run:

```text
PORT=eighty AUTH_MODE=magic deno task start
Exit status: 1
Task start deno run -A --unstable-kv --unstable-cron src/main.ts
invalid configuration:
  PORT: Invalid input: expected number, received NaN
  AUTH_MODE: Invalid option: expected one of "session"|"jwt"
```

## Bonus 12: File upload

The owner can upload a PNG/JPEG of at most 1,000,000 bytes. Request-size limits, MIME
allowlist and signature-byte checks reject missing, oversized or unsupported files. UUID
filenames avoid path traversal. Only the owner can download the file, with its recorded
content type and `nosniff`. Replacement removes the previous attachment. Tests cover
upload/download byte equality, ownership and all required failures. The signature check is
not a full image decoder or antivirus scan.

## Bonus 13: WebSocket live updates

The server authenticates before upgrade, stores sockets by user, and sends
created/updated/deleted/restored events only to that user. Both UI tabs subscribe and
refresh their lists; Vite proxies `/ws` with WebSocket support. `scripts/verify_live.ts`
uses real HTTP and three real sockets (two Alice clients and one Bob client), rather than
test doubles:

```text
Task evidence:live deno run -A --unstable-kv scripts/verify_live.ts
Actual HTTP server + three actual WebSocket connections
Invalid token: HTTP 401 before upgrade
Alice connection 1: ["created","updated","deleted"]
Alice connection 2: ["created","updated","deleted"]
Bob connection: []
PASS: both same-user clients updated; another user received nothing.
```

The React UI was also verified in two real browser tabs on 25 November: create in tab A
appeared in tab B without reloading; clicking todo in tab A changed both tabs to
in-progress; deleting in A removed it from B. Screenshots before deletion:
[tab A](evidence/live-tab-a.jpg), [tab B](evidence/live-tab-b.jpg).

Run the socket script again with `deno task evidence:live`. The observable result is that
both Alice clients receive the three changes while Bob receives none. A bad token receives
401 before upgrade.

## Bonus 14: A background job with Deno.cron

`purgeOldDone` permanently removes tasks done for more than 30 days, removes attachments
and invalidates cached task responses. Normal scheduling is `0 3 * * *` (03:00 UTC). The
development-only `CRON_SCHEDULE="* * * * *"` was used to capture two actual scheduled
invocations; production refuses that demonstration schedule.

```text
Local isolated database; CRON_SCHEDULE="* * * * *".
Real Deno.cron invocations (not direct function calls):
{"time":"2026-11-25T12:27:00.010Z","job":"purge","removed":1}
{"time":"2026-11-25T12:28:00.006Z","job":"purge","removed":0}
GET previously cached task after purge: HTTP 404.
Production/default schedule remains 0 3 * * *.
```

Unit tests cover age/status boundaries, idempotence and attachment cleanup; the cache
regression test verifies 404 after purge.

## Bonus 15: Rate limit on login

`LoginLimiter` counts failed logins per lowercase email in a 60-second window. After five
failures, subsequent attempts receive 429 and Retry-After until the window expires; a
successful login clears the counter. A fake clock tests reset without sleeping.

It is process-local: restarts and multiple servers do not share counters, and distributing
attempts across many email addresses evades a per-email limit. A shared store plus an
IP-based policy would be needed for stronger protection.

## Bonus 16: A cache with Deno KV

Task responses are cached for 60 seconds under `["task", userId, id]`. Ownership is
therefore part of the key. Unknown tasks are not cached. Update, delete, restore, upload
and cron purge invalidate the entry. Revision markers and a KV atomic check prevent an
in-flight old database read from repopulating an entry after invalidation.

Tests cover hits, updates/deletes, another user's access, unknown ids, cron purge and
concurrent invalidation. A request already in progress may complete with the row it read
before a concurrent mutation, but cannot store that old row for subsequent requests.

## Bonus 17: Docker

The actual Docker build and persistence test ran on GitHub's Linux runner, not on an
uninstalled local Docker engine.
[Successful run](https://github.com/umutberkes/Assigment5/actions/runs/45613836958). The
full output is in [evidence/docker.txt](evidence/docker.txt).

```sh
sh scripts/docker_smoke.sh
```

The script builds the image, creates an isolated volume, starts the API, registers an
account, removes/recreates the container with the same volume and checks that duplicate
registration is 409. It cleans up only its own test container and volume. Observed output:

```text
Container user: 1993
POST /auth/register: HTTP 201
Same registration after replacing container, reusing volume: HTTP 409
GET /health: {"ok":true}
Image bytes: 102515159
Docker persistence check passed.
```

The image copies generated migrations and runs as the non-root `deno` user. `/data` holds
the database and uploads. Flags permit network listening, configuration reads, filesystem
access, native libSQL FFI and OS information; the KV/cron unstable flags enable those
APIs. `.dockerignore` excludes local secrets and test data.

## Bonus 18: Continuous integration

Every push/PR runs formatting, lint, type checking, tests and real WebSocket verification.
The Docker job builds and verifies persistence, uploading its output as an artifact.

- [Green run on main](https://github.com/umutberkes/Assigment5/actions/runs/45613836958).
- [Red run on ci-demonstration/red](https://github.com/umutberkes/Assigment5/actions/runs/45614241187).

The red branch deliberately adds `assertEquals(1 + 1, 3)` in a test to demonstrate that CI
rejects a failing test. It is not merged into main and is not included in the ZIP. Run
metadata is saved in [evidence/ci.json](evidence/ci.json).

## Bonus 19: Deploy

**Blocked externally; not claimed as complete.** On 25 November 2026, after GitHub
sign-in, Deno Deploy displayed **New signups are closed** and refused creation of a new
organization. No existing organization is available for this account, so no genuine public
deployment URL can be supplied. [Observed blocker](evidence/deploy-blocker.txt);
[official announcement](https://deno.com/blog/cloudflare).

The API supports a remote libSQL database with DATABASE_URL and DATABASE_AUTH_TOKEN, but
configuration support is not a completed deployment. Instructor guidance or an invitation
to an existing Deno organization is needed; using a different host would require
instructor acceptance for this particular bonus. Local uploaded files would also need
durable storage on an ephemeral host.

## Bonus 20: Git repository

Repository: https://github.com/umutberkes/Assigment5

`.gitignore` excludes secrets, databases, dependencies and uploads. CI checks a fresh
clone. The existing history contains more than five commits, but as of this verification
its work is still recorded on one calendar day (25 November). **The several-days condition
is not yet complete.** Further genuine review and changes on later days can satisfy it
before the 30 November deadline; timestamps have not been fabricated. Instructor access
must follow the CATS announcement.

## My own log (R8)

These are actual results reproduced during AI-assisted verification on 25 November 2026.
They are technical learning notes, not a claim that the original draft's personal
anecdotes occurred. Before submission I need to review these explanations and be able to
explain them in my own words.

1. **A timer type stopped the normal tests.** `deno task check` and `deno task test`
   reported `Type 'Timeout' is not assignable to type 'number'` in the pool. The callback
   handle was changed to `ReturnType<typeof setTimeout>`. Lesson: a passing runtime test
   with type checking disabled does not meet the type-check requirement.
2. **An initial lookup did not prevent duplicate-registration races.** Two simultaneous
   requests returned `[201, 500]`. Both could read “email absent” before either inserted
   it. Handling the database UNIQUE failure now gives `[201, 409]`. The database
   constraint, not the preliminary lookup, is the final protection.
3. **Deleting database data did not delete cached data.** A cached old done task still
   returned 200 after purge. Passing the cache to the purge function and invalidating its
   key changed the result to 404. Every write path must participate in invalidation,
   including scheduled jobs.
4. **Checking only the main API routes left documentation gaps.** The OpenAPI test passed
   while operational endpoints and the multipart file field were missing. Coverage now
   includes them, and the same upload schema is used for validation. A missing file now
   produces the standard `validation failed` body with 400.
5. **An index experiment retained native schema locks.** The first actual run reported
   `SQLITE_LOCKED: database table is locked` while dropping an index; a close/reopen
   attempt reported `SQLITE_BUSY: database is locked`. Each scenario now uses a separate
   copy of identical data and builds its index before querying. All three plans and
   timings are recorded rather than copied from the original README.
6. **PUT defaults and the UI must agree.** The assignment requires omitted status/priority
   defaults. PUT now applies them; the UI explicitly includes an existing priority when
   advancing a task. Preserving data in the UI should not silently change the documented
   API contract.
7. **A real scheduled run is different from calling a function in a unit test.** The
   actual cron log removed 1 old task on the first minute and 0 on the second. The normal
   daily schedule remains unchanged, and production disallows the temporary per-minute
   schedule.
8. **Passing fake-socket tests was not enough evidence of a working upgrade.** The added
   verification opens actual WebSocket connections over HTTP. Two clients of one user
   receive created/updated/deleted; another user's client receives nothing.
9. **Hosting readiness did not mean hosting availability.** Deno Deploy authentication
   reached “New signups are closed”. This is documented as an external blocker rather than
   inventing a URL or treating prepared code as a deployed service.
