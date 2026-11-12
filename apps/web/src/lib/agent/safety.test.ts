import assert from "node:assert/strict";
import { test } from "node:test";
import { guardKind } from "./safety";

test("closing/cancelling an invoice is never a payment", () => {
  for (const t of [
    "Can you close the 50 euro invoice we gave Maria",
    "cancel the invoice to John",
    "void the $200 request for John",
    "delete Maria's bill",
    "please withdraw the payment request I sent John",
    "cancela la factura de María",
    "Storniere die Rechnung an Maria",
    "annule la facture de Maria",
  ]) {
    assert.equal(guardKind("pay", t).kind, "cancel_invoice", t);
    assert.equal(guardKind("request", t).kind, "cancel_invoice", t);
  }
});

test("undo words without an invoice never move money", () => {
  assert.equal(guardKind("pay", "pay Maria 50 euros, no wait, cancel that").kind, "unknown");
  assert.equal(guardKind("split", "scrap the dinner split with John").kind, "unknown");
});

test("normal commands are untouched", () => {
  for (const [k, t] of [
    ["pay", "Pay Maria 50 euros for the logo"],
    ["request", "Ask John for $200 for the website"],
    ["split", "Split dinner with John and Maria"],
    ["pay", "Send 20 dollars to John for the closing party"],
    ["pay", "Drop John 20 bucks"],
  ] as const) {
    assert.deepEqual(guardKind(k, t), { kind: k, overridden: false }, t);
  }
  assert.deepEqual(guardKind("add_contact", "Add Priya, priya@example.com, she's family"), { kind: "add_contact", overridden: false });
  assert.deepEqual(guardKind("set_guardian", "make Elena my trusted guardian"), { kind: "set_guardian", overridden: false });
});
