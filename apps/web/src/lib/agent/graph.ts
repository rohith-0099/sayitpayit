import "server-only";
import { Annotation, END, interrupt, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { Contact, User } from "../db/schema";
import { requireEnv } from "../env";
import { quote as buildQuote, type Quote } from "../fees";
import { getRate, round2 } from "../fx";
import { equalShares } from "../payments/logic";
import { createRequest, createSplit, executePay, type Party } from "../payments/service";
import { listContacts, resolveRecipient } from "../users";
import { consumeVoiceCheck, getVoiceProfile, makeChallenge } from "../voice";
import { classifyAnswer, type Answer } from "./answers";
import { linkGuardianEvent, runGuardian, type GuardianResult } from "./guardian";
import { parseIntent, parseReceipt, type Intent, type Receipt } from "./intent";
import { localize, localizeCard } from "./language";
import { assessAnswers, writeQuestions } from "./interview";
import { cancelHold, openHold } from "../holds";
import { resolveLanguage } from "./lang";

// ---------------------------------------------------------------------------
// Flow (fixed order; Guardian and Confirm can never be skipped):
//
//   START → understand → resolve → voiceGate → guardianCheck ─┬─ BLOCK ─────────────→ respond → END
//                                     ASK_QUESTIONS → writeQuestions → askQuestions ─┬─ safe ─→ prepare
//                                                                            └─ else ─→ familyHold ─┬─ approved → prepare
//                                                                                                       └─ denied ──→ respond
//                                                        └→ prepare → confirm ─┬─ yes → execute → respond
//                                                                              ├─ no ──────────→ respond
//                                                                              └─ unclear → confirm (ask again)
// understand/resolve end early (→ respond) when something is missing or ambiguous.
// ---------------------------------------------------------------------------

export type StepId = "listening" | "understood" | "guardian" | "confirm" | "done";
export type StepStatus = "active" | "done" | "warn" | "error" | "skipped";
export interface Step {
  status: StepStatus;
  title?: string;
  detail?: string;
}

/** Serializable reference to a counterparty (checkpoint-safe). */
type PartyRef = { contactId: string; name: string } | { email: string; name: string };

export interface Plan {
  kind: "pay" | "request" | "split";
  party?: PartyRef; // pay / request
  members?: { party: PartyRef; share: number }[]; // split
  myShare?: number;
  amount: number; // pay/request: amount; split: total
  currency: string;
  note: string | null;
  /** Purpose in English: invoices, invoice emails and the invoice page are always English. */
  noteEn: string | null;
  title?: string; // split title (English, used on invoices)
  recipientCountry?: string;
  category?: "friends_family" | "business";
}

export interface Readback {
  title: string;
  /** Payments by an enrolled user: the phrase to say out loud to confirm. */
  challenge?: string | null;
  lines: { label: string; value: string; emphasis?: boolean }[];
  notes: string[];
  spoken: string;
}

export interface AgentInput {
  text: string;
  source: "voice" | "text" | "api";
  /** From Whisper, when spoken. */
  language?: string | null;
  image?: { mimeType: string; base64: string } | null;
  /** Guardian's check of the spoken command (from /api/stt), when the user is enrolled. */
  voiceCheckId?: string | null;
  /** Structured intent (e.g. /api/pay) skips the LLM but NOT Guardian or Confirm. */
  intent?: Intent | null;
}

export interface AgentResult {
  kind: Plan["kind"];
  transactionIds: string[];
  status: string;
  payUrl?: string | null;
  qr?: string | null;
}

const merge = <T,>(a: T, b: T | undefined) => (b === undefined ? a : b);

export interface VoiceState {
  /** typed = command wasn't spoken; unavailable = Guardian voice service offline */
  status: "verified" | "unsure" | "not_enrolled" | "failed" | "typed" | "unavailable";
  enrolled: boolean;
  detail: string;
  speakerScore?: number | null;
  spoofScore?: number | null;
  spoofSuspect?: boolean | null;
  /** Result of the spoken challenge at confirm time. */
  answer?: { speakerScore: number | null; phraseMatch: boolean | null; heard: string } | null;
}

const State = Annotation.Root({
  userId: Annotation<string>(),
  input: Annotation<AgentInput>(),
  language: Annotation<string>({ reducer: merge, default: () => "en" }),
  receipt: Annotation<Receipt | null>({ reducer: merge, default: () => null }),
  intent: Annotation<Intent | null>({ reducer: merge, default: () => null }),
  plan: Annotation<Plan | null>({ reducer: merge, default: () => null }),
  voice: Annotation<VoiceState | null>({ reducer: merge, default: () => null }),
  challenge: Annotation<string | null>({ reducer: merge, default: () => null }),
  /** Why the last answer wasn't accepted (shown + spoken on re-ask). */
  confirmNote: Annotation<string | null>({ reducer: merge, default: () => null }),
  /** Scam Interrupt: Gemini-written questions, the answers, and the verdict. */
  questions: Annotation<string[] | null>({ reducer: merge, default: () => null }),
  interview: Annotation<{ qa: { q: string; a: string }[]; verdict: "safe" | "scam" | "unclear"; reason: string; familySummary: string } | null>({ reducer: merge, default: () => null }),
  /** Guardian mode: paused for the trusted contact's decision. */
  hold: Annotation<{ status: "pending" | "approved" | "denied" | "cancelled"; contactName: string; url: string } | null>({ reducer: merge, default: () => null }),
  guardian: Annotation<GuardianResult | null>({ reducer: merge, default: () => null }),
  quote: Annotation<Quote | null>({ reducer: merge, default: () => null }),
  readback: Annotation<Readback | null>({ reducer: merge, default: () => null }),
  answer: Annotation<Answer | null>({ reducer: merge, default: () => null }),
  confirmAttempts: Annotation<number>({ reducer: merge, default: () => 0 }),
  result: Annotation<AgentResult | null>({ reducer: merge, default: () => null }),
  outcome: Annotation<"done" | "needs_info" | "cancelled" | "blocked" | "error" | null>({ reducer: merge, default: () => null }),
  reply: Annotation<{ text: string } | null>({ reducer: merge, default: () => null }),
  steps: Annotation<Partial<Record<StepId, Step>>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});
export type AgentState = typeof State.State;

// ---------- helpers ----------

async function loadUser(id: string): Promise<User> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) throw new Error("User not found");
  return u;
}

