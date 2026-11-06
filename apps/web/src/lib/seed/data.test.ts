import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSeed, SEED_CONTACTS } from "./data";

const now = new Date("2026-11-06T12:00:00Z");

test("seed is deterministic", () => {
  assert.deepEqual(generateSeed(now), generateSeed(now));
});

test("history covers ~60 days, in the past, with sane amounts", () => {
  const { txs } = generateSeed(now);
  assert.ok(txs.length >= 30, `only ${txs.length} txs`);
  const oldest = (now.getTime() - txs[0].createdAt.getTime()) / 86_400_000;
  assert.ok(oldest > 50 && oldest <= 61, `oldest ${oldest} days`);
  for (const t of txs) {
    assert.ok(t.createdAt <= now, "future tx");
    assert.ok(t.amount > 0 && t.homeAmount > 0);
    assert.match(t.currency, /^[A-Z]{3}$/);
    if (t.type === "pay") assert.equal(t.currency, SEED_CONTACTS[t.contact].currency, "pays go in the contact's currency");
    assert.ok(t.riskScore >= 0 && t.riskScore <= 1);
  }
});

test("splits add up: members' shares + my share = total", () => {
  const { splits, txs } = generateSeed(now);
  for (const s of splits) {
    const sum = s.members.reduce((a, m) => a + m.share, 0) + s.myShare;
    assert.equal(Math.round(sum * 100), Math.round(s.total * 100), s.title);
    assert.equal(txs.filter((t) => t.splitKey === s.key).length, s.members.length);
  }
});

test("every outgoing payment has exactly one guardian event; one was questioned", () => {
  const { txs, events } = generateSeed(now);
  const pays = txs.filter((t) => t.type === "pay");
  assert.equal(events.length, pays.length);
  assert.equal(events.filter((e) => e.decision === "ASK_QUESTIONS").length, 1);
});

test("there is something open for the 'who owes what' board", () => {
  const { txs } = generateSeed(now);
  assert.ok(txs.some((t) => t.type !== "pay" && t.status === "sent"));
});
