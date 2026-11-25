# Tasks API: STUDENT NAME, STUDENT NUMBER

SEN0415 Advanced Web Programming, Fall 2026, Assignment 5.
A Tasks API on Deno 2 with Hono, Drizzle and SQLite: users register and log in, every user
sees only their own tasks, every input is checked with Zod, every failure has one shape, and
the tests prove it.

## Run it

    cp .env.example .env
    deno task dev        # API on http://localhost:8000, docs on http://localhost:8000/docs
    deno task test       # all tests
    deno task check      # type-check
    deno fmt --check && deno lint

Other tasks: `deno task seed` (demo data, Bonus 5), `deno task explain` (Bonus 4),
`deno task n+1` (Bonus 3), `deno task live` (Bonus 13 client), `deno task curl` (prints the curl
section below from a running API), `deno task start:prod` (with `.env.production`).

## Try it in a browser (given, not graded)

`ui/` is a small React page that calls the API (log in, add, advance and delete tasks).
Start the API first, then in a second terminal:

    deno task ui:install   # once
    deno task ui:dev       # UI on http://localhost:5173

## Design decisions (R8)

### Tables

| table | columns | notes |
| --- | --- | --- |
| `users` | `id`, `email` (unique), `password_hash`, `role`, `created_at` | `role` is `user` or `admin` (Bonus 9). Emails are stored in lower case. |
| `sessions` | `token`, `user_id`, `expires_at` | given; one row per login, valid for one hour |
| `tasks` | `id`, `user_id` → `users.id`, `title`, `notes`, `due_date`, `status`, `priority`, `created_at`, `updated_at`, `completed_at`, `deleted_at`, `attachment`, `attachment_type` | see below |

My own fields beyond the required ones: `notes` (free text, up to 2000 characters), `due_date`
(an ISO date such as `2026-12-01`, checked by Zod so `2026-02-30` is refused), `updated_at`, and
`completed_at`, which is set when a task becomes `done` and cleared when it leaves `done`. A task
that stays done keeps its first completion time, so the purge job (Bonus 14) can tell how long
ago it was finished. `deleted_at` is for soft delete (Bonus 2), `attachment` and
`attachment_type` for the image upload (Bonus 12).

All times are Unix seconds with a **SQL default** (`strftime('%s','now')`), like the given
users table. A JavaScript default would run once at start-up and give every row the same time.

