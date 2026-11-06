import "server-only";
import { ApiError } from "../errors";
import { requireEnv } from "../env";

// Fast models first: the agent should feel live on camera. Override with GEMINI_MODELS.
// (Checked 2026-11-06: 3.5-flash-lite ≈1s; newer Flash models were overloaded/slow.)
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash"];
const models = () => (process.env.GEMINI_MODELS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_MODELS);

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** JSON-schema subset Gemini accepts as responseSchema (OpenAPI-style types). */
export type GeminiSchema = Record<string, unknown>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(model: string, body: unknown, timeoutMs: number) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, retryAfter: Number(r.headers.get("retry-after")) || 0 };
}

/**
 * generateContent with model fallback and backoff. 429/503/timeouts move to the next model;
 * after the list is exhausted we retry the list once. Throws a clear 503 ApiError if all fail.
 */
async function generate(parts: Part[], config: Record<string, unknown>, opts: { system?: string; timeoutMs?: number } = {}) {
  const body = {
    contents: [{ role: "user", parts }],
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    generationConfig: { temperature: 0.2, ...config },
  };
  let lastErr = "";
  for (let round = 0; round < 2; round++) {
    for (const model of models()) {
      try {
        const { status, json, retryAfter } = await call(model, body, opts.timeoutMs ?? 12_000);
        if (status === 200) {
          const text: string | undefined = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
          if (text) return { text, model };
          lastErr = `${model}: empty response (${json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "unknown"})`;
          continue;
        }
        lastErr = `${model}: HTTP ${status} ${json.error?.message ?? ""}`.slice(0, 200);
        if (status === 429 || status >= 500) {
          if (retryAfter) await sleep(Math.min(retryAfter, 5) * 1000);
          continue;
        }
        if (status === 404) continue; // model retired for this key
        throw new ApiError(502, `Gemini error: ${lastErr}`);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        lastErr = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    await sleep(800 * (round + 1));
  }
  throw new ApiError(503, "The AI is busy right now (Gemini free-tier limit or overload). Try again in a few seconds.", {
    code: "LLM_UNAVAILABLE",
    last: lastErr,
  });
}

export async function generateJson<T>(parts: Part[], schema: GeminiSchema, opts: { system?: string; timeoutMs?: number } = {}): Promise<T> {
  const { text } = await generate(parts, { responseMimeType: "application/json", responseSchema: schema }, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(502, "The AI returned malformed JSON. Try again.");
  }
}

export async function generateText(parts: Part[], opts: { system?: string; timeoutMs?: number; temperature?: number } = {}) {
  const { text } = await generate(parts, { temperature: opts.temperature ?? 0.4 }, opts);
  return text.trim();
}
