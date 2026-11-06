import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBase64 } from "./invoices";

// 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("extractBase64 parses PayPal's multipart QR response (real shape)", () => {
  const b = "--5e2a9820-efff-4bdc-b293-4ba362d5fe20";
  const raw = `${b}\r\nContent-Disposition: form-data; name="image"\r\nContent-Type: text/plain\r\n\r\n${PNG}\r\n${b}--`;
  const out = extractBase64(raw);
  assert.equal(out, PNG);
  assert.equal(Buffer.from(out, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("extractBase64 accepts plain base64 and rejects junk", () => {
  assert.equal(extractBase64(`${PNG}\n`), PNG);
  assert.throws(() => extractBase64("<html>nope</html>"));
  assert.throws(() => extractBase64({}));
});
