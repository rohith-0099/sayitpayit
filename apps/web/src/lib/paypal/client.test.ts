import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicHostname, money } from "./client";

test("client-token domain binding only for public hostnames (PayPal rejects the rest)", () => {
  for (const h of ["newly-latter-facilitate-finding.trycloudflare.com", "sayitpayit.onrender.com", "example.com:443"])
    assert.equal(isPublicHostname(h), true, h);
  for (const h of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000", "app.localhost", "https://example.com"])
    assert.equal(isPublicHostname(h), false, h);
});

test("money formats per currency", () => {
  assert.deepEqual(money(5, "usd"), { currency_code: "USD", value: "5.00" });
  assert.deepEqual(money(15000, "JPY"), { currency_code: "JPY", value: "15000" });
});