async function loadContact(id: string): Promise<Contact | null> {
  const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id));
  return c ?? null;
}

async function toParty(ref: PartyRef): Promise<Party> {
  if ("contactId" in ref) {
    const c = await loadContact(ref.contactId);
    if (c) return { contact: c };
    throw new Error(`Contact ${ref.name} no longer exists`);
  }
  return { email: ref.email, name: ref.name };
}

const LOCALES: Record<string, string> = { en: "en-US", es: "es-ES", de: "de-DE", ml: "ml-IN", ta: "ta-IN", hi: "hi-IN", fr: "fr-FR", ja: "ja-JP" };
export const money = (amount: number, currency: string, lang = "en") =>
  new Intl.NumberFormat(LOCALES[lang] ?? "en-US", { style: "currency", currency }).format(amount);

/** "LA TAQUERIA VERDE" → "La Taqueria Verde" (receipts shout). Leaves mixed-case names alone. */
const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s;

/** Resolve one spoken name; returns a question for the user when it can't. */
async function resolveOne(userId: string, name: string) {
  const r = await resolveRecipient(userId, name);
  if (r.kind === "exact") return { ref: { contactId: r.contact.id, name: r.contact.nickname } as PartyRef, contact: r.contact };
  if (r.kind === "new_email") return { ref: { email: r.email, name: r.email } as PartyRef, contact: null };
  if (r.kind === "ambiguous") return { ask: `Which ${name} do you mean: ${r.candidates.map((c) => c.fullName ?? c.nickname).join(" or ")}?` };
  return { ask: `I don't have a contact called ${name}. Say their PayPal email, or add them as a contact first.` };
}

// ---------- nodes ----------

