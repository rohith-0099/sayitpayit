import "server-only";
import { Command } from "@langchain/langgraph";
import { ApiError } from "../errors";
import { getAgent, type AgentInput, type AgentState, type Readback } from "./graph";
import type { Intent } from "./intent";

/** Build a structured intent (skips the LLM, never Guardian or Confirm). */
export const structuredIntent = (i: Pick<Intent, "kind"> & Partial<Intent>): Intent => ({
  recipient: null,
  members: [],
  amount: null,
  currency: null,
  note: null,
  noteEn: null,
  includeMe: true,
  language: "en",
  clarification: null,
  ...i,
});

export type AgentEvent =
  | { type: "thread"; threadId: string }
  | { type: "update"; node: string; steps: AgentState["steps"] }
  | { type: "confirm"; threadId: string; readback: Readback; reask: boolean; note: string | null; view: PublicView }
  | { type: "final"; threadId: string; view: PublicView }
  | { type: "error"; message: string; code?: string };

/** What the browser may see (no vault ids, no raw PayPal tokens). */
export type PublicView = Pick<AgentState, "language" | "intent" | "receipt" | "voice" | "quote" | "readback" | "result" | "outcome" | "reply" | "steps"> & {
  guardian: Omit<NonNullable<AgentState["guardian"]>, "eventId"> | null;
};

const publicGuardian = (g: AgentState["guardian"]) => {
  if (!g) return null;
  const { eventId: _omit, ...rest } = g;
  void _omit;
  return rest;
};

const view = (s: AgentState): PublicView => ({
  language: s.language,
  intent: s.intent,
  receipt: s.receipt,
  voice: s.voice,
  guardian: publicGuardian(s.guardian),
  quote: s.quote,
  readback: s.readback,
  result: s.result,
  outcome: s.outcome,
  reply: s.reply,
  steps: s.steps,
});

/**
 * Run the graph (new thread or resume) and yield UI events as nodes finish.
 * Ends with either `confirm` (paused for the user's yes/no) or `final`.
 */
export async function* runAgent(opts: { userId: string; threadId: string; input?: AgentInput; answer?: string; voiceCheckId?: string | null }): AsyncGenerator<AgentEvent> {
  const agent = await getAgent();
  const config = { configurable: { thread_id: opts.threadId } };

  let payload: unknown;
  if (opts.answer !== undefined) {
    const snap = await agent.getState(config);
    if (!snap.values?.userId) throw new ApiError(404, "That conversation has expired. Say the payment again.");
    if (snap.values.userId !== opts.userId) throw new ApiError(403, "Not your conversation.");
    if (!snap.next.includes("confirm")) throw new ApiError(409, "Nothing is waiting for a yes or no.");
    payload = new Command({ resume: { answer: opts.answer, voiceCheckId: opts.voiceCheckId ?? null } });
  } else {
    payload = { userId: opts.userId, input: opts.input, steps: { listening: { status: "done" }, understood: { status: "active" } } };
    yield { type: "thread", threadId: opts.threadId };
  }

  const stream = await agent.stream(payload as never, { ...config, streamMode: "updates" });
  for await (const chunk of stream as AsyncIterable<Record<string, Partial<AgentState>>>) {
    for (const [node, update] of Object.entries(chunk)) {
      if (node === "__interrupt__") continue;
      if (update?.steps) yield { type: "update", node, steps: update.steps };
    }
  }

  const snap = await agent.getState(config);
  const state = snap.values as AgentState;
  const pending = snap.tasks.flatMap((t) => t.interrupts ?? [])[0];
  if (pending) {
    const v = pending.value as { readback: Readback; reask: boolean; note: string | null };
    yield { type: "confirm", threadId: opts.threadId, readback: v.readback, reask: v.reask, note: v.note ?? null, view: view(state) };
  } else {
    yield { type: "final", threadId: opts.threadId, view: view(state) };
  }
}

/** Stream AgentEvents as Server-Sent Events. Errors become an `error` event. */
export function sse(events: AsyncGenerator<AgentEvent>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const e of events) send(e);
      } catch (e) {
        console.error("[agent]", e);
        send({
          type: "error",
          message: e instanceof Error ? e.message : "Something went wrong.",
          code: e instanceof ApiError ? ((e.details as { code?: string })?.code ?? String(e.status)) : undefined,
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" },
  });
}

/** Drain events (for JSON APIs like /api/pay). */
export async function collect(events: AsyncGenerator<AgentEvent>) {
  let last: AgentEvent | null = null;
  for await (const e of events) last = e;
  return last;
}

/**
 * Start a structured (non-LLM) command through the same graph as voice: Guardian + read-back,
 * then stop at the confirmation. Returns 202 with the read-back; answer via POST /api/agent/{threadId}.
 */
export async function startStructured(userId: string, input: AgentInput): Promise<Response> {
  const { randomUUID } = await import("node:crypto");
  const threadId = randomUUID();
  const last = await collect(runAgent({ userId, threadId, input }));
  if (last?.type === "confirm") {
    return Response.json(
      { threadId, awaiting: "confirmation", answerAt: `/api/agent/${threadId}`, readback: last.readback, guardian: last.view.guardian, quote: last.view.quote },
      { status: 202 },
    );
  }
  if (last?.type === "final") return Response.json({ threadId, ...last.view }, { status: last.view.outcome === "blocked" ? 403 : 422 });
  if (last?.type === "error") return Response.json({ error: last.message, code: last.code }, { status: 502 });
  return Response.json({ error: "No response from the agent" }, { status: 500 });
}
