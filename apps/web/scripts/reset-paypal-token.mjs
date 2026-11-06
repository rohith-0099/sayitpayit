// PayPal reuses an app's access token until it expires (~9h), so permission/feature
// changes in the developer dashboard don't show up until then. This revokes the
// current sandbox token and prints the scopes on the fresh one.
// Usage: npm run paypal:reset-token   (then restart `npm run dev` to drop the in-memory cache)
const BASE = "https://api-m.sandbox.paypal.com";
const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");
const getToken = () =>
  fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).then((r) => r.json());

const old = await getToken();
const t = await fetch(`${BASE}/v1/oauth2/token/terminate`, {
  method: "POST",
  headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(old.access_token)}&token_type_hint=ACCESS_TOKEN`,
});
console.log(`Revoked old token: HTTP ${t.status}`);

const fresh = await getToken();
const scopes = fresh.scope.split(" ");
for (const k of ["payouts", "invoicing", "reporting", "vault/payment-tokens"]) {
  console.log(`${k.padEnd(22)} ${scopes.some((s) => s.includes(k)) ? "yes" : "MISSING"}`);
}