async function understand(s: AgentState): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  let receipt: Receipt | null = null;
  if (s.input.image) receipt = await parseReceipt(s.input.image);

  const intent =
    s.input.intent ??
    (await parseIntent(s.input.text, { contacts: await listContacts(user.id), homeCurrency: user.homeCurrency, receipt }));
  // Reply in the language of the transcript text (Whisper's audio guess is only a tiebreaker).
  const language = resolveLanguage({ text: s.input.text, llm: intent.language, whisper: s.input.source === "voice" ? s.input.language : null });

  if (intent.kind === "unknown") {
    const text = await localize(`I can send money, ask for money, or split a bill. Try: "Pay Maria 50 euros for the logo."`, language);
    return { intent, receipt, language, outcome: "needs_info", reply: { text }, steps: { understood: { status: "warn", title: "Not a payment", detail: s.input.text } } };
  }
  if (intent.clarification || (intent.kind !== "split" && (!intent.recipient || !intent.amount)) || (intent.kind === "split" && (!intent.members.length || !(intent.amount ?? receipt?.total)))) {
    const text = intent.clarification ?? (await localize("Who should I pay, and how much?", language));
    return { intent, receipt, language, outcome: "needs_info", reply: { text }, steps: { understood: { status: "warn", title: "Need a detail", detail: text } } };
  }
  const who = intent.kind === "split" ? intent.members.join(", ") : intent.recipient;
  const verb = { pay: "Pay", request: "Request from", split: "Split with" }[intent.kind];
  return {
    intent,
    receipt,
    language,
    steps: {
      listening: { status: "done" },
      understood: {
        status: "done",
        title: `${verb} ${who}`,
        detail: [
          (intent.amount ?? receipt?.total) ? money((intent.amount ?? receipt!.total)!, intent.currency ?? receipt?.currency ?? user.homeCurrency, language) : null,
          intent.note ?? (receipt?.merchant ? titleCase(receipt.merchant) : null),
        ].filter(Boolean).join(" · "),
      },
    },
  };
}

async function resolve(s: AgentState): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  const intent = s.intent!;
  const fail = async (q: string): Promise<Partial<AgentState>> => {
    const text = await localize(q, s.language);
    return { outcome: "needs_info", reply: { text }, steps: { understood: { status: "warn", title: "Need a detail", detail: text } } };
  };

  if (intent.kind === "split") {
    const total = intent.amount ?? s.receipt?.total ?? 0;
    const currency = intent.currency ?? s.receipt?.currency ?? user.homeCurrency;
    const refs: PartyRef[] = [];
    for (const name of intent.members) {
      const r = await resolveOne(user.id, name);
      if ("ask" in r) return fail(r.ask!);
      refs.push(r.ref);
    }
    const includeMe = intent.includeMe !== false;
    const shares = equalShares(total, refs.length + (includeMe ? 1 : 0));
    const memberShares = includeMe ? shares.slice(1) : shares;
    const title = intent.noteEn ?? (s.receipt?.merchant ? titleCase(s.receipt.merchant) : "Shared bill");
    return {
      plan: { kind: "split", amount: total, currency, note: intent.note, noteEn: intent.noteEn, title, members: refs.map((party, i) => ({ party, share: memberShares[i] })), myShare: includeMe ? shares[0] : 0 },
    };
  }

  const kind = intent.kind as "pay" | "request"; // "unknown" ended in understand()
  const r = await resolveOne(user.id, intent.recipient!);
  if ("ask" in r) return fail(r.ask!);
  const currency = intent.currency ?? (kind === "pay" ? (r.contact?.currency ?? user.homeCurrency) : user.homeCurrency);
  return {
    plan: {
      kind,
      party: r.ref,
      amount: intent.amount!,
      currency,
      note: intent.note,
      noteEn: intent.noteEn ?? intent.note,
      recipientCountry: r.contact?.country ?? user.country,
      category: r.contact?.relationship ?? "friends_family",
    },
    steps: { understood: { status: "done", title: `${{ pay: "Pay", request: "Request from" }[kind]} ${r.ref.name}`, detail: `${money(intent.amount!, currency, s.language)}${intent.note ? ` · ${intent.note}` : ""}` } },
  };
}

/**
 * Voice gate: Guardian already checked the spoken command (speaker + spoof) in /api/stt;
 * here we consume that result exactly once. Typed commands get no voice check, so payments
 * from an enrolled user will need the spoken challenge phrase at confirm time.
 */
