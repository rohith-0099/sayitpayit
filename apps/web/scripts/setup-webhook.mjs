// Register (or re-point) the SayItPayIt PayPal sandbox webhook and save its id to .env.local.
// Usage: npm run webhook:setup -- https://<public-host>
// The URL must be public HTTPS (e.g. a tunnel you start yourself locally, or the Render URL in prod).
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://api-m.sandbox.paypal.com";
const EVENTS = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTSBATCH.DENIED",
];

const host = process.argv[2];
if (!host?.startsWith("https://")) {
  console.error("Usage: npm run webhook:setup -- https://<public-host>");
  process.exit(1);
}
const url = new URL("/api/webhooks/paypal", host).toString();

const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
const tok = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
}).then((r) => r.json());
const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

const { webhooks = [] } = await fetch(`${BASE}/v1/notifications/webhooks`, { headers: H }).then((r) => r.json());
const ours = webhooks.find((w) => w.url.endsWith("/api/webhooks/paypal"));

let id;
if (ours) {
  const r = await fetch(`${BASE}/v1/notifications/webhooks/${ours.id}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify([
      { op: "replace", path: "/url", value: url },
      { op: "replace", path: "/event_types", value: EVENTS.map((name) => ({ name })) },
    ]),
  });
  if (!r.ok) throw new Error(`Update failed ${r.status}: ${await r.text()}`);
  id = ours.id;
  console.log(`Updated webhook ${id} -> ${url}`);
} else {
  const r = await fetch(`${BASE}/v1/notifications/webhooks`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Create failed ${r.status}: ${JSON.stringify(body)}`);
  id = body.id;
  console.log(`Created webhook ${id} -> ${url}`);
}

// PAYPAL_WEBHOOK_ID is a public identifier, not a secret; still kept in .env.local with the rest.
const envPath = new URL("../.env.local", import.meta.url);
const env = readFileSync(envPath, "utf8");
const next = /^PAYPAL_WEBHOOK_ID=.*$/m.test(env)
  ? env.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, `PAYPAL_WEBHOOK_ID=${id}`)
  : `${env.trimEnd()}\nPAYPAL_WEBHOOK_ID=${id}\n`;
writeFileSync(envPath, next);
console.log("Saved PAYPAL_WEBHOOK_ID to .env.local. Restart `npm run dev` to pick it up.");
