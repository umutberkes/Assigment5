// STUDENT NAME, STUDENT NUMBER
// Bonus 13: WebSocket live updates.
import { assertEquals } from "@std/assert";
import { LiveHub, type LiveSocket } from "../src/live.ts";
import { freshApp, loginAs, makeTask, send } from "./helpers.ts";

/** Stands in for a WebSocket: records what the server sends. */
class FakeSocket implements LiveSocket {
  readyState = 1;
  sent: { type: string; task: { id: number; title: string } }[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
}

/** An app whose upgrade hands out FakeSockets, so the test can "open a tab". */
async function liveApp() {
  const sockets: FakeSocket[] = [];
  const app = await freshApp({
    upgradeWebSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return {
        socket: socket as unknown as WebSocket,
        response: new Response(null, { status: 200 }),
      };
    },
  });
  const openTab = async (token: string) => {
    const res = await app.request(`/ws?token=${token}`, { headers: { upgrade: "websocket" } });
    assertEquals(res.status, 200);
    const socket = sockets.at(-1)!;
    socket.onopen?.();
    return socket;
  };
  return { app, openTab };
}

Deno.test("GET /ws with a bad or missing token is 401, before any upgrade", async () => {
  const { app } = await liveApp();
  for (const q of ["", "?token=", "?token=not-a-token"]) {
    const res = await app.request(`/ws${q}`, { headers: { upgrade: "websocket" } });
    assertEquals(res.status, 401, q);
    assertEquals((await res.json()).error, "unauthorized");
  }
});

Deno.test("GET /ws with a good token but no upgrade header is 426", async () => {
  const { app } = await liveApp();
  const token = await loginAs(app, "alice@example.com");
  assertEquals((await app.request(`/ws?token=${token}`)).status, 426);
});

Deno.test("a change in one tab reaches my other tab, and never another user's", async () => {
  const { app, openTab } = await liveApp();
  const alice = await loginAs(app, "alice@example.com");
  const bob = await loginAs(app, "bob@example.com");
  const aliceTab = await openTab(alice);
  const bobTab = await openTab(bob);

  const task = await makeTask(app, alice, { title: "Live!" });
  await send(app, "PUT", `/api/tasks/${task.id}`, { title: "Live!", status: "done" }, alice);
  await send(app, "DELETE", `/api/tasks/${task.id}`, undefined, alice);

  assertEquals(aliceTab.sent.map((e) => e.type), ["created", "updated", "deleted"]);
  assertEquals(aliceTab.sent[0]!.task.title, "Live!");
  assertEquals(bobTab.sent, []);
});

Deno.test("a closed tab is removed from the hub", async () => {
  const { app, openTab } = await liveApp();
  const alice = await loginAs(app, "alice@example.com");
  const tab = await openTab(alice);
  tab.onclose?.();
  await makeTask(app, alice, { title: "nobody listens" });
  assertEquals(tab.sent, []);
});

Deno.test("LiveHub: only open sockets of that user receive the event", () => {
  const hub = new LiveHub();
  const open = new FakeSocket();
  const closing = new FakeSocket();
  closing.readyState = 2;
  hub.add(1, open);
  hub.add(1, closing);
  const task = { id: 7, title: "t" } as never;
  assertEquals(hub.publish(1, { type: "created", task }), 1);
  assertEquals(hub.publish(2, { type: "created", task }), 0);
  hub.remove(1, open);
  hub.remove(1, closing);
  assertEquals(hub.count(1), 0);
});
