Actual curl calls, 25 November 2026. Isolated local database. Session tokens redacted.

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
