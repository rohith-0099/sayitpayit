import assert from "node:assert/strict";
import { test } from "node:test";
import { numberWords, spokenMoney } from "./spoken";
import { currencyName, isPayPalCurrency } from "./paypal/currencies";

test("number words", () => {
  assert.equal(numberWords(0), "zero");
  assert.equal(numberWords(54), "fifty-four");
  assert.equal(numberWords(200), "two hundred");
  assert.equal(numberWords(1234), "one thousand two hundred thirty-four");
  assert.equal(numberWords(2_000_005), "two million five");
});

test("money the way people say it", () => {
  assert.equal(spokenMoney(0.5, "USD"), "fifty cents");
  assert.equal(spokenMoney(0.01, "USD"), "one cent");
  assert.equal(spokenMoney(2.5, "USD"), "two dollars fifty");
  assert.equal(spokenMoney(1, "USD"), "one dollar");
  assert.equal(spokenMoney(50, "EUR"), "fifty euros");
  assert.equal(spokenMoney(54.2, "USD"), "fifty-four dollars twenty");
  assert.equal(spokenMoney(1500, "JPY"), "one thousand five hundred yen");
  assert.equal(spokenMoney(19.999, "USD"), "twenty dollars");
  assert.equal(spokenMoney(50, "INR"), "fifty rupees");
  assert.match(spokenMoney(3, "SEK"), /^three Swedish/);
});

test("PayPal currency support", () => {
  assert.ok(isPayPalCurrency("eur"));
  assert.ok(isPayPalCurrency("USD"));
  assert.ok(!isPayPalCurrency("INR"));
  assert.equal(currencyName("INR"), "Indian rupees");
});
