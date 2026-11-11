import "server-only";
import { generateJson } from "../ai/gemini";
import { classifyAnswer } from "./answers";
import type { Signal } from "./guardian";
import { localize } from "./language";

// Scam Interrupt: the questions a careful bank teller would ask, written from the signals that fired.

export interface Verdict {
  verdict: "safe" | "scam" | "unclear";
  /** One kind sentence for the user, in their language. */
  reason: string;
  /** Plain English summary for the trusted family member. */
  familySummary: string;
}

const FALLBACK: Record<string, string> = {
  stranger_on_phone: "Is someone on the phone or messaging you right now, telling you to make this payment?",
  authority: "Did someone say they are from the tax office, the police, a court or your bank?",
  gift_cards: "Were you asked to pay with gift cards or to read out card numbers?",
  secrecy: "Were you told not to tell your family or your bank about this?",
  urgency: "Did someone say something bad will happen if you don't pay right now?",
  crypto_wire: "Were you asked to move money to a 'safe account' or into crypto?",
  prize: "Is this a fee to unlock a prize, a lottery win or an inheritance?",
  amount_spike: "This is much more than you usually send. Did you plan this payment yourself?",
  new_payee: "Have you met this person, or paid them before?",
};

/** 2-3 short yes/no questions in the user's language, most important first. */
export async function writeQuestions(opts: { signals: Signal[]; what: string; language: string }): Promise<string[]> {
  try {
    const out = await generateJson<{ questions: string[] }>(
      [
        {
          text: `You are a caring, calm bank fraud specialist protecting a customer (possibly elderly) from a payment scam.
The customer asked to: ${opts.what}
Warning signs Guardian detected: ${opts.signals.map((s) => s.label).join("; ") || "unusual payment"}.
Write 2 or 3 short, simple yes/no questions (like a real bank teller) that reveal whether a scammer is behind this.
Ask about the specific warning signs. Most important first. Never accuse; be warm. Language: ${opts.language} (ISO 639-1).`,
        },
      ],
      { type: "OBJECT", properties: { questions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["questions"] },
      { timeoutMs: 10_000 },
    );
    const qs = out.questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
    if (qs.length >= 2) return qs;
    throw new Error("too few questions");
  } catch {
    const picked = opts.signals.map((s) => FALLBACK[s.id]).filter(Boolean);
    const qs = [...new Set([FALLBACK.stranger_on_phone, ...picked])].slice(0, 3);
    return Promise.all(qs.map((q) => localize(q, opts.language)));
  }
}

/**
 * Judge the answers. Conservative: anything unclear goes to the family, never straight through.
 * If the AI is unavailable, any "yes" (to questions that are all phrased as warning signs) means scam.
 */
export async function assessAnswers(opts: { what: string; signals: Signal[]; qa: { q: string; a: string }[]; language: string }): Promise<Verdict> {
  try {
    return await generateJson<Verdict>(
      [
        {
          text: `A customer asked their voice payment assistant to: ${opts.what}
Guardian's warning signs: ${opts.signals.map((s) => s.label).join("; ")}.
Fraud questions and the customer's spoken answers:
${opts.qa.map((x, i) => `${i + 1}. Q: ${x.q}\n   A: ${x.a}`).join("\n")}

Decide:
- "scam": the answers show a classic scam pattern (someone on the phone directing it, authority impersonation, gift cards, secrecy, threats, a stranger, a prize fee, a 'safe account').
- "safe": the answers clearly show the customer planned this themselves for a real reason, with no one pressuring them.
- "unclear": anything else.
reason: one warm, plain sentence for the customer in language "${opts.language}", explaining what you noticed (e.g. that real tax offices never ask for gift cards). No blame.
familySummary: 1-2 plain English sentences for the customer's trusted family member explaining why the payment was paused.`,
        },
      ],
      {
        type: "OBJECT",
        properties: { verdict: { type: "STRING", enum: ["safe", "scam", "unclear"] }, reason: { type: "STRING" }, familySummary: { type: "STRING" } },
        required: ["verdict", "reason", "familySummary"],
      },
      { timeoutMs: 12_000 },
    );
  } catch {
    const anyYes = opts.qa.some((x) => classifyAnswer(x.a) === "yes");
    const allNo = opts.qa.every((x) => classifyAnswer(x.a) === "no");
    const verdict = anyYes ? "scam" : allNo ? "safe" : "unclear";
    return {
      verdict,
      reason: await localize(verdict === "safe" ? "Thanks, that sounds like a payment you planned yourself." : "Some of your answers match how scams usually work, so I've paused this to keep you safe.", opts.language),
      familySummary: `Guardian paused a payment (${opts.what}). Warning signs: ${opts.signals.map((s) => s.label).join("; ")}.`,
    };
  }
}
