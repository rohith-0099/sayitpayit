const BASE = "https://api-m.sandbox.paypal.com";
const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");

const t = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
const { access_token } = await t.json();
console.log("Token OK:", !!access_token);

const r = await fetch(`${BASE}/v1/payments/payouts`, {
  method: "POST",
  headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    sender_batch_header: { sender_batch_id: `batch_${Date.now()}`, email_subject: "You got paid via SayItPayIt" },
    items: [{
      recipient_type: "EMAIL",
      amount: { value: "10.00", currency: "USD" },
      receiver: "sb-avlzc53756906@personal.example.com",
      note: "Test payout",
    }],
  }),
});
console.log(r.status, JSON.stringify(await r.json(), null, 2));
