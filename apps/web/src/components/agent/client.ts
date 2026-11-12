"use client";

import type { AgentEvent } from "@/lib/agent/run";

/** POST JSON and read the Server-Sent Events stream. JSON error responses throw. */
export async function postStream(url: string, body: unknown, onEvent: (e: AgentEvent) => void) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body || !r.headers.get("content-type")?.includes("event-stream")) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${r.status})`);
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as AgentEvent);
    }
  }
}

export interface VoiceCheckSummary {
  checkId: string;
  status: string;
  speakerMatch: boolean | null;
  speakerScore: number | null;
  spoofSuspect: boolean | null;
  phraseMatch: boolean | null;
}

export async function transcribeAudio(blob: Blob, language: string, opts: { kind?: "command" | "answer"; threadId?: string | null } = {}) {
  const form = new FormData();
  form.append("audio", blob, "speech.webm");
  if (language !== "auto") form.append("language", language);
  form.append("kind", opts.kind ?? "command");
  if (opts.threadId) form.append("threadId", opts.threadId);
  const r = await fetch("/api/stt", { method: "POST", body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? "Couldn't transcribe that.");
  return body as { text: string; language: string | null; voice: VoiceCheckSummary | null };
}

const BCP47: Record<string, string> = { en: "en-US", es: "es-ES", ml: "ml-IN", ta: "ta-IN", de: "de-DE", hi: "hi-IN", fr: "fr-FR" };

// ---------- The agent's voice ----------

let muted = false;
const MUTE_KEY = "sip-mute";

export function isMuted() {
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    /* storage blocked: keep the in-memory value */
  }
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (m) stopSpeaking();
}

let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** Call from a click/tap so audio can play later without the browser blocking it. */
export function primeAudio() {
  const c = audioCtx();
  if (c && c.state === "suspended") void c.resume();
}

let current: { stop: () => void } | null = null;

/** Stop whatever the agent is saying (e.g. the user tapped the mic). */
export function stopSpeaking() {
  current?.stop();
  current = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

function browserSpeak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[lang] ?? lang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

/** 16-bit little-endian PCM → float samples. */
function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/**
 * Speak one short line with the agent's voice (/api/tts: Kokoro locally, Gemini when hosted).
 * Gemini audio is streamed and played chunk by chunk as it arrives, so speech starts in about a
 * second. One request per line (free-tier TTS quotas are per request). Falls back to the browser
 * voice if no engine is available. Resolves when done, interrupted, or muted.
 */
export async function speak(text: string, lang: string): Promise<void> {
  stopSpeaking();
  if (typeof window === "undefined" || !text || isMuted()) return;
  const ac = new AbortController();
  const sources: AudioBufferSourceNode[] = [];
  let stopped = false;
  let finish: () => void = () => {};
  const me = {
    stop: () => {
      stopped = true;
      ac.abort();
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          /* not started */
        }
      }
      finish();
    },
  };
  current = me;
  try {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }), signal: ac.signal });
    const c = audioCtx();
    if (!r.ok || !r.body || !c) {
      if (!stopped) await browserSpeak(text, lang);
      return;
    }
    if (c.state === "suspended") await c.resume().catch(() => {});
    const type = r.headers.get("content-type") ?? "";
    const done = new Promise<void>((res) => (finish = res));
    let end = c.currentTime + 0.08;
    const play = (buf: AudioBuffer) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      const at = Math.max(end, c.currentTime + 0.02);
      src.start(at);
      end = at + buf.duration;
      sources.push(src);
      return src;
    };

    if (type.startsWith("audio/pcm")) {
      const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
      const reader = r.body.getReader();
      let carry: Uint8Array | null = null;
      let last: AudioBufferSourceNode | null = null;
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof || stopped) break;
        let bytes: Uint8Array = value;
        if (carry) {
          const joined = new Uint8Array(carry.length + bytes.length);
          joined.set(carry);
          joined.set(bytes, carry.length);
          bytes = joined;
          carry = null;
        }
        if (bytes.length % 2) {
          carry = bytes.slice(-1);
          bytes = bytes.subarray(0, bytes.length - 1);
        }
        if (!bytes.length) continue;
        const samples = pcm16ToFloat(bytes);
        const buf = c.createBuffer(1, samples.length, rate);
        buf.getChannelData(0).set(samples);
        last = play(buf);
      }
      if (!last || stopped) return;
      last.onended = () => finish();
    } else {
      const buf = await c.decodeAudioData(await r.arrayBuffer());
      if (stopped) return;
      play(buf).onended = () => finish();
    }
    await done;
  } catch {
    // aborted (stopSpeaking) or decode failure
  } finally {
    if (current === me) current = null;
  }
}

/** Downscale a photo to ≤1600px JPEG data URL (keeps Gemini vision fast). */
export async function fileToDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
