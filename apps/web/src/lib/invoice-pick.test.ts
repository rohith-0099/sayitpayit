import assert from "node:assert/strict";
import { test } from "node:test";
import { pickInvoices, type PickableInvoice } from "./invoice-pick";

type OpenInvoice = PickableInvoice & { tx: { id: string } };

const inv = (id: string, contactId: string | null, name: string, amount: string, currency = "USD"): OpenInvoice =>
  ({ tx: { id, contactId, counterpartyName: name, counterpartyEmail: `${name.toLowerCase()}@x.com`, amount, currency }, nickname: contactId ? name : null }) as unknown as OpenInvoice;

const open = [inv("a", "john", "John", "3.00"), inv("b", "john", "John", "200.00"), inv("c", "maria", "Maria", "50.00", "EUR")];

test("a stated amount must match exactly (never offer John's $3 for '$20')", () => {
  assert.deepEqual(pickInvoices(open, { contactId: "john" }, 20, "USD"), []);
  assert.deepEqual(pickInvoices(open, { contactId: "john" }, 200, null).map((r) => r.tx.id), ["b"]);
});

test("by person, by email, by spoken name", () => {
  assert.deepEqual(pickInvoices(open, { contactId: "john" }, null, null).map((r) => r.tx.id), ["a", "b"]);
  assert.deepEqual(pickInvoices(open, { email: "maria@x.com" }, null, null).map((r) => r.tx.id), ["c"]);
  assert.deepEqual(pickInvoices(open, { name: "maria" }, 50, "EUR").map((r) => r.tx.id), ["c"]);
  assert.deepEqual(pickInvoices(open, { name: "maria" }, 50, "USD"), []);
});