async function voiceGate(s: AgentState): Promise<Partial<AgentState>> {
  const profile = await getVoiceProfile(s.userId);
  let voice: VoiceState;
  if (!profile) {
    voice = { status: "not_enrolled", enrolled: false, detail: "Voice ID not set up yet" };
  } else if (s.input.source !== "voice") {
    voice = { status: "typed", enrolled: true, detail: s.plan?.kind === "pay" ? "Typed, so you'll confirm by voice" : "Typed (no money leaves your account)" };
  } else {
    const c = await consumeVoiceCheck(s.input.voiceCheckId, s.userId, { kind: "command" });
    if (!c) voice = { status: "failed", enrolled: true, detail: "No voice sample to check" };
    else if (c.status === "unavailable") voice = { status: "unavailable", enrolled: true, detail: "Voice check offline" };
    else if (c.status !== "ok") voice = { status: "failed", enrolled: true, detail: "Too short to check your voice" };
    else
      voice = {
        status: c.speakerVerdict === "match" ? "verified" : c.speakerVerdict === "unsure" ? "unsure" : "failed",
        enrolled: true,
        detail: c.speakerVerdict === "match" ? "Your voice matches" : c.speakerVerdict === "unsure" ? "Couldn't fully confirm your voice" : "That doesn't sound like you",
        speakerScore: c.speakerScore,
        spoofScore: c.spoofScore,
        spoofSuspect: c.spoofSuspect,
      };
  }
  return { voice, steps: { guardian: { status: "active", title: "Checking", detail: voice.detail } } };
}

async function guardian(s: AgentState): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  const plan = s.plan!;
  const name = plan.party?.name ?? plan.members!.map((m) => m.party.name).join(", ");
  const email = plan.party && "email" in plan.party ? plan.party.email : plan.party ? ((await loadContact((plan.party as { contactId: string }).contactId))?.paypalEmail ?? "") : "";
  const { rate } = await getRate(plan.currency, user.homeCurrency);
  const g = await runGuardian({ user, kind: plan.kind, counterpartyEmail: email, counterpartyName: name, homeAmount: round2(plan.amount * rate), command: s.input.text, voice: s.voice });

  const status: StepStatus = g.decision === "ALLOW" ? "done" : g.decision === "BLOCK" ? "error" : "warn";
  const title = { ALLOW: "Looks safe", ASK_QUESTIONS: "Needs a closer look", GUARDIAN_HOLD: "Held for family approval", PASSKEY_REQUIRED: "Extra check needed", BLOCK: "Stopped" }[g.decision];
  if (g.decision === "BLOCK") {
    const text = await localize(`I stopped this payment. ${g.explanation} I didn't send anything.`, s.language);
    return { guardian: g, outcome: "blocked", reply: { text }, steps: { guardian: { status, title, detail: g.explanation }, done: { status: "error", title: "Not sent" } } };
  }
  return { guardian: g, steps: { guardian: { status, title, detail: `Risk ${Math.round(g.riskScore * 100)} out of 100` } } };
}

// PayPal's own names for the two payment types, per language (values aren't sent to the translator).
const CATEGORY_LABELS: Record<string, Record<"friends_family" | "business", string>> = {
  es: { friends_family: "Amigos y familiares", business: "Bienes y servicios" },
  de: { friends_family: "Freunde und Familie", business: "Waren und Dienstleistungen" },
  fr: { friends_family: "Proches", business: "Biens et services" },
  ml: { friends_family: "സുഹൃത്തുക്കളും കുടുംബവും", business: "സാധനങ്ങളും സേവനങ്ങളും" },
  hi: { friends_family: "मित्र और परिवार", business: "वस्तुएं और सेवाएं" },
};

/** "Pay Maria €500.00 (gift cards)" for prompts and the family summary. */
function describe(plan: Plan): string {
  const who = plan.party?.name ?? plan.members?.map((m) => m.party.name).join(", ") ?? "someone";
  const verb = { pay: "pay", request: "ask", split: "split a bill with" }[plan.kind];
  return `${verb} ${who} ${money(plan.amount, plan.currency)}${plan.noteEn ? ` (${plan.noteEn})` : ""}`;
}

/** Scam Interrupt, step 1: write the questions (once; kept out of the interrupting node). */
async function questions(s: AgentState): Promise<Partial<AgentState>> {
  const qs = await writeQuestions({ signals: s.guardian!.signals, what: s.input.text, language: s.language });
  return { questions: qs, steps: { guardian: { status: "warn", title: "Asking a few questions", detail: s.guardian!.explanation } } };
}

