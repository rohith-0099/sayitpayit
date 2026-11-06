import "server-only";
import { ApiError } from "../errors";
import { requireEnv } from "../env";

export interface Transcript {
  text: string;
  /** ISO-639-1 when Whisper reports one (e.g. "es", "ml"). */
  language: string | null;
  durationSec: number | null;
}

// Whisper reports full language names in verbose_json.
const LANG: Record<string, string> = {
  english: "en", spanish: "es", german: "de", french: "fr", malayalam: "ml", hindi: "hi", tamil: "ta",
  japanese: "ja", portuguese: "pt", italian: "it", arabic: "ar", chinese: "zh", korean: "ko", dutch: "nl",
};

/** Speech-to-text with Groq Whisper (free tier: 20 RPM, 2K RPD). Retries 429 with Retry-After. */
export async function transcribe(audio: Blob, opts: { language?: string; prompt?: string } = {}): Promise<Transcript> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.append("file", audio, "speech.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (opts.language) form.append("language", opts.language);
    // Biases spelling of names/currencies without forcing a language.
    if (opts.prompt) form.append("prompt", opts.prompt.slice(0, 400));

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("GROQ_API_KEY")}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429 && attempt < 2) {
      const wait = Number(r.headers.get("retry-after")) || 2 ** attempt;
      await new Promise((res) => setTimeout(res, Math.min(wait, 8) * 1000));
      continue;
    }
    const json = await r.json().catch(() => ({}));
    if (r.status === 429) throw new ApiError(503, "Speech-to-text is rate-limited (Groq free tier). Wait a few seconds and try again.", { code: "STT_RATE_LIMIT" });
    if (!r.ok) throw new ApiError(502, `Speech-to-text failed: ${json.error?.message ?? r.status}`);
    const lang = typeof json.language === "string" ? json.language.toLowerCase() : null;
    return {
      text: String(json.text ?? "").trim(),
      language: lang ? (LANG[lang] ?? (lang.length === 2 ? lang : null)) : null,
      durationSec: typeof json.duration === "number" ? json.duration : null,
    };
  }
  throw new ApiError(503, "Speech-to-text unavailable. Try again.");
}
