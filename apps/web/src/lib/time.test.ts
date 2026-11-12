import assert from "node:assert/strict";
import { test } from "node:test";
import { localHour, validTimeZone } from "./time";

test("2 PM in India is not night (it was 3:30 AM in New York)", () => {
  const twoPmIst = new Date("2026-11-12T08:30:00Z");
  assert.equal(localHour("Asia/Kolkata", twoPmIst), 14);
  assert.equal(localHour("America/New_York", twoPmIst), 3);
});

test("only real IANA zones are accepted", () => {
  assert.equal(validTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  assert.equal(validTimeZone("Mars/Olympus"), null);
  assert.equal(validTimeZone(""), null);
});