/** Scam Interrupt, step 2: ask each question (one pause per question), then judge the answers. */
async function interview(s: AgentState): Promise<Partial<AgentState>> {
  const qs = s.questions ?? [];
  const qa: { q: string; a: string }[] = [];
  for (const [i, q] of qs.entries()) {
    const r = interrupt<{ type: "question"; index: number; total: number; question: string }, { answer: string }>({ type: "question", index: i, total: qs.length, question: q });
    const a = (r?.answer ?? "").trim();
    if (/^(cancel|stop|cancela|para)\b/i.test(a)) {
      const text = await localize("Okay, I've cancelled it. Nothing was sent.", s.language);
      return { outcome: "cancelled", reply: { text }, steps: { guardian: { status: "skipped", title: "Cancelled" }, done: { status: "skipped", title: "Not sent" } } };
    }
    qa.push({ q, a: a || "(no answer)" });
  }
  const v = await assessAnswers({ what: describe(s.plan!), signals: s.guardian!.signals, qa, language: s.language });
  const interviewState = { qa, ...v };
  if (v.verdict === "safe") {
    return { interview: interviewState, steps: { guardian: { status: "done", title: "Questions answered", detail: v.reason } } };
  }
  return { interview: interviewState, steps: { guardian: { status: "warn", title: "Pausing for family approval", detail: v.reason } } };
}

/** Guardian mode: pause until the trusted contact approves or stops it from their link. */
async function hold(s: AgentState, config: LangGraphRunnableConfig): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  const threadId = config.configurable?.thread_id as string;
  const plan = s.plan!;
  const { contact, url } = await openHold({
    userId: s.userId,
    threadId,
    summary: {
      userName: user.name,
      what: describe(plan),
      amountText: money(plan.amount, plan.currency),
      recipient: plan.party?.name ?? "",
      signals: s.guardian!.signals.map((x) => x.label),
      qa: s.interview?.qa ?? [],
      familySummary: s.interview?.familySummary ?? s.guardian!.explanation,
      command: s.input.text,
    },
  });
  const contactName = contact?.name.split(" ")[0] ?? "your family contact";
  const r = interrupt<{ type: "hold"; contactName: string; url: string; reason: string }, { decision: "approved" | "denied" | "cancelled" }>({
    type: "hold",
    contactName,
    url,
    reason: s.interview?.reason ?? s.guardian!.explanation,
  });
  if (r?.decision === "approved") {
    return { hold: { status: "approved", contactName, url }, steps: { guardian: { status: "done", title: `${contactName} approved`, detail: "You still confirm before anything is sent." } } };
  }
  if (r?.decision === "cancelled") {
    await cancelHold(threadId);
    const text = await localize("Okay, I've cancelled it. Nothing was sent.", s.language);
    return { hold: { status: "cancelled", contactName, url }, outcome: "cancelled", reply: { text }, steps: { guardian: { status: "skipped", title: "Cancelled" }, done: { status: "skipped", title: "Not sent" } } };
  }
  const text = await localize(`${contactName} stopped this payment. Nothing was sent, and your money is safe.`, s.language);
  return { hold: { status: "denied", contactName, url }, outcome: "blocked", reply: { text }, steps: { guardian: { status: "error", title: `${contactName} stopped it` }, done: { status: "error", title: "Not sent" } } };
}

