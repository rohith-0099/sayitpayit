import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAnswer } from "./answers";

test("clear yes in several languages", () => {
  for (const s of ["Yes", "yes, send it", "Sí, envíalo", "Ja.", "അതെ", "ok go ahead"]) assert.equal(classifyAnswer(s), "yes", s);
});
test("any no wins, even mixed with yes", () => {
  for (const s of ["No", "cancel", "yes... no wait", "No, cancélalo", "വേണ്ട"]) assert.equal(classifyAnswer(s), "no", s);
});
test("anything else is unclear (never treated as yes)", () => {
  for (const s of ["", "hmm", "how much is that in rupees?", "yesterday"]) assert.equal(classifyAnswer(s), "unclear", s);
});
