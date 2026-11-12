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
/** Edit distance with adjacent swaps counted as one edit ("Jhon" → "John" = 1). Small strings only. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "Maria-kku", "Maria ko", "mariyakku" → "maria"-ish: drop Hindi/Malayalam case endings spoken after a name. */
export function stripCaseEnding(q: string): string {
  return q
    .replace(/[-\s]+(ko|ke|ki|ka|se|ne|kku|kk|nu|inu|ne|de|para)$/u, "")
    .replace(/(kku|kk|ykku|nu)$/u, "")
    .trim();
}

export function matchContact<T extends MatchableContact>(query: string, contacts: T[]): MatchResult<T> {
  const raw = normalizeName(query);
  if (!raw) return { kind: "none" };
  // Case endings from code-mixed speech ("Maria-kku", "Maria ko") are not part of the name.
  const q = raw.includes("@") ? raw : stripCaseEnding(raw) || raw;
  const firsts = (c: T) => [c.nickname, c.fullName ?? "", ...c.aliases].filter(Boolean).map((n) => normalizeName(n).split(/\s+/)[0]);
  // Speech recognition misspells names ("Mariah", "Mariya"): allow 1 edit (2 for long names), never for short ones.
  const close = (a: string, b: string) => a.length >= 4 && b.length >= 4 && editDistance(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1);

  const tiers: ((c: T) => boolean)[] = [
    (c) => c.paypalEmail.toLowerCase() === q,
    (c) => normalizeName(c.nickname) === q || c.aliases.some((a) => normalizeName(a) === q),
    (c) => !!c.fullName && (normalizeName(c.fullName) === q || normalizeName(c.fullName).split(/\s+/)[0] === q),
    (c) =>
      q.length >= 3 &&
      [c.nickname, c.fullName ?? "", ...c.aliases].some((n) => normalizeName(n).startsWith(q)),
    (c) => firsts(c).some((n) => close(n, q.split(/\s+/)[0])),
  ];

  for (const test of tiers) {
    const hits = contacts.filter(test);
    if (hits.length === 1) return { kind: "exact", contact: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  return { kind: "none" };
}
