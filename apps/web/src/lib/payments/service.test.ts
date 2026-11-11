// Integration test: needs local Postgres (docker compose up -d). Skips without DATABASE_URL.
import assert from "node:assert/strict";
import { after, test } from "node:test";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // no .env.local (e.g. on Render): use the real environment
}
const skip = !process.env.DATABASE_URL;

test("applyWebhook updates the matching transaction once (idempotent)", { skip }, async () => {
  const { db, schema } = await import("../db");
  const { applyWebhook } = await import("./service");
  const { eq, inArray } = await import("drizzle-orm");
  const { transactions, webhookEvents } = schema;

  const [payTx] = await db
    .insert(transactions)
    .values({ type: "pay", status: "sent", amount: "5.00", currency: "USD", counterpartyEmail: "t@example.com", paypalBatchId: "TESTBATCH" })
    .returning();
  const [invTx] = await db
    .insert(transactions)
    .values({ type: "request", status: "sent", amount: "9.00", currency: "USD", counterpartyEmail: "t@example.com", paypalInvoiceId: `INV2-TEST-${Date.now()}` })
    .returning();
  const evIds = [`WH-TEST-PAYOUT-${Date.now()}`, `WH-TEST-INV-${Date.now()}`];

  after(async () => {
    await db.delete(webhookEvents).where(inArray(webhookEvents.id, evIds));
    await db.delete(transactions).where(inArray(transactions.id, [payTx.id, invTx.id]));
  });

  const payoutEvent = {
    id: evIds[0],
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource: { payout_item_id: "TESTITEM", transaction_id: "TESTTXN", transaction_status: "SUCCESS", payout_item: { sender_item_id: payTx.id } },
  };
  assert.deepEqual(await applyWebhook(payoutEvent), { duplicate: false, updated: 1 });
  assert.deepEqual(await applyWebhook(payoutEvent), { duplicate: true, updated: 0 });
  const [p] = await db.select().from(transactions).where(eq(transactions.id, payTx.id));
  assert.equal(p.status, "completed");
  assert.equal(p.paypalItemId, "TESTITEM");
  assert.equal(p.paypalTransactionId, "TESTTXN");

  const invEvent = {
    id: evIds[1],
    event_type: "INVOICING.INVOICE.PAID",
    resource: { invoice: { id: invTx.paypalInvoiceId, status: "PAID" } },
  };
  assert.deepEqual(await applyWebhook(invEvent), { duplicate: false, updated: 1 });
  const [i] = await db.select().from(transactions).where(eq(transactions.id, invTx.id));
  assert.equal(i.status, "completed");
});

after(async () => {
  if (skip) return;
  // Close the pool so the test process exits.
  const g = globalThis as unknown as { __sql?: { end: () => Promise<void> } };
  await g.__sql?.end();
});
