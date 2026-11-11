import "server-only";
import { createHash } from "node:crypto";
import { requireEnv } from "../env";
import { guardianBase, guardianConfigured } from "../guardian-url";

// Natural female voice for the agent.
//  1. Kokoro-82M in the Guardian service (en, es, fr, hi, it, ja, pt, zh): fast, local, Apache-2.0.
//  2. Gemini TTS (free tier) for other languages (ml, ta, de...), soft "Achernar" voice.
// The browser's own speechSynthesis is the client-side last resort.
export const KOKORO_LANGS = new Set(["en", "es", "fr", "hi", "it", "ja", "pt", "zh"]);
const GEMINI_TTS_MODELS = (process.env.GEMINI_TTS_MODELS ?? "gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview").split(",");
const GEMINI_VOICE = process.env.GEMINI_TTS_VOICE ?? "Achernar"; // Google's "soft" voice

const cache = new Map<string, Buffer>();
const CACHE_MAX = 300;

function remember(key: string, wav: Buffer) {
  cache.set(key, wav);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return wav;
}

/** Wrap raw 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function kokoro(text: string, lang: string): Promise<Buffer | null> {
  if (!guardianConfigured()) return null; // lite mode: Gemini TTS / browser voice
  const base = guardianBase();
  try {
    const r = await fetch(`${base}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.GUARDIAN_API_KEY ? { "X-Guardian-Key": process.env.GUARDIAN_API_KEY } : {}) },
      body: JSON.stringify({ text, lang }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function gemini(text: string): Promise<Buffer | null> {
  for (const model of GEMINI_TTS_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
        // Text only: style instructions in the prompt get read aloud by some TTS models.
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } } },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) continue; // 429 quota / 503 overload: next model
      const part = (await r.json()).candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData;
      if (!part?.data) continue;
      const bytes = Buffer.from(part.data, "base64");
      if (String(part.mimeType).includes("wav")) return bytes;
      const rate = Number(/rate=(\d+)/.exec(part.mimeType)?.[1] ?? 24000);
      return pcmToWav(bytes, rate);
    } catch {
      continue;
    }
  }
  return null;
}

/** WAV audio for one sentence, or null if every engine is unavailable. */
export async function speech(text: string, lang: string): Promise<{ wav: Buffer; engine: "kokoro" | "gemini" | "cache" } | null> {
  const key = createHash("sha256").update(`${lang}|${text}`).digest("hex");
  const hit = cache.get(key);
  if (hit) return { wav: hit, engine: "cache" };
  if (KOKORO_LANGS.has(lang)) {
    const wav = await kokoro(text, lang);
    if (wav) return { wav: remember(key, wav), engine: "kokoro" };
  }
  const wav = await gemini(text);
  return wav ? { wav: remember(key, wav), engine: "gemini" } : null;
}
