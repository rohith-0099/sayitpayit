import assert from "node:assert/strict";
import { test } from "node:test";
import { guardianBase } from "./guardian-url";

test("guardianBase handles full URLs, Render host:port and unset", () => {
  const env = process.env.GUARDIAN_URL;
  process.env.GUARDIAN_URL = "sayitpayit-guardian-abc:10000";
  assert.equal(guardianBase(), "http://sayitpayit-guardian-abc:10000");
  process.env.GUARDIAN_URL = "https://guardian.example.com/";
  assert.equal(guardianBase(), "https://guardian.example.com");
  delete process.env.GUARDIAN_URL;
  assert.equal(guardianBase(), "http://localhost:8000");
  if (env !== undefined) process.env.GUARDIAN_URL = env;
});
