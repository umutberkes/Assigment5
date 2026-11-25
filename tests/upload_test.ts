// Umut Berke Şenyayla, 2000002240
// Bonus 12: attach an image to a task and download it again.
import { assertEquals } from "@std/assert";
import { freshContext, loginAs, makeTask } from "./helpers.ts";

// the smallest valid PNG: a 1x1 transparent pixel
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

async function setup() {
  const ctx = await freshContext();
  const token = await loginAs(ctx.app, "alice@example.com");
  const task = await makeTask(ctx.app, token, { title: "Scan the receipt" });
  return { ...ctx, token, task };
}

function upload(
  app: Awaited<ReturnType<typeof setup>>["app"],
  token: string,
  id: number,
  file?: File,
) {
  const form = new FormData();
  if (file) form.append("file", file);
  else form.append("note", "no file here");
  return app.request(`/api/tasks/${id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

Deno.test("upload a PNG, then download the same bytes with the right content-type", async () => {
  const { app, token, task, config } = await setup();
  const res = await upload(
    app,
    token,
    task.id,
    new File([PNG], "../../etc/passwd.png", {
      type: "image/png",
    }),
  );
  assertEquals(res.status, 200);
  const updated = await res.json();
  assertEquals(updated.attachmentType, "image/png");
  // stored under a generated name, never the name the user sent
  assertEquals(/^[0-9a-f-]{36}\.png$/.test(updated.attachment), true);
  const files = [...Deno.readDirSync(config.UPLOAD_DIR)].map((e) => e.name);
  assertEquals(files, [updated.attachment]);

  const down = await app.request(`/api/tasks/${task.id}/attachment`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(down.status, 200);
  assertEquals(down.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await down.arrayBuffer()), PNG);
});

Deno.test("no file is 400", async () => {
  const { app, token, task } = await setup();
  const res = await upload(app, token, task.id);
  assertEquals([res.status, (await res.json()).error], [400, "validation failed"]);
});

Deno.test("a file over 1 MB is 413", async () => {
  const { app, token, task } = await setup();
  const big = new Uint8Array(1_000_001);
  big.set(PNG); // a real PNG header, but too large
  const res = await upload(
    app,
    token,
    task.id,
    new File([big], "big.png", { type: "image/png" }),
  );
  assertEquals(res.status, 413);
});

Deno.test("a GIF is 415, and so is a text file that claims to be a PNG", async () => {
  const { app, token, task } = await setup();
  const gif = new File([new TextEncoder().encode("GIF89a....")], "a.gif", {
    type: "image/gif",
  });
  const fake = new File([new TextEncoder().encode("hello")], "a.png", {
    type: "image/png",
  });
  assertEquals((await upload(app, token, task.id, gif)).status, 415);
  assertEquals((await upload(app, token, task.id, fake)).status, 415);
});

Deno.test("another user can neither upload to nor download my attachment (404)", async () => {
  const { app, token, task } = await setup();
  await upload(app, token, task.id, new File([PNG], "a.png", { type: "image/png" }));
  const bob = await loginAs(app, "bob@example.com");
  const up = await upload(
    app,
    bob,
    task.id,
    new File([PNG], "a.png", { type: "image/png" }),
  );
  const down = await app.request(`/api/tasks/${task.id}/attachment`, {
    headers: { authorization: `Bearer ${bob}` },
  });
  assertEquals([up.status, down.status], [404, 404]);
});

Deno.test("a task without an attachment answers 404 on download", async () => {
  const { app, token, task } = await setup();
  const res = await app.request(`/api/tasks/${task.id}/attachment`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals([res.status, (await res.json()).error], [
    404,
    "this task has no attachment",
  ]);
});