/** Build the read-back. Kept separate from `confirm` because interrupted nodes re-run on resume. */
async function prepare(s: AgentState): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  const plan = s.plan!;
  const L = s.language;
  let readback: Readback;
  let quote: Quote | null = null;

  if (plan.kind === "pay") {
    const { rate } = await getRate(plan.currency, user.homeCurrency);
    quote = buildQuote({ amount: plan.amount, currency: plan.currency, homeCurrency: user.homeCurrency, rate, category: plan.category ?? "friends_family", senderCountry: user.country, recipientCountry: plan.recipientCountry ?? user.country });
    const name = plan.party!.name;
    const receives = money(quote.recipientReceives.amount, quote.recipientReceives.currency, L);
    const total = money(quote.total, quote.homeCurrency, L);
    const feeText = quote.fees.length ? `, including ${quote.fees.map((f) => `${money(f.amount, quote!.homeCurrency, L)} ${f.label.replace(/ \(.*\)/, "").toLowerCase()}`).join(" and ")}` : ", no fees";
    readback = {
      title: `Pay ${name}`,
      lines: [
        { label: `${name} receives`, value: receives, emphasis: true },
        ...(quote.converted ? [{ label: "Exchange rate", value: `1 ${plan.currency} = ${quote.rate.toFixed(4)} ${quote.homeCurrency}` }] : []),
        ...quote.fees.map((f) => ({ label: f.label, value: money(f.amount, quote!.homeCurrency, L) })),
        { label: "You pay", value: total, emphasis: true },
        { label: "Type", value: CATEGORY_LABELS[L]?.[quote.category] ?? quote.categoryLabel },
        ...(plan.note ? [{ label: "For", value: plan.note }] : []),
      ],
      notes: quote.notes,
      spoken: `Sending ${name} ${receives}${plan.note ? ` for ${plan.note}` : ""}. You pay ${total}${feeText}. ${quote.categoryLabel}. Shall I send it?`,
    };
  } else if (plan.kind === "request") {
    const name = plan.party!.name;
    const amt = money(plan.amount, plan.currency, L);
    readback = {
      title: `Request from ${name}`,
      lines: [
        { label: `${name} pays you`, value: amt, emphasis: true },
        ...(plan.note ? [{ label: "For", value: plan.note }] : []),
      ],
      notes: ["I'll send a PayPal invoice with a QR code (in English). Nothing leaves your account; they pay with PayPal or a card."],
      spoken: `Asking ${name} for ${amt}${plan.note ? ` for ${plan.note}` : ""}. I'll send a PayPal invoice with a QR code. Shall I send it?`,
    };
  } else {
    const per = plan.members!.map((m) => `${m.party.name} ${money(m.share, plan.currency, L)}`).join(", ");
    readback = {
      title: `Split ${plan.title}`,
      lines: [
        { label: "Total", value: money(plan.amount, plan.currency, L) },
        ...plan.members!.map((m) => ({ label: `${m.party.name} owes`, value: money(m.share, plan.currency, L), emphasis: true })),
        ...(plan.myShare ? [{ label: "Your share", value: money(plan.myShare, plan.currency, L) }] : []),
      ],
      notes: ["Each person gets their own PayPal invoice. I'll tell you when they pay."],
      spoken: `Splitting ${money(plan.amount, plan.currency, L)}: ${per}. I'll send each of them an invoice. Shall I send them?`,
    };
  }

  if (s.hold?.status === "approved") {
    readback.notes.unshift(`Guardian: ${s.hold.contactName} approved this payment.`);
  } else if (s.interview?.verdict === "safe") {
    readback.notes.unshift("Guardian: thanks for answering the questions.");
  } else if (s.guardian && s.guardian.decision !== "ALLOW") {
    readback.notes.unshift(`Guardian: ${s.guardian.explanation}`);
    readback.spoken = `Before you answer: ${s.guardian.explanation} ${readback.spoken}`;
  }
  // Money leaving an enrolled user's account needs a fresh random phrase, said in their voice.
  // A recording can't contain a phrase that didn't exist yet, so this defeats replay.
  let challenge: string | null = null;
  if (plan.kind === "pay" && s.voice?.enrolled) {
    challenge = makeChallenge(L === "es" ? "es" : "en");
    readback.spoken = readback.spoken.replace(/Shall I send it\?$/, `To send it, say: "${challenge}".`);
  }
  readback = await localizeCard(readback, L);
  readback.challenge = challenge;
  return {
    quote,
    readback,
    challenge,
    steps: { confirm: { status: "active", title: challenge ? "Say the phrase to confirm" : "Waiting for your yes", detail: challenge ? `"${challenge}"` : readback.title } },
  };
}

/**
 * Human-in-the-loop: the graph pauses here until the user answers.
 * Without a challenge, a clear yes (typed or spoken) confirms. With a challenge, only a spoken
 * answer that Guardian matched to the user's voice AND that contains the phrase confirms.
 */
