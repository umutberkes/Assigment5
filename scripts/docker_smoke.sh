#!/bin/sh
# Umut Berke Şenyayla, 2000002240
# Run from the project root; uses only an isolated test volume and container.
set -eu
image=assignment5-smoke
container=assignment5-smoke-$$
volume=assignment5-smoke-$$
port=${SMOKE_PORT:-18080}
secret=$(openssl rand -hex 32)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker build -t "$image" .
docker volume create "$volume" >/dev/null
start() {
  docker run -d --name "$container" -p "$port:8000" -v "$volume:/data" \
    -e JWT_SECRET="$secret" "$image" >/dev/null
  attempt=0
  until curl -fsS "http://localhost:$port/readyz" >/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then docker logs "$container"; exit 1; fi
    sleep 1
  done
}
start
printf '\nContainer user: '
docker exec "$container" id -u
printf 'POST /auth/register: '
status=$(curl -s -o /tmp/assignment5-register-$$.json -w '%{http_code}' \
  -X POST "http://localhost:$port/auth/register" -H 'content-type: application/json' \
  -d '{"email":"persist@example.com","password":"container-test-password"}')
cat /tmp/assignment5-register-$$.json
printf '\nHTTP %s\n' "$status"
test "$status" = 201
docker stop "$container" >/dev/null
docker rm "$container" >/dev/null
start
printf 'Same registration after replacing container, reusing volume: '
status=$(curl -s -o /tmp/assignment5-register-$$.json -w '%{http_code}' \
  -X POST "http://localhost:$port/auth/register" -H 'content-type: application/json' \
  -d '{"email":"persist@example.com","password":"container-test-password"}')
cat /tmp/assignment5-register-$$.json
printf '\nHTTP %s\n' "$status"
test "$status" = 409
printf 'GET /health: '
curl -fsS "http://localhost:$port/health"
printf '\nImage bytes: '
docker image inspect "$image" --format '{{.Size}}'
printf 'Docker persistence check passed.\n'
rm /tmp/assignment5-register-$$.json
