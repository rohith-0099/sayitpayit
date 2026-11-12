import "server-only";
import { Command } from "@langchain/langgraph";
import { ApiError } from "../errors";
import { classifyAnswer } from "./answers";
import { getAgent, type AgentInput, type AgentState, type Readback } from "./graph";
import type { Intent } from "./intent";
import { prefetchSpeech } from "../ai/tts";

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

// `say` on each event is the one short line the agent speaks (the screen shows the details).
export type AgentEvent =
  | { type: "thread"; threadId: string }
  | { type: "update"; node: string; steps: AgentState["steps"] }
  | { type: "confirm"; threadId: string; readback: Readback; reask: boolean; note: string | null; view: PublicView; say: string }
  | { type: "question"; threadId: string; question: string; index: number; total: number; view: PublicView; say: string }
  | { type: "hold"; threadId: string; contactName: string; url: string; reason: string; view: PublicView; say: string }
  | { type: "final"; threadId: string; view: PublicView; say: string }
  | { type: "error"; message: string; code?: string };

/** What the browser may see (no vault ids, no raw PayPal tokens). */
export type PublicView = Pick<AgentState, "language" | "intent" | "receipt" | "voice" | "quote" | "readback" | "result" | "outcome" | "reply" | "steps" | "interview" | "suggestions"> & {
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
  interview: s.interview,
  suggestions: s.suggestions,
});

type Pending = { type: "confirm"; readback: Readback; reask: boolean; note: string | null } | { type: "question"; question: string; index: number; total: number } | { type: "hold"; contactName: string; url: string; reason: string };

/** The event that describes where a conversation is now (paused or finished). */
function stateEvent(threadId: string, state: AgentState, pending: Pending | undefined): AgentEvent {
  const v = view(state);
  if (!pending) return { type: "final", threadId, view: v, say: v.reply?.say ?? v.reply?.text ?? "" };
  if (pending.type === "question") return { type: "question", threadId, question: pending.question, index: pending.index, total: pending.total, view: v, say: pending.question };
  if (pending.type === "hold") {
    const say = v.language === "en" ? `I've paused this payment and asked ${pending.contactName} to approve it.` : pending.reason;
    return { type: "hold", threadId, contactName: pending.contactName, url: pending.url, reason: pending.reason, view: v, say };
  }
  return { type: "confirm", threadId, readback: pending.readback, reask: pending.reask, note: pending.note ?? null, view: v, say: pending.note ?? pending.readback.spoken };
}

/** Current state of a conversation (the UI polls this while waiting for the family's decision). */
export async function currentEvent(userId: string, threadId: string): Promise<AgentEvent> {
  const snap = await (await getAgent()).getState({ configurable: { thread_id: threadId } });
  if (!snap.values?.userId) throw new ApiError(404, "That conversation has expired.");
  if (snap.values.userId !== userId) throw new ApiError(403, "Not your conversation.");
  return stateEvent(threadId, snap.values as AgentState, snap.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as Pending | undefined);
}

/**
 * Run the graph (new thread or resume) and yield UI events as nodes finish.
 * Ends with either `confirm` (paused for the user's yes/no) or `final`.
 */
export async function* runAgent(opts: {
  userId: string;
  threadId: string;
  input?: AgentInput;
  /** The user's answer to whatever the conversation is waiting on (confirm / question / hold). */
  answer?: string;
  voiceCheckId?: string | null;
  /** The trusted contact's decision (authorised by the hold token, not the user's session). */
  familyDecision?: "approved" | "denied";
  /** The browser will speak the reply: start generating its audio before sending the event. */
  speak?: boolean;
}): AsyncGenerator<AgentEvent> {
  const agent = await getAgent();
  const config = { configurable: { thread_id: opts.threadId } };

  let payload: unknown;
  if (opts.answer !== undefined || opts.familyDecision) {
    const snap = await agent.getState(config);
    if (!snap.values?.userId) throw new ApiError(404, "That conversation has expired. Say the payment again.");
    if (snap.values.userId !== opts.userId) throw new ApiError(403, "Not your conversation.");
    const pending = snap.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as Pending | undefined;
    if (!pending) throw new ApiError(409, "Nothing is waiting for an answer.");
    if (opts.familyDecision) {
      if (pending.type !== "hold") throw new ApiError(409, "This payment isn't waiting for family approval.");
      payload = new Command({ resume: { decision: opts.familyDecision } });
    } else if (pending.type === "hold") {
      // While on hold the user can only cancel; approving is the family member's call.
      if (classifyAnswer(opts.answer!) !== "no" && !/^cancel/i.test(opts.answer!)) throw new ApiError(409, `Waiting for ${pending.contactName} to approve. Say "cancel" to stop it.`);
      payload = new Command({ resume: { decision: "cancelled" } });
    } else if (pending.type === "question") {
      payload = new Command({ resume: { answer: opts.answer } });
    } else {
      payload = new Command({ resume: { answer: opts.answer, voiceCheckId: opts.voiceCheckId ?? null } });
    }
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
  const event = stateEvent(opts.threadId, snap.values as AgentState, snap.tasks.flatMap((t) => t.interrupts ?? [])[0]?.value as Pending | undefined);
  if (opts.speak && "say" in event) prefetchSpeech(event.say, event.view.language);
  yield event;
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
