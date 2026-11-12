import "server-only";
import { createHash } from "node:crypto";
import { requireEnv } from "../env";
import { guardianBase, guardianConfigured } from "../guardian-url";

// Natural female voice for the agent.
//  1. Kokoro-82M in the Guardian service (en, es, fr, hi, it, ja, pt, zh): fast, local, Apache-2.0.
//  2. Gemini TTS (free tier), soft "Achernar" voice: the hosted/lite-mode voice and every other language.
//     Streamed: the first audio arrives in ~1s instead of ~4s for the whole clip.
// The browser's own speechSynthesis is the client-side last resort.
//
// Free-tier Gemini TTS allows ~10 requests per model per day, so: one request per reply (never per
// sentence), replies are one short sentence, everything is cached, and a model that hit its quota
// is skipped until its retry time instead of being retried on every line.
export const KOKORO_LANGS = new Set(["en", "es", "fr", "hi", "it", "ja", "pt", "zh"]);
const GEMINI_TTS_MODELS = (process.env.GEMINI_TTS_MODELS ?? "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_VOICE = process.env.GEMINI_TTS_VOICE ?? "Achernar"; // Google's "soft" voice

const cache = new Map<string, Buffer>();
const CACHE_MAX = 300;
/** model → epoch ms when its quota is back. */
const cooldown = new Map<string, number>();

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

/** Seconds until quota returns, from a 429 body ("retryDelay": "82245s"). */
function retryAfterMs(body: string): number {
  const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(body);
  return m ? Math.min(Number(m[1]) * 1000, 24 * 3600_000) : 60_000;
}

/** A Gemini TTS generation in progress: chunks so far, shared by everyone who asks for the same line. */
export class LiveSpeech {
  chunks: Buffer[] = [];
  done = false;
  sampleRate = 24000;
  engine = "gemini";
  private waiters = new Set<() => void>();
  private resolveFirst!: (ok: boolean) => void;
  /** Resolves true at the first audio chunk, false if every model failed. */
  first = new Promise<boolean>((r) => (this.resolveFirst = r));

  push(b: Buffer) {
    if (!this.chunks.length) this.resolveFirst(true);
    this.chunks.push(b);
    this.wake();
  }
  finish() {
    this.done = true;
    this.resolveFirst(this.chunks.length > 0);
    this.wake();
  }
  private wake() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }
  /** Replay what's buffered, then follow along until done. */
  stream(): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream({
      pull: async (controller) => {
        while (i >= this.chunks.length && !this.done) await new Promise<void>((r) => this.waiters.add(r));
        if (i < this.chunks.length) controller.enqueue(new Uint8Array(this.chunks[i++]));
        else controller.close();
      },
    });
  }
}

const live = new Map<string, LiveSpeech>();

async function runGemini(text: string, out: LiveSpeech) {
  for (const model of GEMINI_TTS_MODELS) {
    if ((cooldown.get(model) ?? 0) > Date.now()) continue;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
        // Text only: style instructions in the prompt get read aloud by some TTS models.
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE } } } },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.status === 429) {
        cooldown.set(model, Date.now() + retryAfterMs(await r.text()));
        continue;
      }
      if (!r.ok || !r.body) continue; // 503 overload etc.: next model
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
          if (!frame.startsWith("data:")) continue;
          const part = JSON.parse(frame.slice(5)).candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData;
          if (!part?.data) continue;
          const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? 24000);
          out.sampleRate = rate;
          out.engine = model;
          out.push(Buffer.from(part.data, "base64"));
        }
      }
      if (out.chunks.length) return;
    } catch {
      if (out.chunks.length) return; // cut off mid-way: keep what we have
    }
  }
}

function startGemini(key: string, text: string): LiveSpeech {
  const existing = live.get(key);
  if (existing) return existing;
  const out = new LiveSpeech();
  live.set(key, out);
  void runGemini(text, out).finally(() => {
    out.finish();
    live.delete(key);
    if (out.chunks.length) remember(key, pcmToWav(Buffer.concat(out.chunks), out.sampleRate));
  });
  return out;
}

const keyOf = (text: string, lang: string) => createHash("sha256").update(`${lang}|${text}`).digest("hex");
const kokoroInFlight = new Map<string, Promise<Buffer | null>>();

function kokoroOnce(key: string, text: string, lang: string) {
  let p = kokoroInFlight.get(key);
  if (!p) {
    p = kokoro(text, lang).then((wav) => (wav ? remember(key, wav) : null));
    kokoroInFlight.set(key, p);
    void p.finally(() => kokoroInFlight.delete(key));
  }
  return p;
}

export type Speech = { kind: "wav"; wav: Buffer; engine: string } | { kind: "live"; live: LiveSpeech };

/** Audio for one short line: a cached/Kokoro WAV, or a live Gemini stream. Null if no engine can speak. */
export async function speech(text: string, lang: string): Promise<Speech | null> {
  const key = keyOf(text, lang);
  const hit = cache.get(key);
  if (hit) return { kind: "wav", wav: hit, engine: "cache" };
  const inFlight = live.get(key);
  if (inFlight) return { kind: "live", live: inFlight };
  if (KOKORO_LANGS.has(lang) && guardianConfigured()) {
    const wav = await kokoroOnce(key, text, lang);
    if (wav) return { kind: "wav", wav, engine: "kokoro" };
  }
  const g = startGemini(key, text);
  return (await g.first) ? { kind: "live", live: g } : null;
}

/**
 * Start generating a line the browser is about to ask for (called when the agent's reply is
 * ready, before the event reaches the browser), so audio starts the moment the text appears.
 */
export function prefetchSpeech(text: string, lang: string) {
  if (!text) return;
  const key = keyOf(text, lang);
  if (cache.has(key) || live.has(key) || kokoroInFlight.has(key)) return;
  if (KOKORO_LANGS.has(lang) && guardianConfigured()) {
    void kokoroOnce(key, text, lang).then((wav) => {
      if (!wav) startGemini(key, text);
    });
  } else {
    startGemini(key, text);
  }
}
