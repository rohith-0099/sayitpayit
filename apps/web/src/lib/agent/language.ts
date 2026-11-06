import "server-only";
import { generateJson, generateText } from "../ai/gemini";

const NAMES: Record<string, string> = { en: "English", es: "Spanish", ml: "Malayalam", de: "German", fr: "French", hi: "Hindi", pt: "Portuguese", ja: "Japanese" };

/**
 * Say an English UI/voice line in the user's language. English passes through instantly;
 * other languages go through Gemini (and fall back to English if the AI is unavailable).
 */
export async function localize(english: string, language: string): Promise<string> {
  if (!language || language === "en") return english;
  try {
    return await generateText(
      [{ text: `Translate into ${NAMES[language] ?? language}. Keep names, numbers, currency symbols and amounts exactly as written. Natural, warm, spoken style. Output only the translation.\n\n${english}` }],
      { timeoutMs: 8000, temperature: 0.2 },
    );
  } catch {
    return english;
  }
}

/** Translate a whole read-back card (title, labels, notes, spoken line) in one call. Values stay as-is. */
export async function localizeCard<T extends { title: string; lines: { label: string; value: string }[]; notes: string[]; spoken: string }>(
  card: T,
  language: string,
): Promise<T> {
  if (!language || language === "en") return card;
  try {
    const out = await generateJson<{ title: string; labels: string[]; notes: string[]; spoken: string }>(
      [{ text: `Translate this payment confirmation into ${NAMES[language] ?? language}. Keep names, numbers, currency amounts and symbols exactly. Labels stay short. "Friends & Family" and "Goods & Services" are PayPal terms: translate them naturally. Return the same structure.\n\n${JSON.stringify({ title: card.title, labels: card.lines.map((l) => l.label), notes: card.notes, spoken: card.spoken })}` }],
      {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, labels: { type: "ARRAY", items: { type: "STRING" } }, notes: { type: "ARRAY", items: { type: "STRING" } }, spoken: { type: "STRING" } },
        required: ["title", "labels", "notes", "spoken"],
      },
      { timeoutMs: 9000 },
    );
    if (out.labels.length !== card.lines.length) throw new Error("label count mismatch");
    // Values that are words (type, purpose) are translated via the spoken line; keep amounts exact.
    return { ...card, title: out.title, lines: card.lines.map((l, i) => ({ ...l, label: out.labels[i] })), notes: out.notes, spoken: out.spoken };
  } catch {
    return { ...card, spoken: await localize(card.spoken, language) };
  }
}
