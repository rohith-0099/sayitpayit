import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiFirst, secondOpinion } from "./stt-route";

test("clear English / Spanish stays on Whisper", () => {
  assert.equal(secondOpinion({ text: "Pay Maria 2 euros for the coffee.", language: "en", avgLogprob: -0.2, compression: 1.1 }), null);
  assert.equal(secondOpinion({ text: "Mándale 5 euros a María.", language: "es", avgLogprob: -0.3 }), null);
});

test("code-mixed or garbled audio gets Gemini", () => {
  // the failing Hinglish example from live testing
  assert.equal(secondOpinion({ text: "Ekaam कीजिए, आप One Euro Mariah को सिन्ना कीजिए", language: "hi" }), "mixed scripts");
  assert.equal(secondOpinion({ text: "Eek Kaam Keejee, Aap 1 Euro Mariya Koo Send Keejee.", language: "hi" }), "detected hi");
  assert.equal(secondOpinion({ text: "Marriak 5 Euro Cent.", language: "en", avgLogprob: -0.9 }), "low confidence");
  assert.equal(secondOpinion({ text: "", language: "en" }), "empty");
  assert.equal(secondOpinion({ text: "send send send send", language: "en", compression: 3.1 }), "repetitive");
});

test("Indian language picker goes straight to Gemini", () => {
  assert.ok(geminiFirst("hi"));
  assert.ok(geminiFirst("ml"));
  assert.ok(!geminiFirst("en"));
  assert.ok(!geminiFirst(undefined));
});
