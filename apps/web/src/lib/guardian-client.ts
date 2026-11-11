import "server-only";
import { guardianBase, guardianConfigured } from "./guardian-url";

/** Thin client for the Guardian FastAPI service (services/guardian). */
const base = guardianBase;
const headers = () => (process.env.GUARDIAN_API_KEY ? { "X-Guardian-Key": process.env.GUARDIAN_API_KEY } : undefined);

export class GuardianUnavailable extends Error {}

async function post<T>(path: string, form: FormData, timeoutMs: number): Promise<T> {
  if (!guardianConfigured()) throw new GuardianUnavailable("Guardian isn't configured (lite mode)");
  let r: Response;
  try {
    r = await fetch(`${base()}${path}`, { method: "POST", body: form, headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new GuardianUnavailable(`Guardian service unreachable: ${e instanceof Error ? e.message : e}`);
  }
  const body = await r.json().catch(() => ({}));
  if (r.status >= 500) throw new GuardianUnavailable(`Guardian error ${r.status}`);
  if (!r.ok) throw Object.assign(new Error(body.detail ?? `Guardian rejected the request (${r.status})`), { status: r.status });
  return body as T;
}

export interface Enrollment {
  embedding: number[];
  model: string;
  samples: number;
  consistency: number;
  quality: { duration: number; speech_sec: number }[];
}

export function enrollVoice(samples: Blob[]) {
  const form = new FormData();
  samples.forEach((b, i) => form.append("samples", b, `sample${i + 1}.webm`));
  return post<Enrollment>("/voice/enroll", form, 60_000);
}

export type VoiceVerify =
  | { ok: false; reason: "too_short"; speech_sec: number }
  | {
      ok: true;
      speech_sec: number;
      speaker: { score: number; threshold: number; reject_below: number; match: boolean; verdict: "match" | "unsure" | "mismatch" };
      spoof: { score: number; threshold: number; suspect: boolean; model: string };
      phrase: { expected: string; heard: string; match: boolean } | null;
    };

export function verifyVoice(audio: Blob, embedding: number[], opts: { expectedPhrase?: string; transcript?: string } = {}) {
  const form = new FormData();
  form.append("audio", audio, "speech.webm");
  form.append("embedding", JSON.stringify(embedding));
  if (opts.expectedPhrase) form.append("expected_phrase", opts.expectedPhrase);
  if (opts.transcript !== undefined) form.append("transcript", opts.transcript);
  return post<VoiceVerify>("/voice/verify", form, 15_000);
}

export interface ScamResult {
  probability: number;
  label: "scam" | "normal";
  signals: { id: string; label: string }[];
  model: string;
}

/** Our fine-tuned multilingual scam classifier. Null when Guardian (or the model) is unavailable. */
export async function classifyScam(text: string): Promise<ScamResult | null> {
  if (!guardianConfigured()) return null;
  try {
    const r = await fetch(`${base()}/scam/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ text: text.slice(0, 1000) }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? ((await r.json()) as ScamResult) : null;
  } catch {
    return null;
  }
}
