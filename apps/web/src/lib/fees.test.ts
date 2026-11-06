import assert from "node:assert/strict";
import { test } from "node:test";
import { quote } from "./fees";

const base = { homeCurrency: "USD", senderCountry: "US" };

test("domestic F&F: no fees", () => {
  const q = quote({ ...base, amount: 20, currency: "USD", rate: 1, category: "friends_family", recipientCountry: "US" });
  assert.equal(q.total, 20);
  assert.deepEqual(q.fees, []);
  assert.equal(q.categoryLabel, "Friends & Family");
});

test("Maria, €50 G&S cross-border: conversion spread only, recipient gets exactly €50", () => {
  const q = quote({ ...base, amount: 50, currency: "EUR", rate: 1.1224, category: "business", recipientCountry: "DE" });
  assert.deepEqual(q.recipientReceives, { amount: 50, currency: "EUR" });
  assert.equal(q.base, 56.12);
  assert.deepEqual(q.fees.map((f) => [f.id, f.amount]), [["conversion", 2.24]]);
  assert.equal(q.total, 58.36);
});

test("international F&F fee is clamped to [0.99, 4.99]", () => {
  const small = quote({ ...base, amount: 100, currency: "MXN", rate: 0.054, category: "friends_family", recipientCountry: "MX" });
  assert.equal(small.fees.find((f) => f.id === "international")?.amount, 0.99);
  const big = quote({ ...base, amount: 9000, currency: "MXN", rate: 0.054, category: "friends_family", recipientCountry: "MX" });
  assert.equal(big.fees.find((f) => f.id === "international")?.amount, 4.99);
  assert.equal(big.total, Math.round((486 + 19.44 + 4.99) * 100) / 100);
});
