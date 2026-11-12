import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLanguage, scriptLanguage } from "./lang";

test("script in the text decides", () => {
  assert.equal(scriptLanguage("ജോണിന് പത്ത് ഡോളർ"), "ml");
  assert.equal(scriptLanguage("ஜானுக்கு பத்து டாலர்"), "ta");
  assert.equal(resolveLanguage({ text: "ജോണിന് പത്ത് ഡോളർ", llm: "en", whisper: "en" }), "ml");
});

test("English text misheard as Tamil by Whisper replies in English", () => {
  assert.equal(resolveLanguage({ text: "Pay Maria ten euros", llm: "en", whisper: "ta" }), "en");
  assert.equal(resolveLanguage({ text: "Pay Maria ten euros", llm: null, whisper: "ta" }), "en");
});

test("code-mixed Indian languages reply in the main language", () => {
  assert.equal(resolveLanguage({ text: "एक काम कीजिए आप 1 Euro Maria को send कीजिए", llm: "hi", whisper: "hi" }), "hi");
  assert.equal(resolveLanguage({ text: "Maria-kku 5 euro send cheyyu", llm: "ml", whisper: "en" }), "ml");
  assert.equal(resolveLanguage({ text: "Ek kaam kijiye, aap one euro Maria ko send kijiye", llm: "hi", whisper: null }), "hi");
});

test("Spanish text stays Spanish; unknown defaults to English", () => {
  assert.equal(resolveLanguage({ text: "Págale a María diez euros", llm: "es", whisper: "es" }), "es");
  assert.equal(resolveLanguage({ text: "Págale a María", llm: null, whisper: "es" }), "es");
  assert.equal(resolveLanguage({ text: "ok", llm: null, whisper: null }), "en");
});
