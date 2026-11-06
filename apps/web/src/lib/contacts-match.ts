// Pure contact resolution for spoken names ("pay maria", "send mom 20"). Unit tested.

export interface MatchableContact {
  id: string;
  nickname: string;
  fullName: string | null;
  aliases: string[];
  paypalEmail: string;
}

/** Lowercase, strip accents and punctuation: "María" → "maria". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.\s-]/gu, "")
    .trim();
}

export type MatchResult<T> =
  | { kind: "exact"; contact: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "none" };

/**
 * Resolve a spoken/typed name or email to one contact.
 * Order: email → nickname/alias exact → full name / first name → prefix (≥3 chars).
 * Ambiguity is returned, never guessed: paying the wrong "John" is worse than asking.
 */
export function matchContact<T extends MatchableContact>(query: string, contacts: T[]): MatchResult<T> {
  const q = normalizeName(query);
  if (!q) return { kind: "none" };

  const tiers: ((c: T) => boolean)[] = [
    (c) => c.paypalEmail.toLowerCase() === q,
    (c) => normalizeName(c.nickname) === q || c.aliases.some((a) => normalizeName(a) === q),
    (c) => !!c.fullName && (normalizeName(c.fullName) === q || normalizeName(c.fullName).split(/\s+/)[0] === q),
    (c) =>
      q.length >= 3 &&
      [c.nickname, c.fullName ?? "", ...c.aliases].some((n) => normalizeName(n).startsWith(q)),
  ];

  for (const test of tiers) {
    const hits = contacts.filter(test);
    if (hits.length === 1) return { kind: "exact", contact: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  return { kind: "none" };
}