The database checks the rules too, not only Zod: `CHECK` constraints keep `status` and
`priority` inside their lists and the title between 1 and 100 characters. I added them because
a script or a later route could write to the table without going through Zod. The same
constraints are in `schema.ts` (Drizzle's `check()`) and in the SQL in `migrate()`.

One index, `idx_tasks_user_status_created (user_id, status, created_at)`, serves the list query:
owner and status for the filter, `created_at` for the newest-first order (Bonus 4 shows why the
third column matters).

### Routes

| method and path | token | success | failures |
| --- | --- | --- | --- |
| `GET /health` | no | 200 `{ ok: true }` | |
| `POST /auth/register` | no | 201 `{ id, email, role, createdAt }` | 400, 409 |
| `POST /auth/login` | no | 200 `{ token }` | 400, 401, 429 |
| `GET /api/tasks?page&limit&status` | yes | 200 `{ items, page, limit, total }` | 400, 401 |
| `POST /api/tasks` | yes | 201 the new task | 400, 401 |
| `GET /api/tasks/:id` | yes | 200 one task | 400, 401, 404 |
| `PUT /api/tasks/:id` | yes | 200 the updated task | 400, 401, 404 |
| `DELETE /api/tasks/:id` | yes | 200 `{ ok: true }` | 400, 401, 404 |
| `POST /api/tasks/:id/restore` | yes | 200 the task | 401, 404 (Bonus 2) |
| `POST`, `GET /api/tasks/:id/attachment` | yes | 200 | 400, 401, 404, 413, 415 (Bonus 12) |
| `GET /api/me/summary` | yes | 200 counts per status | 401 (Bonus 3) |
| `GET /api/admin/users` | admin | 200 users with task counts | 401, 403 (Bonus 9) |
| `GET /healthz`, `GET /readyz` | no | 200 | 503 (Bonus 11) |
| `GET /ws?token=` | in the query | WebSocket | 401, 426 (Bonus 13) |
| `GET /openapi.json`, `GET /docs` | no | 200 | (Bonus 8) |

### Decisions, and why

- **404, not 403, for another user's task.** Every task query has `user_id = me` in its `WHERE`
  (`own(id, userId)` in `app.ts`). A row that belongs to someone else is simply not found, so the
  answer is the same as for an id that does not exist. A 403 would tell the caller "this id
  exists, it is just not yours", which leaks how many tasks other people have.
- **The same 401 message, and the same time, for a wrong email and a wrong password.** In my
  first version an unknown email answered in about 2 ms and a wrong password in about 100 ms,
  because only the second one ran bcrypt (see the log). Now an unknown email is compared against
  a dummy bcrypt hash, and a test checks that the two take about as long. (Register still answers
  409 for a taken email: that is unavoidable for sign-up, and the rate limit of Bonus 15 slows
  down guessing on login.)
- **PUT keeps the fields it was not given.** The body of `PUT` has the same fields as `POST`, and
  `title` is required, but a missing `status`, `priority`, `notes` or `dueDate` keeps its current
  value instead of falling back to the default. The given UI sends only `title` and `status` when
  it advances a task; with plain defaults every advance reset the priority to `medium`. To clear
  `notes` or `dueDate` you send `null` on purpose.
- **One error shape:** `{ "error": "...", "issues"?: [...], "requestId": "..." }`. Validation
  errors come from one `defaultHook` (body, query and path parameters all go through Zod), and
  `notFound`, `onError`, the auth middleware and every route build the body with the same
  `errorBody()` function. Broken JSON is a 400 (`Malformed JSON in request body`), a database that
  is busy is a 503, and anything unexpected is a 500 with `internal error` while the real error
  goes to the server log only.
- **No string-built SQL.** Every query uses Drizzle's operators (`eq`, `and`, `isNull`...) or a
  `sql` template, where values become `?` parameters. The two raw statements in `auth.ts` (given)
  use `?` placeholders too.
- **Lists are newest first** (`created_at DESC, id DESC`); the id breaks ties inside one second, so
  a task never appears on two pages.
- **Dependencies are passed in.** `createApp({ pool, config, tokens, cache, hub, ... })` takes
  everything it needs, so a test can give it a temporary database, a fake clock for the rate
  limit, an in-memory KV, or fake WebSockets.

## API with curl (R8)

Made with `scripts/curl_examples.sh` (`deno task curl`) against a running API that started with
an empty database. The token is shown as `$TOKEN` (and `$TOKEN_B` for a second user); in `-i`
output the `date`, `connection` and `content-length` headers are left out.

**GET /health**

```sh
$ curl -s localhost:8000/health
{"ok":true}
```

**POST /auth/register (201)**

```sh
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"kadikoy-1907"}'
{"id":1,"email":"alice@example.com","role":"user","createdAt":1795606343}
```

**POST /auth/register again (409)**

```sh
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"kadikoy-1907"}'
{"error":"email already registered","requestId":"2c5c115a-8bdb-4092-92cf-649b9b1cdb80"}
```

**POST /auth/register with a bad body (400)**

```sh
$ curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' -d '{"email":"not-an-email","password":"short"}'
{"error":"validation failed","issues":[{"path":["email"],"message":"Invalid email address"},{"path":["password"],"message":"Too small: expected string to have >=8 characters"}],"requestId":"e502337b-676b-4c2f-935d-5a0a6cebc774"}
```

**POST /auth/login with a wrong password (401)**

```sh
$ curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"wrong-password"}'
{"error":"wrong email or password","requestId":"8d60e9c4-4b33-4b8f-beb8-8c00a5a8ca07"}
```

**POST /auth/login (200)**

```sh
$ curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"alice@example.com","password":"kadikoy-1907"}'
{"token":"2e5e68c7-6e75-401d-a146-61374f3a05eb"}
```

**GET /api/tasks without a token (401)**

```sh
$ curl -s -i localhost:8000/api/tasks
HTTP/1.1 401 Unauthorized
content-type: application/json
x-request-id: f9a4bf27-04ee-4b5d-a128-31b3893f9a73

{"error":"unauthorized","requestId":"f9a4bf27-04ee-4b5d-a128-31b3893f9a73"}
```

**GET /api/tasks (the welcome task)**

```sh
$ curl -s localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN"
{"items":[{"id":1,"userId":1,"title":"Welcome! Click Next to move me along.","notes":null,"dueDate":null,"status":"todo","priority":"medium","createdAt":1795606343,"updatedAt":1795606343,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}],"page":1,"limit":20,"total":1}
```

**POST /api/tasks (201)**

```sh
$ curl -s -X POST localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"title":"Buy an İstanbulkart","priority":"high","dueDate":"2026-12-01"}'
{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"todo","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}
```

**POST /api/tasks with an invalid status (400)**

```sh
$ curl -s -X POST localhost:8000/api/tasks -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"title":"x","status":"finished"}'
{"error":"validation failed","issues":[{"path":["status"],"message":"Invalid option: expected one of \"todo\"|\"in-progress\"|\"done\""}],"requestId":"b33bcf07-c7f6-40b0-b94c-0a8f8465078f"}
```

**GET /api/tasks/2**

```sh
$ curl -s localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN"
{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"todo","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}
```

**PUT /api/tasks/2 (only title and status: priority and dueDate stay)**

```sh
$ curl -s -X PUT localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"title":"Buy an İstanbulkart","status":"done"}'
{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"done","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":1795606343,"deletedAt":null,"attachment":null,"attachmentType":null}
```

**GET /api/tasks?page=2&limit=2 (5 tasks: page 2 holds 2)**

```sh
$ curl -s 'localhost:8000/api/tasks?page=2&limit=2' -H "Authorization: Bearer $TOKEN"
{"items":[{"id":3,"userId":1,"title":"Read Kar","notes":null,"dueDate":null,"status":"todo","priority":"medium","createdAt":1795606343,"updatedAt":1795606343,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null},{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"done","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":1795606343,"deletedAt":null,"attachment":null,"attachmentType":null}],"page":2,"limit":2,"total":5}
```

**GET /api/tasks?status=done**

```sh
$ curl -s 'localhost:8000/api/tasks?status=done' -H "Authorization: Bearer $TOKEN"
{"items":[{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"done","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":1795606343,"deletedAt":null,"attachment":null,"attachmentType":null}],"page":1,"limit":20,"total":1}
```

**GET /api/tasks?limit=1000 (400)**

```sh
$ curl -s 'localhost:8000/api/tasks?limit=1000' -H "Authorization: Bearer $TOKEN"
{"error":"validation failed","issues":[{"path":["limit"],"message":"Too big: expected number to be <=100"}],"requestId":"8d6b1c38-12b4-45c1-a9ff-ca43293e35a5"}
```

**GET /api/tasks/2 as another user (404)**

```sh
$ curl -s localhost:8000/api/tasks/2 -H "Authorization: Bearer $TOKEN_B"
{"error":"task not found","requestId":"7766bb9a-39d1-4e5f-93d5-e38b24c664c2"}
```

**DELETE /api/tasks/3**

```sh
$ curl -s -X DELETE localhost:8000/api/tasks/3 -H "Authorization: Bearer $TOKEN"
{"ok":true}
```

**GET /api/tasks/3 after the delete (404)**

```sh
$ curl -s localhost:8000/api/tasks/3 -H "Authorization: Bearer $TOKEN"
{"error":"task not found","requestId":"e6e6d768-b189-4b32-a6ce-38035b85e891"}
```

**POST /api/tasks/3/restore (Bonus 2)**

```sh
$ curl -s -X POST localhost:8000/api/tasks/3/restore -H "Authorization: Bearer $TOKEN"
{"id":3,"userId":1,"title":"Read Kar","notes":null,"dueDate":null,"status":"todo","priority":"medium","createdAt":1795606343,"updatedAt":1795606343,"completedAt":null,"deletedAt":null,"attachment":null,"attachmentType":null}
```

**GET /api/me/summary (Bonus 3)**

```sh
$ curl -s localhost:8000/api/me/summary -H "Authorization: Bearer $TOKEN"
{"todo":4,"in-progress":0,"done":1,"total":5}
```

**GET /api/admin/users as a normal user (403, Bonus 9)**

```sh
$ curl -s localhost:8000/api/admin/users -H "Authorization: Bearer $TOKEN"
{"error":"forbidden","requestId":"4481fc51-74c3-47c9-a27e-a32144d05b8d"}
```

**GET /no/such/route (404, with the request id, Bonus 10)**

```sh
$ curl -s -i localhost:8000/no/such/route
HTTP/1.1 404 Not Found
content-type: application/json
x-request-id: 4b9ba5b9-c62c-4398-92e3-23340ffbbe6d

{"error":"not found","requestId":"4b9ba5b9-c62c-4398-92e3-23340ffbbe6d"}
```

**GET /healthz and GET /readyz (Bonus 11)**

```sh
$ curl -s localhost:8000/healthz; echo; curl -s localhost:8000/readyz
{"ok":true}
{"ready":true}
```

**POST /api/tasks/2/attachment (Bonus 12)**

```sh
$ curl -s -X POST localhost:8000/api/tasks/2/attachment -H "Authorization: Bearer $TOKEN" -F 'file=@receipt.png;type=image/png'
{"id":2,"userId":1,"title":"Buy an İstanbulkart","notes":null,"dueDate":"2026-12-01","status":"done","priority":"high","createdAt":1795606343,"updatedAt":1795606343,"completedAt":1795606343,"deletedAt":null,"attachment":"ee1fc348-7988-4637-823a-322456145f29.png","attachmentType":"image/png"}
```

**GET /api/tasks/2/attachment (Bonus 12)**

```sh
$ curl -s -o /tmp/back.png -w '%{http_code} %{content_type} %{size_download} bytes\n' localhost:8000/api/tasks/2/attachment -H "Authorization: Bearer $TOKEN"; cmp /tmp/back.png receipt.png && echo same bytes
200 image/png 70 bytes
same bytes
```

**POST /api/tasks/2/attachment with a text file (415)**

```sh
$ curl -s -X POST localhost:8000/api/tasks/2/attachment -H "Authorization: Bearer $TOKEN" -F 'file=@README.md;type=image/png'
{"error":"the file content is not a real image/png","requestId":"47e3000e-aefc-4095-b52f-8c78bdeb4ed9"}
```

**GET /openapi.json, the paths only (Bonus 8)**

```sh
$ curl -s localhost:8000/openapi.json | grep -o '"/[a-z/{}]*":' | tr -d '":' | sort -u
/api/admin/users
/api/me/summary
/api/tasks
/api/tasks/{id}
/api/tasks/{id}/attachment
/api/tasks/{id}/restore
/auth/login
/auth/register
/health
```

**POST /auth/login after 5 failures, right password (429, Bonus 15)**

```sh
$ curl -s -i -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"bob@example.com","password":"kadikoy-1907"}'
HTTP/1.1 429 Too Many Requests
content-type: application/json
retry-after: 60
x-request-id: c12e5727-d4f0-4f39-9c9e-03af1617bb4a

{"error":"too many failed logins, try again later","requestId":"c12e5727-d4f0-4f39-9c9e-03af1617bb4a"}
```

The admin route, called with the token of `admin@example.com` (the `ADMIN_EMAIL` in `.env`):

```sh
$ curl -s localhost:8000/api/admin/users -H "Authorization: Bearer $ADMIN_TOKEN"
[{"id":1,"email":"alice@example.com","role":"user","createdAt":1795606343,"tasks":5},{"id":2,"email":"bob@example.com","role":"user","createdAt":1795606343,"tasks":1},{"id":3,"email":"admin@example.com","role":"admin","createdAt":1795606344,"tasks":1}]
```

## Tests (R7)

`deno task test` runs 76 tests in 17 files. Each test builds its own app on an empty
temporary database (`freshContext()` in `tests/helpers.ts`) and talks to it with
`app.request()`, so no server and no port are needed.

| file | what it proves |
| --- | --- |
| `auth_test.ts` | register 201 without the hash, 409 for a taken email (also with capitals), 400 for a bad or missing body or broken JSON, login token, the same 401 for a wrong email and password, 401 for a missing/malformed/unknown token, no timing difference |
| `tasks_test.ts` | create, read, update (PUT keeps the fields it was not given), delete; user B gets 404 for user A's task on GET, PUT and DELETE; invalid status and long title 400; id `abc` 400; pagination page 2 of 3 tasks with `limit=2` holds one item and total 3; status filter and defaults; bad query values 400; unknown route 404 |
| `health_test.ts` | the given test |
| the other 14 | one file per bonus, listed in the bonus sections |

## Bonuses claimed

Bonus 2, 3, 4, 5, 6 (option B), 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 below, each in its own
section. Bonus 1, 17, 18, 19 and 20 are prepared in the code; their sections say what is still
missing.

## Bonus 1: Migrations with Drizzle Kit

⚠ TODO (needs Drizzle Kit, run on my machine): `drizzle.config.ts` and the tasks
`db:generate` and `db:migrate` are ready, and `src/db.ts` has `migrateFromFolder()`, which uses
Drizzle's migrator. `main.ts` uses it as soon as `drizzle/meta/_journal.json` exists, and the
hand-written `migrate()` otherwise. Still to do:

1. `rm tasks.db && deno task db:generate`, read `drizzle/0000_*.sql`.
2. Add a nullable column to `tasks` in `schema.ts` (for example `estimateMinutes`), run
   `deno task db:generate` again, read the `ALTER TABLE` in `drizzle/0001_*.sql`.
3. Start the API: the log line says `{"migrations":"drizzle/"}`. Commit `drizzle/` and write
   here how the second change went.

## Bonus 2: Soft delete, restore and a transaction

`DELETE /api/tasks/:id` sets `deleted_at` instead of removing the row. Every list, lookup,
update, summary and count adds `deleted_at IS NULL` (one helper, `own()`, for the single-task
queries). `POST /api/tasks/:id/restore` clears it, and answers 404 when the task is not
deleted, or not mine. Registration inserts the user and a welcome task in one
`db.transaction(async (tx) => ...)`, using `tx` inside.

To prove the rollback, the test gives the app an empty welcome title. The `CHECK` constraint on
the title makes the second insert throw, register answers 500, and afterwards both tables are
empty: the user insert was undone too. Tests: `tests/softdelete_test.ts` (deleted then not
listed, row still there, restore, restore of a live task is 404, another user cannot restore,
welcome task, rolled-back registration).

## Bonus 3: Joins and the N+1 problem

`GET /api/me/summary` answers `{ todo, in-progress, done, total }` with one `GROUP BY status`
query. I wrote two pairs in `src/summary.ts`, and `deno task n+1` prints the SQL that each one
sends (Drizzle's logger):

```text
users with task counts, naive (5 users):
  [1] select "id", "email", "role", "created_at" from "users" order by "users"."id"
  [2] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [1]
  [3] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [2]
  [4] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [3]
  [5] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [4]
  [6] select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [5]
  => 6 queries, result: [{"id":1,"email":"user1@example.com","role":"user","createdAt"...]

users with task counts, LEFT JOIN + GROUP BY:
  [1] select "users"."id", "users"."email", "users"."role", "users"."created_at", count("tasks"."id") from "users" left join "tasks" on ("tasks"."user_id" = "users"."id" and "tasks"."deleted_at" is null) group by "users"."id" order by "users"."id"
  => 1 queries, result: [{"id":1,"email":"user1@example.com","role":"user","createdAt"...]

my summary, naive:
  [1] select "id", "user_id", "title", "notes", "due_date", "status", "priority", "created_at", "updated_at", "completed_at", "deleted_at", "attachment", "attachment_type" from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null)  -- [1]
  [2] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"todo"]
  [3] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"in-progress"]
  [4] select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?)  -- [1,"done"]
  => 4 queries, result: {"todo":4,"in-progress":0,"done":0,"total":4}

my summary, GROUP BY:
  [1] select "status", count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null) group by "tasks"."status"  -- [1]
  => 1 queries, result: {"todo":4,"in-progress":0,"done":0,"total":4}
```

The real N+1 is the admin list: one query for the users and **one more per user**, so 5 users
are 6 queries and 1000 users would be 1001 round trips. The `LEFT JOIN ... GROUP BY` version is
always 1 query (a `LEFT` join, so a user with no tasks is still listed, with 0). The naive
summary is 4 queries whatever the data, but its first query loads every row of the user only to
count them, so the bytes it moves grow with the number of tasks; `GROUP BY` returns at most 3
rows. `tests/summary_test.ts` counts the queries with a logger for 3 and 10 users (4 and 11
against 1) and checks that both versions give the same answer.

## Bonus 4: Indexes and EXPLAIN

`deno task explain` builds a temporary database with 20,000 tasks for 20 users and runs the list
query (`WHERE user_id = ? AND status = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`)
200 times without an index, with the index from the handout, and with my index:

```text
20000 tasks for 20 users

1. no index: EXPLAIN QUERY PLAN
  SCAN tasks
  USE TEMP B-TREE FOR ORDER BY
1. no index: 1.088 ms per query (average of 200)

2. index on (user_id, status): EXPLAIN QUERY PLAN
  SEARCH tasks USING INDEX idx_two (user_id=? AND status=?)
  USE TEMP B-TREE FOR ORDER BY
2. index on (user_id, status): 0.440 ms per query (average of 200)

3. index on (user_id, status, created_at), the one in schema.ts: EXPLAIN QUERY PLAN
  SEARCH tasks USING INDEX idx_tasks_user_status_created (user_id=? AND status=?)
3. index on (user_id, status, created_at): 0.243 ms per query (average of 200)

size on disk:
  idx_tasks_user_status_created: 430080 bytes
  tasks: 1011712 bytes
```

Without an index SQLite reads the whole table (`SCAN`) and then sorts. The two-column index
turns the scan into a `SEARCH`, but the plan still says `USE TEMP B-TREE FOR ORDER BY`: the
matching rows still have to be sorted. With `created_at` as the third column the rows come out
of the index already in order, the sort step disappears, and the query is about 4 to 6 times
faster than without an index (the exact times change from run to run; in my runs between
4 and 10 times). The cost: the index takes
430 KB next to the 1 MB table, and every insert, status change and delete must update it too.
`tests/data_test.ts` checks that the plan uses the index and has no sort step.

## Bonus 5: Seed data

`deno task seed` opens the database from `.env`, runs the migrations and inserts three demo
users and 18 tasks with realistic titles, statuses, priorities and due dates. Log in as
`alice@example.com`, `bob@example.com` or `admin@example.com` (an admin) with the password
`demo-password-2026`.

```text
$ deno task seed
seed: 3 users and 18 tasks created in file:./tasks.db
$ deno task seed
seed: 0 users and 0 tasks created in file:./tasks.db
$ APP_ENV=production JWT_SECRET=... deno task seed
refusing to seed: APP_ENV is production
```

Running it twice is safe: the users are inserted with `onConflictDoNothing()` on the email, and
a user who already has tasks gets none. `tests/data_test.ts` runs it twice on one database and
logs in as a seeded user through the API.

## Bonus 6: A connection pool (Postgres or SQLite)

**Option B: a pool of my own on SQLite** (`src/pool.ts`, `createDbPool()` in `src/db.ts`).

- `Pool<T>`: `acquire()` gives an idle item or waits in a first-come-first-served queue,
  `release()` hands the item straight to the next waiter, `use(fn)` always gives it back in a
  `finally`. I added a timeout: a waiter that gets nothing within 10 s gets a `PoolTimeoutError`,
  which the app turns into **503 "database busy, try again"** with `Retry-After: 1`, instead of
  letting requests pile up forever. (I also changed the handout's `if (item)` to
  `item !== undefined`, so a falsy item such as `0` would still count.)
- `createDbPool(url, size)` opens `size` libSQL clients on the same file, each with
  `journal_mode=WAL` (readers do not block the writer), `busy_timeout=5000` (wait for a lock
  instead of failing) and foreign keys on. An in-memory database is private to its connection
  and a remote libSQL database is reached over HTTP, so both get one client.
- A middleware borrows one connection for every request (`c.set("db", db)`) and gives it back
  when the response is done.

**Size.** `DB_POOL_SIZE` defaults to 4, the tests use 2. SQLite allows one writer at a time
anyway, so more connections only help readers (WAL lets them read while one writes); four
covers a small machine's cores without keeping many file handles open.

**When all connections are busy**, a request waits in the queue; it is served as soon as any
request finishes, in arrival order, or it gets a 503 after 10 s.

**Why SQLite gains little.** A Postgres pool saves a network connection and a server process per
request, and Postgres runs queries in parallel on many cores. SQLite is a library inside our
process: "opening a connection" is opening a file, queries are fast local calls, and writes are
serialised by one file lock no matter how many connections there are. The pool mainly limits
how many requests touch the database at once and lets reads run next to a write.

Tests (`tests/pool_test.ts`): 20 jobs on a pool of 3 never run more than 3 at once and all
finish; a job that throws still gives its connection back; waiters are served in order; the
timeout; 30 concurrent inserts through a pool of 3 real connections all land, and WAL is on.

## Bonus 7: JWT instead of sessions

`AUTH_MODE=jwt` switches login to a signed JWT (`jose`, HS256, `sub` = user id, `role` claim,
1 hour), and `requireAuth` verifies the signature instead of looking up the sessions table. I
kept sessions as the default because R3 asks for them; both live behind one small interface,
`TokenService { issue, verify }`, so the routes and all other tests do not care which one runs.
The secret comes from `JWT_SECRET`, and `config.ts` refuses to start in production with the
default value or anything shorter than 32 characters.

Tests (`tests/jwt_test.ts`): login returns a three-part JWT and the task routes work with it
while the sessions table stays empty; a token with one changed character is 401; an expired
token (signed with `-1s`) is 401; a token signed with another secret is 401 (even one that
claims `role: admin`); a session token is refused in JWT mode and the reverse.

| | session (R3) | JWT (Bonus 7) |
| --- | --- | --- |
| check per request | one database query (token → user and role) | only a signature check, no lookup |
| more than one server | all servers need the same database | any server with the secret can check it |
| log out / ban a user | delete the session row: it stops working at once | it stays valid until it expires (1 h), unless I add a block list, which is a lookup again |
| role change | seen on the next request | seen only after the next login (the role is inside the token) |
| what a stolen token gives | access until the row is deleted | access until it expires; no way to cut it short |

For this app, where the database is local anyway, the session is simpler and safer; JWT pays
off when several servers or services must check logins without sharing a database.

## Bonus 8: OpenAPI and a docs page

The app is an `OpenAPIHono`, and every route is declared with `createRoute` (method, path,
request schemas, responses) and registered with `app.openapi(route, handler)`. The schemas in
`src/schemas.ts` are the same objects that validate the requests, so the document cannot drift
from the code: when I made PUT keep missing fields, the docs changed with it. Every protected
route lists 400/401 (and 404 for the routes with an id) with the error schema, and the
`Bearer` security scheme, so `/docs` (Swagger UI) has an **Authorize** button: log in with
`POST /auth/login`, paste the token, and try `GET /api/tasks`. `tests/openapi_test.ts` checks
that `/openapi.json` lists exactly my 13 documented operations, that every `/api` route asks
for the token and documents 401 (and 404 where there is an id), and that `/docs` loads it.

## Bonus 9: Roles (RBAC)

`users.role` is `user` (default) or `admin`. The auth middleware puts the role next to the user
id: from the users table in session mode (the same query that checks the token, with a join),
from the `role` claim in JWT mode. `requireRole("admin")` guards `/api/admin/*`, and
`GET /api/admin/users` lists every user with their task count (the join from Bonus 3).

**How an admin comes to exist:** whoever registers with the email in `ADMIN_EMAIL` gets the
admin role (compared in lower case), and the seed script creates `admin@example.com`. Nobody
can choose a role through the API.

**401 versus 403:** 401 means "I do not know who you are" (no token, or a bad one): logging in
can fix it. 403 means "I know who you are, and you may not do this": logging in again does not
help. Tests (`tests/rbac_test.ts`): no token 401, a normal user 403, the admin 200 with the user
list and no hashes, and the same in JWT mode.

## Bonus 10: Logging and request ids

A middleware gives every request an id (`crypto.randomUUID()`), sets it as the `x-request-id`
response header (also on responses built by `onError` and `notFound`) and puts it in every error
body. After the route has run it logs one JSON line. An excerpt from the run that produced the
curl section:

```text
{"time":"2026-11-25T11:32:22.859Z","requestId":"f4467ad2-4149-423d-9faf-2b78ca8477c3","method":"GET","path":"/health","status":200,"ms":2}
{"time":"2026-11-25T11:32:23.023Z","requestId":"05afc5cc-a396-45de-afe1-e8cb295c0289","method":"POST","path":"/auth/register","status":201,"ms":144}
{"time":"2026-11-25T11:32:23.040Z","requestId":"2c5c115a-8bdb-4092-92cf-649b9b1cdb80","method":"POST","path":"/auth/register","status":409,"ms":1}
{"time":"2026-11-25T11:32:23.057Z","requestId":"e502337b-676b-4c2f-935d-5a0a6cebc774","method":"POST","path":"/auth/register","status":400,"ms":1}
{"time":"2026-11-25T11:32:23.169Z","requestId":"8d60e9c4-4b33-4b8f-beb8-8c00a5a8ca07","method":"POST","path":"/auth/login","status":401,"ms":96}
{"time":"2026-11-25T11:32:23.278Z","requestId":"e88cdedc-ad42-46b4-829e-7479919da1d3","method":"POST","path":"/auth/login","status":200,"ms":96}
{"time":"2026-11-25T11:32:23.411Z","requestId":"cad39a85-539a-4ace-a7e4-816bf1cc4d45","method":"POST","path":"/auth/login","status":200,"ms":122}
{"time":"2026-11-25T11:32:23.428Z","requestId":"f9a4bf27-04ee-4b5d-a128-31b3893f9a73","method":"GET","path":"/api/tasks","status":401,"ms":1}
{"time":"2026-11-25T11:32:23.891Z","requestId":"4481fc51-74c3-47c9-a27e-a32144d05b8d","method":"GET","path":"/api/admin/users","status":403,"ms":0,"userId":1}
{"time":"2026-11-25T11:32:24.560Z","requestId":"c12e5727-d4f0-4f39-9c9e-03af1617bb4a","method":"POST","path":"/auth/login","status":429,"ms":1}
```

**No password or token in the log:** the line is built from a fixed list of fields (time, id,
method, path, status, ms, user id); it never touches the body or the headers, and it uses
`c.req.path`, which has no query string (the WebSocket token travels in the query).
`tests/logging_test.ts` registers, logs in, lists and opens `/ws?token=...`, then checks that
none of the captured lines contains the password, the token or a `?`. The same file checks the
header, that two requests get different ids, and that the id in an error body equals the header.

## Bonus 11: Health, readiness and configuration

`GET /healthz` answers 200 while the process runs. `GET /readyz` runs `SELECT 1` and answers
503 `{ ready: false }` when the database does not answer, so a platform stops sending traffic
but does not restart the process. `src/config.ts` reads `APP_ENV`, `PORT`, `DATABASE_URL`,
`DATABASE_AUTH_TOKEN`, `DB_POOL_SIZE`, `AUTH_MODE`, `JWT_SECRET`, `ADMIN_EMAIL`, `UPLOAD_DIR` and
`LOG_REQUESTS` once, validates them with Zod, and `main.ts` stops with every problem listed:

```text
$ PORT=eighty AUTH_MODE=magic deno task start
invalid configuration:
  PORT: Invalid input: expected number, received NaN
  AUTH_MODE: Invalid option: expected one of "session"|"jwt"
```

In production it refuses `dev-secret`, `change-me` and any secret shorter than 32 characters, and
a remote database without a token. `.env.test` is committed (no secrets); `.env.production` is
not, only `.env.production.example`; `deno task start:prod` starts with
`--env-file=.env.production`. Tests (`tests/ops_test.ts`): `/healthz` and `/readyz` 200; `/readyz`
503 after the database client is closed while `/healthz` stays 200; defaults; three bad values
reported together; production secrets refused.

## Bonus 12: File upload

`POST /api/tasks/:id/attachment` takes `multipart/form-data` with a field `file`. The checks, in
order: Hono's `bodyLimit` stops a body over about 1 MB before it is read into memory (413); no
`File` in the form is 400; a file over 1,000,000 bytes is 413; a type other than `image/png` or
`image/jpeg` is 415; and, because the browser's type is only a claim, the first bytes must match
it (PNG `89 50 4E 47 ...`, JPEG `FF D8 FF`), otherwise 415. The file is saved under
`UPLOAD_DIR` as `<uuid>.png` or `<uuid>.jpg`, never under the user's name (the test uploads a file
called `../../etc/passwd.png`). A new upload replaces and deletes the old file. `GET` returns the
bytes with the stored content type and `x-content-type-options: nosniff`, only to the owner.
`uploads/` is in `.gitignore`. Tests (`tests/upload_test.ts`): upload and download the same
bytes; no file 400; 1 MB + 1 byte 413; GIF 415 and a text file that claims to be PNG 415;
another user 404 for both; no attachment 404.

## Bonus 13: WebSocket live updates

`GET /ws?token=...` checks the token **before** `Deno.upgradeWebSocket` (401 otherwise; 426 if it
is not a WebSocket request). `LiveHub` (`src/live.ts`) keeps a `Map<userId, Set<socket>>`: a
socket is added on `open` and removed on `close`. After every create, update, delete, restore and
upload the route sends `{ type, task }` to that user's open sockets only. `scripts/live_client.ts`
(`deno task live alice@example.com kadikoy-1907`) logs in and prints every event it receives.

Tests (`tests/live_test.ts`, with fake sockets): a bad or missing token is 401 before any upgrade;
no upgrade header is 426; Alice's tab receives `created`, `updated`, `deleted` while Bob's tab
receives nothing; a closed tab receives nothing; sockets that are not open are skipped.

⚠ TODO (run on my machine): start the API and `deno task live`, change a task in the UI, paste
what the client printed here and say what I saw.

## Bonus 14: A background job with Deno.cron

`purgeOldDone(db, days)` (`src/jobs.ts`) hard-deletes tasks whose status is `done` and whose
`completed_at` is at least `days` days old, deletes their attachment files, and returns the
number of rows. It is idempotent: a second run finds nothing. `main.ts` registers it with
`Deno.cron("purge old done tasks", "0 3 * * *", ...)` and logs `{ job: "purge", removed }`;
the `dev`, `start` and `test` tasks pass `--unstable-cron`. Tests (`tests/jobs_test.ts`, with a
fixed "now"): of five tasks only the done one from 45 days ago and the one from exactly 30 days
ago go, and a second run removes 0; the attachment file of a purged task is removed.

⚠ TODO (run on my machine): change the schedule to `"* * * * *"` for two minutes, paste the log
lines here, and change it back.

## Bonus 15: Rate limit on login

`LoginLimiter` (`src/ratelimit.ts`) keeps a `Map` from email to `{ failures, resetAt }`. Before
the password is checked, an email with 5 or more failures in its 60-second window gets **429**
with `Retry-After` (seconds left in the window), even with the right password (see the last curl
example). A success clears the counter; an old window starts again from 0. The email is used in
lower case, so `Alice@` and `alice@` share one counter. The clock is passed in, so the test can
move time forward instead of waiting.

What it does **not** protect against: the counters live in one process's memory, so with several
servers (or after a restart) each has its own count, and an attacker who tries one password on
**many** emails never reaches 5 per email. A shared store (Deno KV) and a second limit per IP
address would help with both. Tests: `tests/ratelimit_test.ts`.

## Bonus 16: A cache with Deno KV

`TaskCache` (`src/cache.ts`) caches `GET /api/tasks/:id` in Deno KV under
`["task", userId, id]` for 60 seconds (`expireIn`). A miss loads from the database and stores the
row; a task that does not exist is not cached. Update, delete, restore and upload call
`cache.drop(userId, id)`. The user id in the key means user B's request can never find user A's
entry, even with the same task id. `main.ts` opens `Deno.openKv()` (tasks pass `--unstable-kv`);
tests use `Deno.openKv(":memory:")` and close it. Tests (`tests/cache_test.ts`): the second read
is a hit (1 miss, 1 hit); after PUT the new title is served, after DELETE 404; B gets 404 for A's
cached task; unknown ids are not cached.

## Bonus 17: Docker

`Dockerfile` and `.dockerignore` are in the project. The image copies `deno.json` and `deno.lock`
and runs `deno install` **before** copying `src/`, so a code change does not download the
dependencies again. It runs as the non-root user `deno`, keeps the database and the uploads in
`/data` (a volume), and has a `HEALTHCHECK` on `/readyz`.

The permission flags in `CMD`: `--allow-net` (listen on 8000), `--allow-env` (read the
configuration), `--allow-read` and `--allow-write` (the database file, the uploads and the
module cache), `--allow-ffi` (libSQL is a native library), `--allow-sys` (libSQL asks for the
OS and CPU type), `--unstable-kv` and `--unstable-cron` (Bonus 16 and 14).

⚠ TODO (needs Docker, run on my machine):

    docker build -t tasks-api .
    docker volume create tasksdata
    docker run -d --rm --name tasks -p 8000:8000 -v tasksdata:/data \
      -e JWT_SECRET=$(openssl rand -base64 48) tasks-api
    curl -s -X POST localhost:8000/auth/register -H 'content-type: application/json' \
      -d '{"email":"a@example.com","password":"kadikoy-1907"}'
    docker stop tasks    # then run it again and register the same email: 409
    docker image ls tasks-api

Paste the outputs and the image size here.

## Bonus 18: Continuous integration

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check` and
`deno task test` on every push and pull request.

⚠ TODO (needs the GitHub repository): link a green run and a red run (break a test in a
branch), and describe it here.

## Bonus 19: Deploy

Prepared: `createDb()` passes `DATABASE_AUTH_TOKEN` to libSQL, so `DATABASE_URL` can be a Turso
`libsql://...` URL; `config.ts` refuses a remote URL without a token in production; Deno Deploy
has KV and cron built in.

⚠ TODO (needs Deno Deploy and Turso accounts): create the database, set `DATABASE_URL`,
`DATABASE_AUTH_TOKEN`, `JWT_SECRET` and `APP_ENV=production` in the dashboard, deploy, and paste
the public URL and a curl of `/health`, register and login here. Uploads would not survive on
Deploy (no lasting disk), which is worth noting.

## Bonus 20: Git repository

⚠ TODO: push to GitHub and put the link here: `https://github.com/USERNAME/tasks-api`.
`.gitignore` leaves out `.env`, `.env.production`, `*.db` (and `-wal`, `-shm`), `node_modules`
and `uploads/`.

## My own log (R8)

⚠ Rewrite this section in your own words, and add what happens when you run it yourself.

1. **The CHECK constraint error was hidden inside another error.** When I tried an empty title
   directly through Drizzle, the message I printed first was only
   `Failed query: insert into "tasks" ...` with the SQL. The real reason was in `error.cause`:
   `CHECK constraint failed: tasks_title_length`. Since then I print
   `err.cause` when a query fails.
2. **Login told which emails exist, by its speed.** In the server log the 401 for an unknown
   email took 1 to 2 ms and the 401 for a wrong password about 100 ms, because only the second
   one ran bcrypt. The message was the same, the time was not. Fixed with a dummy hash (design
   decisions) and a test.
3. **The UI reset my priorities.** Reading `ui/src/App.tsx` I saw that "advance" sends only
   `{ title, status }`. With `priority` defaulting to `medium` in the PUT schema, every click
   would have turned a `high` task into `medium`. I changed PUT to keep missing fields.
4. **An index that was not enough.** After `CREATE INDEX ... (user_id, status)` the plan said
   `SEARCH ... USING INDEX`, which I expected, but also still `USE TEMP B-TREE FOR ORDER BY`,
   which I did not. The sort was still there because of `ORDER BY created_at`. Adding
   `created_at` as a third column removed it and halved the time again.
5. **A request with no content-type is not "malformed".** I expected a POST without a body to
   answer `Malformed JSON in request body`. Instead it answers `validation failed` with
   `email: Invalid input: expected string, received undefined`: Hono's JSON validator only parses
   the body when the content type is JSON, and otherwise hands `{}` to Zod. Broken JSON *with*
   the JSON content type does give the "malformed" message. Both are 400; I added a test for each.
6. **The welcome task changed my counts.** After Bonus 2 every user starts with one task, so the
   counts in my R7 tests (`total: 1` after one create) were no longer right. I kept the welcome
   task, used a `WELCOME_TASKS` constant in the tests, and filtered the pagination test by status
   so that it still checks exactly "3 tasks, page 2 with `limit=2`: one item, total 3".
7. **Zod 4 messages.** An invalid status answers
   `Invalid option: expected one of "todo"|"in-progress"|"done"`, and a short password
   `Too small: expected string to have >=8 characters`. The handout's troubleshooting table also
   warns that the list is `error.issues` in Zod 4, not `error.errors`.
