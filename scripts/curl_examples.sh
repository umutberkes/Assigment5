#!/bin/sh
# STUDENT NAME, STUDENT NUMBER
# R8: run one curl command per route against a running API and print the commands with their
# real output as Markdown, ready to paste into README.md.
#   deno task dev            (first terminal; start from an empty tasks.db)
#   deno task curl > curl.md (second terminal)
API=${API:-http://localhost:8000}
EMAIL=${EMAIL:-alice@example.com}
PASS=kadikoy-1907

show() { # show "title" command...
  title=$1; shift
  printf '\n%s\n\n```sh\n$ %s\n' "$title" "$*" | sed "s#$API#localhost:8000#g; s#$TOKEN#\$TOKEN#g; s#$TOKEN_B#\$TOKEN_B#g"
  # -i output: leave out the headers that change on every run or depend on the server
  sh -c "$*" 2>&1 | tr -d '\r' \
    | grep -iv '^\(date\|connection\|keep-alive\|vary\|content-length\|transfer-encoding\):' \
    | sed "s#$TOKEN#\$TOKEN#g; s#$TOKEN_B#\$TOKEN_B#g" | sed -e '$a\'
  printf '```\n'
}
TOKEN=__none__; TOKEN_B=__none__
token_of() {
  curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/'
}

show "GET /health" "curl -s $API/health"
show "POST /auth/register (201)" "curl -s -X POST $API/auth/register -H 'content-type: application/json' -d '{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}'"
show "POST /auth/register again (409)" "curl -s -X POST $API/auth/register -H 'content-type: application/json' -d '{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}'"
show "POST /auth/register with a bad body (400)" "curl -s -X POST $API/auth/register -H 'content-type: application/json' -d '{\"email\":\"not-an-email\",\"password\":\"short\"}'"
show "POST /auth/login with a wrong password (401)" "curl -s -X POST $API/auth/login -H 'content-type: application/json' -d '{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}'"
show "POST /auth/login (200)" "curl -s -X POST $API/auth/login -H 'content-type: application/json' -d '{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}'"
TOKEN=$(token_of "$EMAIL")

show "GET /api/tasks without a token (401)" "curl -s -i $API/api/tasks"
show "GET /api/tasks (the welcome task)" "curl -s $API/api/tasks -H \"Authorization: Bearer $TOKEN\""
show "POST /api/tasks (201)" "curl -s -X POST $API/api/tasks -H \"Authorization: Bearer $TOKEN\" -H 'content-type: application/json' -d '{\"title\":\"Buy an İstanbulkart\",\"priority\":\"high\",\"dueDate\":\"2026-12-01\"}'"
show "POST /api/tasks with an invalid status (400)" "curl -s -X POST $API/api/tasks -H \"Authorization: Bearer $TOKEN\" -H 'content-type: application/json' -d '{\"title\":\"x\",\"status\":\"finished\"}'"
show "GET /api/tasks/2" "curl -s $API/api/tasks/2 -H \"Authorization: Bearer $TOKEN\""
show "PUT /api/tasks/2 (only title and status: priority and dueDate stay)" "curl -s -X PUT $API/api/tasks/2 -H \"Authorization: Bearer $TOKEN\" -H 'content-type: application/json' -d '{\"title\":\"Buy an İstanbulkart\",\"status\":\"done\"}'"
for t in "Read Kar" "Ferry at 08:15" "Call grandma"; do
  curl -s -o /dev/null -X POST "$API/api/tasks" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"title\":\"$t\"}"
done
show "GET /api/tasks?page=2&limit=2 (5 tasks: page 2 holds 2)" "curl -s '$API/api/tasks?page=2&limit=2' -H \"Authorization: Bearer $TOKEN\""
show "GET /api/tasks?status=done" "curl -s '$API/api/tasks?status=done' -H \"Authorization: Bearer $TOKEN\""
show "GET /api/tasks?limit=1000 (400)" "curl -s '$API/api/tasks?limit=1000' -H \"Authorization: Bearer $TOKEN\""

curl -s -o /dev/null -X POST "$API/auth/register" -H 'content-type: application/json' -d "{\"email\":\"bob@example.com\",\"password\":\"$PASS\"}"
TOKEN_B=$(token_of bob@example.com)
show "GET /api/tasks/2 as another user (404)" "curl -s $API/api/tasks/2 -H \"Authorization: Bearer $TOKEN_B\""
show "DELETE /api/tasks/3" "curl -s -X DELETE $API/api/tasks/3 -H \"Authorization: Bearer $TOKEN\""
show "GET /api/tasks/3 after the delete (404)" "curl -s $API/api/tasks/3 -H \"Authorization: Bearer $TOKEN\""
show "POST /api/tasks/3/restore (Bonus 2)" "curl -s -X POST $API/api/tasks/3/restore -H \"Authorization: Bearer $TOKEN\""
show "GET /api/me/summary (Bonus 3)" "curl -s $API/api/me/summary -H \"Authorization: Bearer $TOKEN\""
show "GET /api/admin/users as a normal user (403, Bonus 9)" "curl -s $API/api/admin/users -H \"Authorization: Bearer $TOKEN\""
show "GET /no/such/route (404, with the request id, Bonus 10)" "curl -s -i $API/no/such/route"
show "GET /healthz and GET /readyz (Bonus 11)" "curl -s $API/healthz; echo; curl -s $API/readyz"
if [ -n "$PNG" ]; then
  show "POST /api/tasks/2/attachment (Bonus 12)" "curl -s -X POST $API/api/tasks/2/attachment -H \"Authorization: Bearer $TOKEN\" -F 'file=@$PNG;type=image/png'"
  show "GET /api/tasks/2/attachment (Bonus 12)" "curl -s -o /tmp/back.png -w '%{http_code} %{content_type} %{size_download} bytes\n' $API/api/tasks/2/attachment -H \"Authorization: Bearer $TOKEN\"; cmp /tmp/back.png $PNG && echo same bytes"
  show "POST /api/tasks/2/attachment with a text file (415)" "curl -s -X POST $API/api/tasks/2/attachment -H \"Authorization: Bearer $TOKEN\" -F 'file=@README.md;type=image/png'"
fi
show "GET /openapi.json, the paths only (Bonus 8)" "curl -s $API/openapi.json | grep -o '\"/[a-z/{}]*\":' | tr -d '\":' | sort -u"
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST "$API/auth/login" -H 'content-type: application/json' -d '{"email":"bob@example.com","password":"wrong-password"}'
done
show "POST /auth/login after 5 failures, right password (429, Bonus 15)" "curl -s -i -X POST $API/auth/login -H 'content-type: application/json' -d '{\"email\":\"bob@example.com\",\"password\":\"$PASS\"}'"
