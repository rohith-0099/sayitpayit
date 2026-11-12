// Which speech-to-text engine to trust. Pure, unit tested.
//
// Whisper is fast and great for clear single-language English/Spanish. It breaks on code-mixed
// speech (Hinglish, Manglish): it either forces one language ("Eek Kaam Keejee... Mariya Koo") or
// garbles both scripts. Gemini Flash transcribes code-mixed audio well, so it gets a second listen.

/** Languages people pick in the UI where code-mixing with English is the norm. */
export const INDIAN = new Set(["hi", "ml", "ta", "te", "kn", "bn", "mr", "gu", "pa", "ur"]);
/** Whisper's auto-detect is reliable for these when the audio is clear. */
const WHISPER_OK = new Set(["en", "es", "de", "fr", "pt", "it"]);

const LATIN = /\p{Script=Latin}/u;
const NON_LATIN = /[\p{Script=Devanagari}\p{Script=Malayalam}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Arabic}\p{Script=Sinhala}]/u;

export interface WhisperResult {
  text: string;
  language: string | null;
  avgLogprob?: number | null;
  compression?: number | null;
}

/** Use Gemini first (skip Whisper) when the user picked an Indian language. */
export const geminiFirst = (picked: string | undefined) => !!picked && INDIAN.has(picked);

/** Should Gemini re-transcribe this Whisper result? Returns the reason, or null to keep Whisper. */
export function secondOpinion(w: WhisperResult, picked?: string): string | null {
  const text = w.text.trim();
  if (!text) return "empty";
  if (LATIN.test(text) && NON_LATIN.test(text)) return "mixed scripts";
  if (typeof w.avgLogprob === "number" && w.avgLogprob < -0.6) return "low confidence";
  if (typeof w.compression === "number" && w.compression > 2.4) return "repetitive";
  // A picked Latin language (e.g. Spanish) means the user told us; trust a confident Whisper.
  if (picked && WHISPER_OK.has(picked)) return null;
  if (!w.language || !WHISPER_OK.has(w.language)) return `detected ${w.language ?? "nothing"}`;
  return null;
}
