import { randomUUID } from "node:crypto";
import type { AgAiConversationItem, AgAiOutputItem, AgAiToolSchema, AgLlmRequest } from "ag-studio";
import { requireEnv } from "@/lib/env";

// One AG Studio AI turn on Gemini (free tier). AG Studio runs the agent loop in the browser and
// sends each turn here; we translate to Gemini generateContent + function calling and back. The key
// never leaves the server. Models: tool use needs the stronger Flash first; override GEMINI_STUDIO_MODELS.
const MODELS = (process.env.GEMINI_STUDIO_MODELS ?? "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-latest").split(",").map((s) => s.trim());

// Gemini 3 wants each function call's thought signature echoed back on the next turn.
const signatures = new Map<string, string>();
const SKIP_SIGNATURE = "skip_thought_signature_validator";

type Part = { text?: string; functionCall?: { name: string; args: unknown }; functionResponse?: { name: string; response: unknown }; thoughtSignature?: string };
type Content = { role: "user" | "model"; parts: Part[] };

function toGemini(input: AgAiConversationItem[]) {
  const system: string[] = [];
  const contents: Content[] = [];
  const nameByCall = new Map<string, string>();
  const push = (role: Content["role"], part: Part) => {
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const item of input) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push("user", { text });
    } else if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n").trim();
      if (text) push("model", { text });
    } else if (item.type === "function_call") {
      nameByCall.set(item.callId, item.name);
      let args: unknown = {};
      try {
        args = JSON.parse(item.arguments || "{}");
      } catch {
        args = {};
      }
      push("model", { functionCall: { name: item.name, args }, thoughtSignature: signatures.get(item.callId) ?? SKIP_SIGNATURE });
    } else if (item.type === "function_call_output") {
      let response: unknown;
      try {
        response = JSON.parse(item.output);
      } catch {
        response = { result: item.output };
      }
      if (typeof response !== "object" || response === null || Array.isArray(response)) response = { result: response };
      push("user", { functionResponse: { name: nameByCall.get(item.callId) ?? "tool", response } });
    }
  }
  return { system: system.join("\n\n"), contents };
}

function toolConfig(choice: AgLlmRequest["toolChoice"]) {
  if (!choice || choice === "auto") return { functionCallingConfig: { mode: "AUTO" } };
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (choice === "required") return { functionCallingConfig: { mode: "ANY" } };
  return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] } };
}

export async function POST(req: Request) {
  const r = (await req.json()) as AgLlmRequest;
  const { system, contents } = toGemini(r.input ?? []);
  const tools: AgAiToolSchema[] = r.tools ?? [];
  const json = r.responseFormat?.type === "json" ? r.responseFormat : null;
  const body = {
    ...(system || r.instructions ? { systemInstruction: { parts: [{ text: [r.instructions, system].filter(Boolean).join("\n\n") }] } } : {}),
    contents: contents.length ? contents : [{ role: "user", parts: [{ text: "Hello" }] }],
    ...(tools.length
      ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }], toolConfig: toolConfig(r.toolChoice) }
      : {}),
    generationConfig: { temperature: 0.2, ...(json && !tools.length ? { responseMimeType: "application/json", responseJsonSchema: json.schema } : {}) },
  };

  let last = "";
  for (let round = 0; round < 2; round++) {
    for (const model of MODELS) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": requireEnv("GEMINI_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        });
      } catch (e) {
        last = `${model}: ${e instanceof Error ? e.message : e}`;
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        last = `${model}: HTTP ${res.status} ${data.error?.message ?? ""}`.slice(0, 300);
        if (res.status === 429 || res.status >= 500 || res.status === 404) continue;
        return Response.json({ error: { code: String(res.status), message: last } }, { status: 200 });
      }
      const parts: Part[] = data.candidates?.[0]?.content?.parts ?? [];
      const output: AgAiOutputItem[] = [];
      const text = parts.map((p) => p.text ?? "").join("").trim();
      if (text) output.push({ id: `msg_${randomUUID()}`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
      for (const p of parts) {
        if (!p.functionCall) continue;
        const callId = `call_${randomUUID()}`;
        if (p.thoughtSignature) signatures.set(callId, p.thoughtSignature);
        output.push({ id: `fc_${randomUUID()}`, kind: "output", type: "function_call", callId, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}), status: "completed" });
      }
      if (signatures.size > 2000) signatures.delete(signatures.keys().next().value!);
      const u = data.usageMetadata ?? {};
      return Response.json({
        output,
        model,
        usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, totalTokens: u.totalTokenCount ?? 0 },
        incomplete: data.candidates?.[0]?.finishReason === "MAX_TOKENS",
      });
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return Response.json({ error: { code: "unavailable", message: `The AI is busy right now (Gemini free tier). ${last}` } });
}
