// Umut Berke Şenyayla, 2000002240
// Actual HTTP and WebSocket traffic, not FakeSocket or app.request().
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { testConfig } from "../src/config.ts";
import { createDbPool, migrateDatabase } from "../src/db.ts";
const dir = await Deno.makeTempDir();
const pool = await createDbPool(`file:${dir}/live.db`, 2);
await pool.use(migrateDatabase);
const app = createApp({ pool, config: testConfig(), log: null });
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen: () => {} },
  app.fetch,
);
const base = `http://127.0.0.1:${server.addr.port}`;
const sockets: WebSocket[] = [];
async function request(method: string, path: string, body?: unknown, token?: string) {
  return await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(email: string) {
  const body = { email, password: "live-test-password" };
  assertEquals((await request("POST", "/auth/register", body)).status, 201);
  return (await (await request("POST", "/auth/login", body)).json()).token as string;
}
async function connect(token: string) {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/ws?token=${token}`);
  const events: string[] = [];
  sockets.push(socket);
  socket.onmessage = (event) => events.push(JSON.parse(event.data).type);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 5000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket failed"));
    };
  });
  return events;
}
try {
  const alice = await login("alice-live@example.com");
  const bob = await login("bob-live@example.com");
  const a1 = await connect(alice);
  const a2 = await connect(alice);
  const b = await connect(bob);
  assertEquals((await fetch(`${base}/ws?token=bad`)).status, 401);
  const created = await request(
    "POST",
    "/api/tasks",
    { title: "Live demonstration" },
    alice,
  );
  assertEquals(created.status, 201);
  const task = await created.json();
  assertEquals(
    (await request("PUT", `/api/tasks/${task.id}`, {
      title: "Updated live",
      status: "done",
    }, alice)).status,
    200,
  );
  assertEquals(
    (await request("DELETE", `/api/tasks/${task.id}`, undefined, alice)).status,
    200,
  );
  const until = Date.now() + 5000;
  while ((a1.length < 3 || a2.length < 3) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assertEquals(a1, ["created", "updated", "deleted"]);
  assertEquals(a2, a1);
  assertEquals(b, []);
  console.log("Actual HTTP server + three actual WebSocket connections");
  console.log("Invalid token: HTTP 401 before upgrade");
  console.log("Alice connection 1:", JSON.stringify(a1));
  console.log("Alice connection 2:", JSON.stringify(a2));
  console.log("Bob connection:", JSON.stringify(b));
  console.log("PASS: both same-user clients updated; another user received nothing.");
} finally {
  await Promise.all(sockets.map((socket) =>
    new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.onclose = () => resolve();
      socket.close();
    })
  ));
  await server.shutdown();
  for (const db of pool.items()) db.client.close();
  await Deno.remove(dir, { recursive: true });
}
