import assert from "node:assert/strict";
import { test } from "node:test";
import { equalShares, interpretWebhook, invoiceStatus, payoutItemStatus } from "./logic";

test("equalShares sums exactly and spreads cents", () => {
  const s = equalShares(100, 3);
  assert.deepEqual(s, [33.34, 33.33, 33.33]);
  assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 100), 10000);
  assert.deepEqual(equalShares(0.05, 2), [0.03, 0.02]);
  assert.throws(() => equalShares(10, 0));
  assert.throws(() => equalShares(-1, 2));
});

test("status mapping", () => {
  assert.equal(payoutItemStatus("SUCCESS"), "completed");
  assert.equal(payoutItemStatus("UNCLAIMED"), "unclaimed");
  assert.equal(payoutItemStatus("BLOCKED"), "failed");
  assert.equal(payoutItemStatus("PENDING"), "sent");
  assert.equal(invoiceStatus("PAID"), "completed");
  assert.equal(invoiceStatus("SENT"), "sent");
  assert.equal(invoiceStatus("DRAFT"), "pending");
});

test("interpretWebhook: invoice paid (nested v2 shape)", () => {
  const u = interpretWebhook({
    event_type: "INVOICING.INVOICE.PAID",
    resource: { invoice: { id: "INV2-AAA", status: "PAID", payments: { transactions: [{ payment_id: "PAY1" }] } } },
  });
  assert.deepEqual(u, { match: { paypalInvoiceId: "INV2-AAA" }, status: "completed", paypalTransactionId: "PAY1" });
});

test("interpretWebhook: payout item succeeded / failed", () => {
  const ok = interpretWebhook({
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource: { payout_item_id: "ITEM1", transaction_id: "T1", transaction_status: "SUCCESS", payout_item: { sender_item_id: "tx-1" } },
  });
  assert.equal(ok?.status, "completed");
  assert.deepEqual(ok?.match, { paypalItemId: "ITEM1", senderItemId: "tx-1" });

  const bad = interpretWebhook({
    event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
    resource: { payout_item_id: "ITEM2", transaction_status: "FAILED", errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver unregistered" } },
  });
  assert.equal(bad?.status, "failed");
  assert.equal(bad?.error, "Receiver unregistered");
});

test("interpretWebhook ignores unrelated events", () => {
  assert.equal(interpretWebhook({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "X" } }), null);
});
