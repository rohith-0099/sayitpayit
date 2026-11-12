import "server-only";
import { generateJson } from "./gemini";
import type { Transcript } from "./groq";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    language: { type: "STRING" },
    clear: { type: "BOOLEAN" },
  },
  required: ["text", "language", "clear"],
};

const SYSTEM = `You transcribe short voice commands for a payment app. People often mix languages in one sentence:
Hinglish (Hindi + English), Manglish (Malayalam + English), Tanglish, Spanglish.
- Write exactly what was said, word for word. Do not translate, correct, or complete anything.
- English words stay in English (Latin script): "send", "one euro", "invoice".
- Hindi, Malayalam, Tamil... words go in their own script (Devanagari, Malayalam, Tamil...). Spanish stays Latin.
- Names in Latin script, spelled like the contact list when it's clearly the same person ("Mariah" → "Maria").
- Numbers as digits.
- language: ISO 639-1 code of the MAIN language (the grammar of the sentence): Hinglish → "hi", Manglish → "ml", Spanglish → "es", plain English → "en".
- clear: false if the audio is mostly noise, cut off, or you are guessing at the words. Never invent a command.`;

/** Transcribe (possibly code-mixed) speech with Gemini Flash. Throws if Gemini is unavailable. */
export async function transcribeWithGemini(audio: Blob, opts: { contacts: string[]; hint?: string }): Promise<Transcript & { clear: boolean }> {
  const data = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const mimeType = (audio.type || "audio/webm").split(";")[0];
  const out = await generateJson<{ text: string; language: string; clear: boolean }>(
    [
      { inlineData: { mimeType, data } },
      { text: `Contacts: ${opts.contacts.join(", ")}.${opts.hint ? ` The user said they speak ${opts.hint} (maybe mixed with English).` : ""}` },
    ],
    SCHEMA,
    { system: SYSTEM, timeoutMs: 15_000 },
  );
  return {
    text: (out.text ?? "").trim(),
    language: (out.language || "en").toLowerCase().slice(0, 2),
    durationSec: null,
    engine: "gemini",
    clear: out.clear !== false && !!out.text?.trim(),
  };
}
