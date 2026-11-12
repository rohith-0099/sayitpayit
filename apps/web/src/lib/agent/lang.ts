// Which language to reply in. Pure; unit tested in lang.test.ts.
// Rule: reply in the language the user spoke, judged from the TRANSCRIPT TEXT first; Whisper's
// audio-based guess is only a tiebreaker (it misreads accented English as e.g. Tamil). Unsure → English.

export const SUPPORTED = ["en", "es", "ml", "ta", "hi", "de", "fr", "pt"] as const;
const LATIN = new Set(["en", "es", "de", "fr", "pt", "it"]);
/** Languages commonly typed/spoken in Latin letters (Hinglish, Manglish, Tanglish). */
const ROMANIZED_OK = new Set(["hi", "ml", "ta"]);

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
  // Latin-script text. The LLM reads the words, so it can tell romanized Hinglish/Manglish ("Maria-kku
  // 5 euro send cheyyu" → ml) from English. Whisper's audio guess can't: it calls accented English
  // "ta", so a non-Latin Whisper guess is never trusted for Latin text.
  const llm = opts.llm?.toLowerCase().slice(0, 2);
  if (llm && (LATIN.has(llm) || ROMANIZED_OK.has(llm))) return llm;
  const whisper = opts.whisper?.toLowerCase().slice(0, 2);
  if (whisper && LATIN.has(whisper)) return whisper;
  return "en";
}

