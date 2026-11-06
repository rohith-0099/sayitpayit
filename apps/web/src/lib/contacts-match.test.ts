import assert from "node:assert/strict";
import { test } from "node:test";
import { matchContact, normalizeName } from "./contacts-match";

const c = (id: string, nickname: string, fullName: string | null, aliases: string[] = [], email = `${id}@x.com`) => ({
  id,
  nickname,
  fullName,
  aliases,
  paypalEmail: email,
});
const book = [
  c("john", "John", "John Miller", ["Johnny", "Jon"]),
  c("maria", "Maria", "Maria Schmidt", ["Mariya"]),
  c("ana", "Ana", "Ana López"),
  c("mom", "Mom", "Elena Rivera", ["Mum", "Mamá"]),
];

test("normalizeName strips accents and case", () => {
  assert.equal(normalizeName("  María! "), "maria");
  assert.equal(normalizeName("Mamá"), "mama");
});

test("matches nickname, alias, full name, first name, email", () => {
  for (const [q, id] of [
    ["maria", "maria"],
    ["MARÍA", "maria"],
    ["Mariya", "maria"],
    ["johnny", "john"],
    ["John Miller", "john"],
    ["Elena", "mom"],
    ["mama", "mom"],
    ["ana lopez", "ana"],
    ["maria@x.com", "maria"],
  ] as const) {
    const r = matchContact(q, book);
    assert.equal(r.kind, "exact", q);
    assert.equal(r.kind === "exact" && r.contact.id, id, q);
  }
});

test("prefix match needs 3+ chars and returns ambiguity instead of guessing", () => {
  assert.equal(matchContact("ma", book).kind, "none");
  const two = [...book, c("mark", "Mark", "Mark Lee")];
  const r = matchContact("mar", two);
  assert.equal(r.kind, "ambiguous");
  assert.deepEqual(r.kind === "ambiguous" && r.candidates.map((x) => x.id).sort(), ["maria", "mark"]);
});

test("unknown name → none", () => {
  assert.equal(matchContact("Zed", book).kind, "none");
  assert.equal(matchContact("", book).kind, "none");
});
