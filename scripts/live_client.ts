// Umut Berke Şenyayla, 2000002240
export {};
// Bonus 13: a small client that logs in and prints every live event it receives.
//   deno task live alice@example.com kadikoy-1907
// Start it in one terminal, then add or change tasks in the UI or with curl.
const [email = "alice@example.com", password = "kadikoy-1907"] = Deno.args;
const base = Deno.env.get("API") ?? "http://localhost:8000";

const res = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!res.ok) {
  console.error(`login failed: ${res.status} ${await res.text()}`);
  Deno.exit(1);
}
const { token } = await res.json();
const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws?token=${token}`);
ws.onopen = () => console.log(`connected as ${email}, waiting for changes...`);
ws.onmessage = (e) => {
  const { type, task } = JSON.parse(e.data);
  console.log(
    `${new Date().toLocaleTimeString()}  ${
      type.padEnd(8)
    } #${task.id} ${task.title} [${task.status}]`,
  );
};
ws.onclose = (e) => console.log(`closed (${e.code})`);
