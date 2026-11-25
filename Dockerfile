# STUDENT NAME, STUDENT NUMBER
# Bonus 17: build with  docker build -t tasks-api .
FROM denoland/deno:2.6.3
WORKDIR /app

# 1. dependencies first: this layer is reused as long as deno.json and deno.lock do not change
COPY deno.json deno.lock* ./
RUN deno install

# 2. then the source; a code change only rebuilds from here
COPY src ./src
RUN deno cache src/main.ts

# the database and the uploads live on a volume mounted at /data
RUN mkdir /data && chown deno:deno /data
USER deno
ENV APP_ENV=production DATABASE_URL=file:/data/tasks.db UPLOAD_DIR=/data/uploads PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD ["deno", "eval", "const r = await fetch('http://localhost:8000/readyz'); Deno.exit(r.ok ? 0 : 1)"]
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-ffi", "--allow-sys", "--unstable-kv", "--unstable-cron", "src/main.ts"]
