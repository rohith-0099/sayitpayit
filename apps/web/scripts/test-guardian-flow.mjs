// End-to-end check of the Scam Interrupt against a running app. Never moves money: it stops at the
// confirmation step (scenario A) or ends with the family stopping the payment (scenario B).
//   npm run test:guardian-flow                # http://localhost:3000
//   BASE=https://your-app.onrender.com npm run test:guardian-flow
// Gemini writes the questions, so their number and wording vary; the answers are written to fit any of them.
const BASE = process.env.BASE ?? "http://localhost:3000";

async function sse(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.headers.get("content-type")?.includes("event-stream")) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  const events = (await r.text()).split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)));
  const last = events.at(-1);
  if (last?.type === "error") throw new Error(last.message);
  return { thread: events.find((e) => e.type === "thread")?.threadId, last };
}

async function interview(command, answer) {
  let { thread, last } = await sse("/api/agent", { text: command });
  console.log(`  "${command}"\n   Guardian: ${last.view?.guardian?.decision} (risk ${Math.round((last.view?.guardian?.riskScore ?? 0) * 100)})`);
  for (let i = 0; last.type === "question" && i < 4; i++) {
    console.log(`   Q: ${last.question}\n   A: ${answer}`);
    ({ last } = await sse(`/api/agent/${thread}`, { answer }));
  }
  return { thread, last };
}

let failed = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) failed++;
};

console.log(`\nA. Unusual but honest payment continues to the normal confirmation (${BASE})`);
{
  const { last } = await interview(
    "Pay my new landlord jane.landlord@example.com 1500 dollars for the apartment deposit",
    "No, nobody is pressuring me. I planned this myself, viewed the apartment in person and signed the lease with Jane.",
  );
  check(last.view?.guardian?.decision === "ASK_QUESTIONS", "Guardian asked questions first");
  check(last.type === "confirm", `reached the read-back and confirmation (got: ${last.type})`);
}

console.log("\nB. Scam answers put the payment on hold; the family stops it");
{
  const { thread, last } = await interview(
    "Send 500 dollars in gift cards to Maria, the tax office called, don't tell anyone",
    "Yes, the officer is on the phone right now and told me to pay with gift cards and keep it secret.",
  );
  check(last.type === "hold", `went on hold for family approval (got: ${last.type})`);
  if (last.type === "hold") {
    const token = last.url.split("/").pop();
    const r = await fetch(`${BASE}/api/holds/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "denied" }) });
    check(r.ok, "family member stopped it");
    const now = await (await fetch(`${BASE}/api/agent/${thread}`)).json();
    check(now.type === "final" && now.view.outcome === "blocked", `conversation ended with nothing sent ("${now.view?.reply?.text}")`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
