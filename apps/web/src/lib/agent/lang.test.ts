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

test("Spanish text stays Spanish; unknown defaults to English", () => {
  assert.equal(resolveLanguage({ text: "Págale a María diez euros", llm: "es", whisper: "es" }), "es");
  assert.equal(resolveLanguage({ text: "Págale a María", llm: null, whisper: "es" }), "es");
  assert.equal(resolveLanguage({ text: "ok", llm: null, whisper: null }), "en");
});
