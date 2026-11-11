// AG Studio LLM adapter for Gemini, via our server route /api/ai/turn (which holds the key).
// AG Studio runs the agent loop; each turn is one request here. Non-streaming: the reply's text and
// tool calls are replayed as Studio's TEXT_MESSAGE_* / TOOL_CALL_* events when the turn completes.
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmResponse } from "ag-studio";

interface TurnResult {
  output?: AgAiOutputItem[];
  model?: string;
  usage?: AgLlmResponse["usage"];
  incomplete?: boolean;
  error?: { code: string; message: string };
}

export const geminiAdapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const turn: Promise<TurnResult> = fetch("/api/ai/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options?.signal,
    })
      .then((r) => r.json() as Promise<TurnResult>)
      .catch((e) => ({ error: { code: "network", message: e instanceof Error ? e.message : String(e) } }));

    const complete: Promise<AgLlmResponse> = turn.then((t) => ({
      id: `turn_${Date.now()}`,
      createdAt: Date.now(),
      output: t.output ?? [],
      status: t.error ? "failed" : t.incomplete ? "incomplete" : "completed",
      ...(t.error && { error: t.error }),
      ...(t.incomplete && { incompleteDetails: { reason: "max_output_tokens" as const } }),
      ...(t.usage && { usage: t.usage }),
      ...(t.model && { model: t.model }),
    }));

    async function* events(): AsyncGenerator<AgAiEvent> {
      const t = await turn;
      for (const item of t.output ?? []) {
        if (item.type === "message") {
          const text = item.content.map((c) => (c.type === "text" ? c.text : "")).join("");
          yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" } as AgAiEvent;
          yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text } as AgAiEvent;
          yield { type: "TEXT_MESSAGE_END", messageId: item.id } as AgAiEvent;
        } else if (item.type === "function_call") {
          yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name } as AgAiEvent;
          yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments } as AgAiEvent;
          yield { type: "TOOL_CALL_END", toolCallId: item.callId } as AgAiEvent;
        }
      }
    }

    return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
  },
};