async function confirm(s: AgentState, config: LangGraphRunnableConfig): Promise<Partial<AgentState>> {
  const reask = s.answer === "unclear";
  const resume = interrupt<
    { type: "confirm"; readback: Readback; reask: boolean; note: string | null },
    { answer: string; voiceCheckId?: string | null }
  >({ type: "confirm", readback: s.readback!, reask, note: s.confirmNote });
  const attempts = s.confirmAttempts + 1;
  const said = classifyAnswer(resume?.answer ?? "");

  const cancel = async (english: string, outcome: "cancelled" | "blocked" = "cancelled", extra: Partial<AgentState> = {}): Promise<Partial<AgentState>> => ({
    answer: "no",
    confirmAttempts: attempts,
    outcome,
    reply: { text: await localize(english, s.language) },
    steps: { confirm: { status: outcome === "blocked" ? "error" : "skipped", title: outcome === "blocked" ? "Voice didn't match" : "Cancelled" }, done: { status: outcome === "blocked" ? "error" : "skipped", title: "Not sent" } },
    ...extra,
  });
  const again = async (english: string, extra: Partial<AgentState> = {}): Promise<Partial<AgentState>> =>
    attempts >= 3
      ? cancel("Okay, I didn't send anything.", "cancelled", extra)
      : {
          answer: "unclear",
          confirmAttempts: attempts,
          confirmNote: await localize(english, s.language),
          steps: { confirm: { status: "active", title: s.challenge ? "Say the phrase to confirm" : "Say yes or no", detail: s.challenge ? `"${s.challenge}"` : s.readback!.title } },
          ...extra,
        };

  if (said === "no") return cancel("Okay, I didn't send anything.");

  if (!s.challenge) {
    if (said === "yes") return { answer: "yes", confirmAttempts: attempts, confirmNote: null, steps: { confirm: { status: "done", title: "You said yes" } } };
    return again("I need a clear yes or no.");
  }

  const threadId = config.configurable?.thread_id as string | undefined;
  const c = await consumeVoiceCheck(resume?.voiceCheckId, s.userId, { kind: "answer", threadId, maxAgeSec: 120 });
  if (!c) return again(`Please say the phrase out loud: "${s.challenge}".`);
  const voice = { ...s.voice!, answer: { speakerScore: c.speakerScore, phraseMatch: c.phraseMatch, heard: c.transcript } };
  if (c.status === "unavailable") return cancel("Guardian's voice check is offline, so I can't send money right now. I didn't send anything.", "cancelled", { voice });
  if (c.status !== "ok") return again(`That was too short. Say: "${s.challenge}".`, { voice });
  if (c.speakerVerdict === "mismatch") return cancel("That voice doesn't match yours, so I stopped. I didn't send anything.", "blocked", { voice });
  if (c.speakerVerdict !== "match") return again(`I couldn't quite confirm it's you. Say it once more, clearly: "${s.challenge}".`, { voice });
  if (!c.phraseMatch) return again(`I heard "${c.transcript}". Please say: "${s.challenge}".`, { voice });
  return { answer: "yes", confirmAttempts: attempts, confirmNote: null, voice, steps: { confirm: { status: "done", title: "Phrase and voice matched" } } };
}

