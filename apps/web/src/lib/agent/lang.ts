// Which language to reply in. Pure; unit tested in lang.test.ts.
// Rule: reply in the language the user spoke, judged from the TRANSCRIPT TEXT first; Whisper's
// audio-based guess is only a tiebreaker (it misreads accented English as e.g. Tamil). Unsure → English.

export const SUPPORTED = ["en", "es", "ml", "ta", "hi", "de", "fr", "pt"] as const;
const LATIN = new Set(["en", "es", "de", "fr", "pt", "it"]);

const SCRIPTS: [RegExp, string][] = [
  [/[஀-௿]/u, "ta"], // Tamil
  [/[ഀ-ൿ]/u, "ml"], // Malayalam
  [/[ऀ-ॿ]/u, "hi"], // Devanagari
  [/[぀-ヿ]/u, "ja"], // Japanese kana
];

/** Language implied by a non-Latin script in the text, if any. */
export function scriptLanguage(text: string): string | null {
  for (const [re, lang] of SCRIPTS) if (re.test(text)) return lang;
  return null;
}

export function resolveLanguage(opts: { text: string; llm?: string | null; whisper?: string | null }): string {
  const script = scriptLanguage(opts.text);
  if (script) return script;
  // Latin-script text: a non-Latin guess (e.g. Whisper saying "ta" for English) can't be right.
  const llm = opts.llm?.toLowerCase().slice(0, 2);
  if (llm && LATIN.has(llm)) return llm;
  const whisper = opts.whisper?.toLowerCase().slice(0, 2);
  if (whisper && LATIN.has(whisper)) return whisper;
  return "en";
}

/** Whisper auto-detect is reliable for these; anything else on "Any language" gets re-checked as English. */
export const AUTO_DETECT_OK = new Set(["en", "es"]);
