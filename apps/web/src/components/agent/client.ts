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

const BCP47: Record<string, string> = { en: "en-US", es: "es-ES", ml: "ml-IN", de: "de-DE", hi: "hi-IN", fr: "fr-FR" };

/** Speak with the browser's built-in TTS in the reply's language. Resolves when done. */
export function speak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP47[lang] ?? lang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
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