async function execute(s: AgentState): Promise<Partial<AgentState>> {
  // Defence in depth: the edges already guarantee this, but money never moves on anything else.
  if (s.answer !== "yes" || !s.guardian || s.guardian.decision === "BLOCK") throw new Error("Refusing to execute without Guardian approval and an explicit yes");
  if (s.guardian.decision === "ASK_QUESTIONS" && s.interview?.verdict !== "safe" && s.hold?.status !== "approved") {
    throw new Error("Refusing to execute: Guardian's questions weren't cleared and no family approval");
  }

  const user = await loadUser(s.userId);
  const plan = s.plan!;
  const g = { riskScore: s.guardian.riskScore, decision: s.guardian.decision };
  const L = s.language;
  try {
    let result: AgentResult;
    let english: string;
    if (plan.kind === "pay") {
      const q = s.quote!;
      const tx = await executePay(user, {
        to: await toParty(plan.party!),
        amount: plan.amount,
        currency: plan.currency,
        note: plan.note ?? undefined,
        command: s.input.text,
        source: s.input.source,
        chargeTotal: q.total,
        fee: round2(q.fees.reduce((a, f) => a + f.amount, 0)),
        guardian: g,
      });
      result = { kind: "pay", transactionIds: [tx.id], status: tx.status };
      english = `Done. ${plan.party!.name} is getting ${money(plan.amount, plan.currency, L)}.`;
    } else if (plan.kind === "request") {
      const r = await createRequest(user, { from: await toParty(plan.party!), amount: plan.amount, currency: plan.currency, note: plan.noteEn ?? undefined, item: plan.noteEn ?? undefined, command: s.input.text, source: s.input.source, guardian: g });
      result = { kind: "request", transactionIds: [r.transaction.id], status: r.transaction.status, payUrl: r.invoice.payerViewUrl, qr: r.invoice.qrDataUrl };
      english = `Sent. ${plan.party!.name} has a PayPal invoice for ${money(plan.amount, plan.currency, L)}.`;
    } else {
      const members = [];
      for (const m of plan.members!) members.push({ party: await toParty(m.party), amount: m.share });
      const r = await createSplit(user, { title: plan.title!, currency: plan.currency, total: plan.amount, members, command: s.input.text, source: s.input.source, receipt: s.receipt ?? undefined });
      const ok = r.members.filter((m) => m.ok);
      result = { kind: "split", transactionIds: ok.map((m) => m.transaction.id), status: ok.length === r.members.length ? "sent" : "partial" };
      english = ok.length === r.members.length ? `Sent ${ok.length} invoices. I'll let you know when they pay.` : `Sent ${ok.length} of ${r.members.length} invoices; some failed.`;
    }
    if (s.guardian.eventId && result.transactionIds[0]) await linkGuardianEvent(s.guardian.eventId, result.transactionIds[0]);
    const title = { pay: "Paid", request: "Requested", split: "Invoices sent" }[plan.kind];
    const text = await localize(english, L);
    return { result, outcome: "done", reply: { text }, steps: { done: { status: "done", title, detail: text } } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const text = await localize(`That didn't go through: ${msg}`, L);
    return { outcome: "error", reply: { text }, steps: { done: { status: "error", title: "Didn't go through", detail: msg } } };
  }
}

async function respond(s: AgentState): Promise<Partial<AgentState>> {
  return s.reply ? {} : { reply: { text: await localize("Okay.", s.language) } };
}

// ---------- graph ----------

const builder = new StateGraph(State)
  .addNode("understand", understand)
  .addNode("resolve", resolve)
  .addNode("voiceGate", voiceGate)
  .addNode("guardianCheck", guardian)
  .addNode("writeQuestions", questions)
  .addNode("askQuestions", interview)
  .addNode("familyHold", hold)
  .addNode("prepare", prepare)
  .addNode("confirm", confirm)
  .addNode("execute", execute)
  .addNode("respond", respond)
  .addEdge(START, "understand")
  .addConditionalEdges("understand", (s) => (s.outcome ? "respond" : "resolve"), ["respond", "resolve"])
  .addConditionalEdges("resolve", (s) => (s.outcome ? "respond" : "voiceGate"), ["respond", "voiceGate"])
  .addEdge("voiceGate", "guardianCheck")
  .addConditionalEdges(
    "guardianCheck",
    (s) => (s.guardian?.decision === "BLOCK" ? "respond" : s.guardian?.decision === "ASK_QUESTIONS" ? "writeQuestions" : s.guardian?.decision === "GUARDIAN_HOLD" ? "familyHold" : "prepare"),
    ["respond", "writeQuestions", "familyHold", "prepare"],
  )
  .addEdge("writeQuestions", "askQuestions")
  // Safe answers continue to the read-back; anything else goes to the family. Cancels end.
  .addConditionalEdges("askQuestions", (s) => (s.outcome ? "respond" : s.interview?.verdict === "safe" ? "prepare" : "familyHold"), ["respond", "prepare", "familyHold"])
  .addConditionalEdges("familyHold", (s) => (s.outcome ? "respond" : "prepare"), ["respond", "prepare"])
  .addEdge("prepare", "confirm")
  // Any final outcome (cancelled, blocked by a voice mismatch...) ends the flow; only "unclear" asks again.
  .addConditionalEdges("confirm", (s) => (s.answer === "yes" ? "execute" : s.outcome ? "respond" : "confirm"), ["execute", "respond", "confirm"])
  .addEdge("execute", "respond")
  .addEdge("respond", END);

// Share only the checkpointer (a Postgres pool) across dev hot reloads. The compiled graph is
// per module instance: caching it globally would pin node closures to stale code after an edit.
const g = globalThis as unknown as { __checkpointer?: Promise<PostgresSaver> };
let compiled: ReturnType<typeof builder.compile> | null = null;

/** Compiled graph with a Postgres checkpointer (paused confirmations survive restarts). */
export async function getAgent() {
  const checkpointer = await (g.__checkpointer ??= (async () => {
    const cp = PostgresSaver.fromConnString(requireEnv("DATABASE_URL"), { schema: "langgraph" });
    await cp.setup();
    return cp;
  })());
  compiled ??= builder.compile({ checkpointer });
  return compiled;
}
