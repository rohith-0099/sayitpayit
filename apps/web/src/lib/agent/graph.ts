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
import { normalizeName } from "../contacts-match";
import { consumeVoiceCheck, getVoiceProfile, makeChallenge } from "../voice";
import { classifyAnswer, type Answer } from "./answers";
import { linkGuardianEvent, runGuardian, type GuardianResult } from "./guardian";
import { parseIntent, parseReceipt, type Intent, type Receipt } from "./intent";
import { localize, localizeCard } from "./language";
import { assessAnswers, writeQuestions } from "./interview";
import { cancelHold, openHold } from "../holds";
import { resolveLanguage } from "./lang";
import { addContact, cancelOpenInvoice, findContactConflict, getTrustedContact, listOpenInvoices, pickInvoices, setTrustedContact } from "../actions";
import { currencyName, isPayPalCurrency } from "../paypal/currencies";
import { spokenMoney } from "../spoken";

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

/** Actions that never move money (still read back and confirmed with a yes). */
export type AdminKind = "cancel_invoice" | "add_contact" | "set_guardian";
export const isAdmin = (k: string): k is AdminKind => k === "cancel_invoice" || k === "add_contact" || k === "set_guardian";

export interface Plan {
  kind: "pay" | "request" | "split" | AdminKind;
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
  /** cancel_invoice: our transaction row for the invoice. */
  invoiceTxId?: string;
  /** add_contact */
  newContact?: { nickname: string; fullName: string | null; email: string; relationship: "family" | "friend" | "business"; currency: string; country: string };
  /** add_contact: also make them the Guardian contact. set_guardian: who. */
  makeGuardian?: boolean;
  guardianTarget?: { name: string; email: string; relation: string; language: string; replaces: string | null };
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
  /** The user's IANA time zone from the browser (Guardian's "unusual hour" check). */
  timeZone?: string | null;
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
  /** text = shown on screen; say = the short line spoken aloud. */
  reply: Annotation<{ text: string; say?: string } | null>({ reducer: merge, default: () => null }),
  /** Follow-up commands offered as buttons (e.g. the same payment in a supported currency). */
  suggestions: Annotation<string[] | null>({ reducer: merge, default: () => null }),
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

/** Spoken money for the TTS line ("fifty cents"), symbols for the screen. */
const S = spokenMoney;

/**
 * A reply in the user's language: `english` for the screen, `sayEnglish` (one short sentence)
 * for the voice. Both are translated when the user isn't speaking English.
 */
async function replyIn(english: string, language: string, sayEnglish?: string): Promise<{ text: string; say: string }> {
  if (!language || language === "en") return { text: english, say: sayEnglish ?? english };
  if (!sayEnglish) {
    const t = await localize(english, language);
    return { text: t, say: t };
  }
  const [text, say] = await Promise.all([localize(english, language), localize(sayEnglish, language)]);
  return { text, say };
}

/** "Okay, I didn't send anything." / "...didn't change anything." */
const nothingDone = (plan: Plan | null) =>
  plan && isAdmin(plan.kind) ? "Okay, I didn't change anything." : "Okay, I didn't send anything.";

const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
    const reply = await replyIn(`I can send money, ask for money, split a bill, cancel an invoice or add a contact. Try: "Pay Maria 50 euros for the logo."`, language, "I can pay, request or split money for you. Try again?");
    return { intent, receipt, language, outcome: "needs_info", reply, steps: { understood: { status: "warn", title: "Not something I can do", detail: s.input.text } } };
  }
  const missing =
    intent.kind === "split" ? !intent.members.length || !(intent.amount ?? receipt?.total)
    : intent.kind === "cancel_invoice" ? !intent.recipient && !intent.amount
    : intent.kind === "add_contact" ? !intent.recipient || !intent.email
    : intent.kind === "set_guardian" ? !intent.recipient
    : !intent.recipient || !intent.amount;
  if (intent.clarification || missing) {
    const fallback = {
      cancel_invoice: "Which invoice should I cancel? Say who it was for.",
      add_contact: intent.recipient ? `What's ${intent.recipient}'s PayPal email?` : "What's their name and PayPal email?",
      set_guardian: "Who should be your Guardian contact?",
    }[intent.kind as AdminKind] ?? "Who should I pay, and how much?";
    const text = intent.clarification ?? (await localize(fallback, language));
    return { intent, receipt, language, outcome: "needs_info", reply: { text, say: text }, steps: { understood: { status: "warn", title: "Need a detail", detail: text } } };
  }
  const who = intent.kind === "split" ? intent.members.join(", ") : intent.recipient;
  const verb = { pay: "Pay", request: "Request from", split: "Split with", cancel_invoice: "Cancel invoice for", add_contact: "Add contact", set_guardian: "Make Guardian:" }[intent.kind];
  return {
    intent,
    receipt,
    language,
    steps: {
      listening: { status: "done" },
      understood: {
        status: "done",
        title: `${verb} ${who ?? "an invoice"}`,
        detail: [
          intent.kind === "add_contact" ? intent.email : null,
          (intent.amount ?? receipt?.total) ? money((intent.amount ?? receipt!.total)!, intent.currency ?? receipt?.currency ?? user.homeCurrency, language) : null,
          intent.note ?? (receipt?.merchant ? titleCase(receipt.merchant) : null),
        ].filter(Boolean).join(" · "),
      },
    },
  };
}

/**
 * PayPal can't move every currency (e.g. INR cross-border). Catch it before anyone is charged and
 * offer the same amount in currencies PayPal does support.
 */
async function unsupportedCurrency(
  s: AgentState,
  user: User,
  o: { kind: "pay" | "request" | "split"; name: string; amount: number; currency: string; alt: string[] },
): Promise<Partial<AgentState> | null> {
  if (isPayPalCurrency(o.currency)) return null;
  const options: { amount: number; currency: string }[] = [];
  for (const cur of [...new Set(o.alt)].filter((c) => c !== o.currency && isPayPalCurrency(c))) {
    try {
      const { rate } = await getRate(o.currency, cur);
      options.push({ amount: Math.max(0.01, round2(o.amount * rate)), currency: cur });
    } catch {
      /* no rate: skip this option */
    }
  }
  const asked = money(o.amount, o.currency);
  const offer = options.length ? ` ${asked} is about ${options.map((x) => money(x.amount, x.currency)).join(" or ")}. Want me to use that instead?` : " Try US dollars or euros instead.";
  const english = `PayPal can't ${o.kind === "pay" ? "send" : "invoice in"} ${currencyName(o.currency)} (${o.currency}), so ${o.kind === "pay" ? "I didn't charge you anything" : "I didn't send anything"}.${offer}`;
  const sayEn = `PayPal can't ${o.kind === "pay" ? "send" : "invoice in"} ${currencyName(o.currency)}, so nothing was ${o.kind === "pay" ? "charged" : "sent"}; want ${options.length ? options.map((x) => currencyName(x.currency)).join(" or ") : "US dollars"} instead?`;
  const verb = o.kind === "pay" ? `Pay ${o.name}` : o.kind === "request" ? `Ask ${o.name} for` : `Split`;
  const suggestions =
    o.kind === "split"
      ? []
      : options.map((x) => `${verb} ${x.amount.toFixed(x.currency === "JPY" ? 0 : 2)} ${x.currency}${s.intent?.noteEn ? ` for ${s.intent.noteEn}` : ""}`);
  void user;
  return {
    outcome: "needs_info",
    reply: await replyIn(english, s.language, sayEn),
    suggestions,
    steps: { understood: { status: "warn", title: `${o.currency} isn't supported by PayPal`, detail: options.length ? `Try ${options.map((x) => x.currency).join(" or ")}` : undefined } },
  };
}

async function resolve(s: AgentState): Promise<Partial<AgentState>> {
  const user = await loadUser(s.userId);
  const intent = s.intent!;
  const fail: Fail = async (q, sayQ) => {
    const reply = await replyIn(q, s.language, sayQ);
    return { outcome: "needs_info", reply, steps: { understood: { status: "warn", title: "Need a detail", detail: reply.text } } };
  };

  if (intent.kind === "cancel_invoice") return resolveCancel(s, user, fail);
  if (intent.kind === "add_contact") return resolveAddContact(s, user, fail);
  if (intent.kind === "set_guardian") return resolveSetGuardian(s, user, fail);

  if (intent.kind === "split") {
    const total = intent.amount ?? s.receipt?.total ?? 0;
    const currency = intent.currency ?? s.receipt?.currency ?? user.homeCurrency;
    const refs: PartyRef[] = [];
    for (const name of intent.members) {
      const r = await resolveOne(user.id, name);
      if ("ask" in r) return fail(r.ask!);
      refs.push(r.ref);
    }
    const bad = await unsupportedCurrency(s, user, { kind: "split", name: "", amount: total, currency, alt: [user.homeCurrency, "USD", "EUR"] });
    if (bad) return bad;
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
  const bad = await unsupportedCurrency(s, user, { kind, name: r.ref.name, amount: intent.amount!, currency, alt: [user.homeCurrency, r.contact?.currency ?? user.homeCurrency] });
  if (bad) return bad;
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

type Fail = (q: string, sayEnglish?: string) => Promise<Partial<AgentState>>;

/** Find the open invoice the user wants cancelled. Never guesses between several. */
async function resolveCancel(s: AgentState, user: User, fail: Fail): Promise<Partial<AgentState>> {
  const intent = s.intent!;
  let who: { contactId?: string | null; email?: string | null; name?: string | null } = {};
  if (intent.recipient) {
    const r = await resolveRecipient(user.id, intent.recipient);
    if (r.kind === "exact") who = { contactId: r.contact.id, email: r.contact.paypalEmail };
    else if (r.kind === "new_email") who = { email: r.email };
    else if (r.kind === "ambiguous") return fail(`Which ${intent.recipient} do you mean: ${r.candidates.map((c) => c.fullName ?? c.nickname).join(" or ")}?`);
    else who = { name: intent.recipient };
  }
  const open = await listOpenInvoices(user.id);
  const rows = pickInvoices(open, who, intent.amount, intent.currency);
  const label = intent.recipient ?? "anyone";
  if (rows.length === 0) {
    const cur = intent.currency ?? user.homeCurrency;
    const theirs = intent.amount ? pickInvoices(open, who, null, null) : [];
    if (theirs.length) {
      const list = theirs.slice(0, 3).map(({ tx }) => `${money(Number(tx.amount), tx.currency)}${tx.note ? ` for ${tx.note}` : ""}`);
      return fail(
        `I couldn't find a ${money(intent.amount!, cur)} invoice for ${label}. Their unpaid ${theirs.length === 1 ? "invoice is" : "invoices are"}: ${list.join("; ")}. Say which amount to cancel.`,
        `I couldn't find a ${S(intent.amount!, cur)} invoice for ${label}; the open ones are on screen.`,
      );
    }
    return fail(
      `I couldn't find an unpaid invoice for ${label}${intent.amount ? ` for ${money(intent.amount, cur)}` : ""}. Nothing to cancel.`,
      `I couldn't find an unpaid invoice for ${label}${intent.amount ? ` for ${S(intent.amount, cur)}` : ""}.`,
    );
  }
  if (rows.length > 1) {
    const list = rows.slice(0, 3).map(({ tx, nickname }) => `${money(Number(tx.amount), tx.currency)}${intent.recipient ? "" : ` to ${nickname ?? tx.counterpartyName}`}${tx.note ? ` for ${tx.note}` : ""}`);
    return fail(`${cap(label)} has ${rows.length} unpaid invoices: ${list.join("; ")}. Which one should I cancel? Say the amount.`, `${cap(label)} has ${rows.length} unpaid invoices. Which amount should I cancel?`);
  }
  const { tx, nickname } = rows[0];
  const name = nickname ?? tx.counterpartyName ?? tx.counterpartyEmail;
  const party: PartyRef = tx.contactId ? { contactId: tx.contactId, name } : { email: tx.counterpartyEmail, name };
  return {
    plan: { kind: "cancel_invoice", party, amount: Number(tx.amount), currency: tx.currency, note: tx.note, noteEn: tx.note, invoiceTxId: tx.id },
    steps: { understood: { status: "done", title: `Cancel ${name}'s invoice`, detail: `${money(Number(tx.amount), tx.currency, s.language)}${tx.note ? ` · ${tx.note}` : ""}` } },
  };
}

async function resolveAddContact(s: AgentState, user: User, fail: Fail): Promise<Partial<AgentState>> {
  const intent = s.intent!;
  const fullName = intent.recipient!.trim().replace(/\s+/g, " ");
  const nickname = cap(fullName.split(" ")[0]);
  if (!isEmail(intent.email)) return fail(`I didn't catch a valid email for ${nickname}. Say it again, like "${nickname.toLowerCase()} at example dot com".`);
  const conflict = await findContactConflict(user.id, nickname, intent.email);
  if (conflict?.field === "name") return fail(`You already have a contact called ${conflict.contact.nickname} (${conflict.contact.paypalEmail}).`);
  if (conflict?.field === "email") return fail(`That email is already saved as ${conflict.contact.nickname}.`);
  const relationship = intent.relationship ?? "friend";
  return {
    plan: {
      kind: "add_contact",
      amount: 0,
      currency: user.homeCurrency,
      note: null,
      noteEn: null,
      newContact: { nickname, fullName: fullName.includes(" ") ? fullName.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : null, email: intent.email, relationship, currency: user.homeCurrency, country: user.country },
      makeGuardian: !!intent.makeGuardian,
      ...(intent.makeGuardian
        ? { guardianTarget: { name: fullName, email: intent.email, relation: relationship === "business" ? "trusted contact" : relationship, language: user.language, replaces: (await getTrustedContact(user.id))?.name ?? null } }
        : {}),
    },
    steps: { understood: { status: "done", title: `Add ${nickname}`, detail: `${intent.email} · ${relationship}` } },
  };
}

async function resolveSetGuardian(s: AgentState, user: User, fail: Fail): Promise<Partial<AgentState>> {
  const intent = s.intent!;
  const current = await getTrustedContact(user.id);
  const r = await resolveRecipient(user.id, intent.recipient!);
  let target: { name: string; email: string; relation: string; language: string; ref: PartyRef };
  if (r.kind === "exact") {
    const c = r.contact;
    target = { name: c.fullName ?? c.nickname, email: c.paypalEmail, relation: c.relationship === "business" ? "trusted contact" : "family", language: c.language, ref: { contactId: c.id, name: c.nickname } };
  } else if (r.kind === "new_email") {
    target = { name: r.email, email: r.email, relation: "trusted contact", language: user.language, ref: { email: r.email, name: r.email } };
  } else if (r.kind === "ambiguous") {
    return fail(`Which ${intent.recipient} do you mean: ${r.candidates.map((c) => c.fullName ?? c.nickname).join(" or ")}?`);
  } else if (current && normalizeName(current.name).split(/\s+/).includes(normalizeName(intent.recipient!))) {
    return { outcome: "needs_info", reply: await replyIn(`${current.name} is already your Guardian contact.`, s.language), steps: { understood: { status: "done", title: "Already your Guardian", detail: current.name } } };
  } else {
    return fail(`I don't have ${intent.recipient}'s email yet. Say: "Add ${intent.recipient}, their email, and make them my guardian."`);
  }
  if (current && current.email.toLowerCase() === target.email.toLowerCase()) {
    return { outcome: "needs_info", reply: await replyIn(`${current.name} is already your Guardian contact.`, s.language), steps: { understood: { status: "done", title: "Already your Guardian", detail: current.name } } };
  }
  return {
    plan: {
      kind: "set_guardian",
      party: target.ref,
      amount: 0,
      currency: user.homeCurrency,
      note: null,
      noteEn: null,
      guardianTarget: { name: target.name, email: target.email, relation: target.relation, language: target.language, replaces: current?.name ?? null },
    },
    steps: { understood: { status: "done", title: `Make ${target.ref.name} your Guardian`, detail: target.email } },
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
  const name = plan.party?.name ?? plan.members?.map((m) => m.party.name).join(", ") ?? plan.newContact?.nickname ?? "";
  const email = plan.party && "email" in plan.party ? plan.party.email : plan.party ? ((await loadContact((plan.party as { contactId: string }).contactId))?.paypalEmail ?? "") : "";
  const { rate } = await getRate(plan.currency, user.homeCurrency);
  const g = await runGuardian({ user, kind: plan.kind, counterpartyEmail: email, counterpartyName: name, homeAmount: round2(plan.amount * rate), command: s.input.text, voice: s.voice, timeZone: s.input.timeZone });

  const status: StepStatus = g.decision === "ALLOW" ? "done" : g.decision === "BLOCK" ? "error" : "warn";
  const title = { ALLOW: "Looks safe", ASK_QUESTIONS: "Needs a closer look", GUARDIAN_HOLD: "Held for family approval", PASSKEY_REQUIRED: "Extra check needed", BLOCK: "Stopped" }[g.decision];
  if (g.decision === "BLOCK") {
    const reply = await replyIn(`I stopped this payment. ${g.explanation} I didn't send anything.`, s.language, "I stopped this payment, and nothing was sent.");
    return { guardian: g, outcome: "blocked", reply, steps: { guardian: { status, title, detail: g.explanation }, done: { status: "error", title: "Not sent" } } };
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
  const verb = { pay: "pay", request: "ask", split: "split a bill with", cancel_invoice: "cancel the invoice for", add_contact: "add the contact", set_guardian: "make Guardian contact" }[plan.kind];
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
      const reply = await replyIn("Okay, I've cancelled it. Nothing was sent.", s.language);
      return { outcome: "cancelled", reply, steps: { guardian: { status: "skipped", title: "Cancelled" }, done: { status: "skipped", title: "Not sent" } } };
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
    const reply = await replyIn("Okay, I've cancelled it. Nothing was sent.", s.language);
    return { hold: { status: "cancelled", contactName, url }, outcome: "cancelled", reply, steps: { guardian: { status: "skipped", title: "Cancelled" }, done: { status: "skipped", title: "Not sent" } } };
  }
  const reply = await replyIn(`${contactName} stopped this payment. Nothing was sent, and your money is safe.`, s.language, `${contactName} stopped this payment, and your money is safe.`);
  return { hold: { status: "denied", contactName, url }, outcome: "blocked", reply, steps: { guardian: { status: "error", title: `${contactName} stopped it` }, done: { status: "error", title: "Not sent" } } };
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
      // One short sentence for the ear; the card shows fees, rate and type.
      spoken:
        quote.converted || quote.fees.length
          ? `Send ${name} ${S(quote.recipientReceives.amount, quote.recipientReceives.currency)}${plan.note ? ` for ${plan.note}` : ""}, ${S(quote.total, quote.homeCurrency)} in total?`
          : `Send ${name} ${S(quote.recipientReceives.amount, quote.recipientReceives.currency)}${plan.note ? ` for ${plan.note}` : ""}?`,
    };
    void feeText;
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
      spoken: `Ask ${name} for ${S(plan.amount, plan.currency)}${plan.note ? ` for ${plan.note}` : ""}?`,
    };
  } else if (plan.kind === "cancel_invoice") {
    const name = plan.party!.name;
    readback = {
      title: `Cancel ${name}'s invoice`,
      lines: [
        { label: "Invoice to", value: name },
        { label: "Amount", value: money(plan.amount, plan.currency, L), emphasis: true },
        ...(plan.note ? [{ label: "For", value: plan.note }] : []),
      ],
      notes: ["PayPal cancels the invoice and tells them they don't need to pay it. No money moves."],
      spoken: `Cancel ${name}'s invoice for ${S(plan.amount, plan.currency)}?`,
    };
  } else if (plan.kind === "add_contact") {
    const c = plan.newContact!;
    readback = {
      title: `Add ${c.nickname}`,
      lines: [
        { label: "Name", value: c.fullName ?? c.nickname, emphasis: true },
        { label: "PayPal email", value: c.email },
        { label: "Relationship", value: cap(c.relationship) },
        { label: "Currency", value: c.currency },
        ...(plan.makeGuardian ? [{ label: "Guardian contact", value: plan.guardianTarget?.replaces ? `Yes (replaces ${plan.guardianTarget.replaces})` : "Yes" }] : []),
      ],
      notes: plan.makeGuardian ? [`${c.nickname} will get a link to approve or stop risky payments.`] : ["Saved contacts can be paid by name."],
      spoken: `Add ${c.nickname} as a ${c.relationship === "business" ? "business" : c.relationship} contact${plan.makeGuardian ? " and your Guardian" : ""}?`,
    };
  } else if (plan.kind === "set_guardian") {
    const t = plan.guardianTarget!;
    const name = plan.party!.name;
    readback = {
      title: `Make ${name} your Guardian`,
      lines: [
        { label: "Guardian contact", value: t.name, emphasis: true },
        { label: "Email", value: t.email },
        ...(t.replaces ? [{ label: "Replaces", value: t.replaces }] : []),
      ],
      notes: [`When Guardian pauses a risky payment, ${name} gets a link to approve or stop it.`],
      spoken: `Make ${name} your trusted Guardian?`,
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
      spoken: (() => {
        const names = plan.members!.map((m) => m.party.name);
        const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
        const same = plan.members!.every((m) => m.share === plan.members![0].share);
        return `Split ${S(plan.amount, plan.currency)} with ${who}${same ? `, ${S(plan.members![0].share, plan.currency)} each` : ""}?`;
      })(),
    };
    void per;
  }

  if (s.hold?.status === "approved") {
    readback.notes.unshift(`Guardian: ${s.hold.contactName} approved this payment.`);
  } else if (s.interview?.verdict === "safe") {
    readback.notes.unshift("Guardian: thanks for answering the questions.");
  } else if (s.guardian && s.guardian.decision !== "ALLOW") {
    readback.notes.unshift(`Guardian: ${s.guardian.explanation}`);
  }
  const warn = s.guardian && s.guardian.decision !== "ALLOW" && s.hold?.status !== "approved" && s.interview?.verdict !== "safe";
  // Money leaving an enrolled user's account needs a fresh random phrase, said in their voice.
  // A recording can't contain a phrase that didn't exist yet, so this defeats replay.
  let challenge: string | null = null;
  if (plan.kind === "pay" && s.voice?.enrolled) {
    challenge = makeChallenge(L === "es" ? "es" : "en");
    readback.spoken = `To send ${plan.party!.name} ${S(plan.amount, plan.currency)}, say: "${challenge}".`;
  }
  if (warn) readback.spoken = `Heads up, this looks unusual. ${readback.spoken}`;
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
    reply: await replyIn(english, s.language),
    steps: { confirm: { status: outcome === "blocked" ? "error" : "skipped", title: outcome === "blocked" ? "Voice didn't match" : "Cancelled" }, done: { status: outcome === "blocked" ? "error" : "skipped", title: "Not sent" } },
    ...extra,
  });
  const again = async (english: string, extra: Partial<AgentState> = {}): Promise<Partial<AgentState>> =>
    attempts >= 3
      ? cancel(nothingDone(s.plan), "cancelled", extra)
      : {
          answer: "unclear",
          confirmAttempts: attempts,
          confirmNote: await localize(english, s.language),
          steps: { confirm: { status: "active", title: s.challenge ? "Say the phrase to confirm" : "Say yes or no", detail: s.challenge ? `"${s.challenge}"` : s.readback!.title } },
          ...extra,
        };

  if (said === "no") return cancel(nothingDone(s.plan));

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
    let sayEn: string | undefined;
    if (plan.kind === "cancel_invoice") {
      const tx = await cancelOpenInvoice(user, plan.invoiceTxId!);
      result = { kind: plan.kind, transactionIds: [tx.id], status: tx.status };
      english = `Cancelled. ${plan.party!.name}'s invoice for ${money(plan.amount, plan.currency, L)} is void, and PayPal let them know.`;
      sayEn = `Done, I cancelled ${plan.party!.name}'s invoice.`;
    } else if (plan.kind === "add_contact") {
      const c = plan.newContact!;
      await addContact(user, { nickname: c.nickname, fullName: c.fullName, email: c.email, relationship: c.relationship === "business" ? "business" : "friends_family", currency: c.currency, country: c.country, language: user.language });
      if (plan.makeGuardian && plan.guardianTarget) {
        const t = plan.guardianTarget;
        await setTrustedContact(user.id, { name: c.fullName ?? c.nickname, email: t.email, relation: t.relation, language: t.language });
      }
      result = { kind: plan.kind, transactionIds: [], status: "saved" };
      english = `Added ${c.nickname} (${c.email}) to your contacts${plan.makeGuardian ? ", and made them your Guardian contact" : ""}.`;
      sayEn = `Added ${c.nickname}${plan.makeGuardian ? " as your Guardian" : ""}.`;
    } else if (plan.kind === "set_guardian") {
      const t = plan.guardianTarget!;
      await setTrustedContact(user.id, { name: t.name, email: t.email, relation: t.relation, language: t.language });
      result = { kind: plan.kind, transactionIds: [], status: "saved" };
      english = `${plan.party!.name} is now your Guardian contact. Risky payments will wait for their approval.`;
      sayEn = `Done, ${plan.party!.name} is now your Guardian.`;
    } else if (plan.kind === "pay") {
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
      sayEn = `Done, ${plan.party!.name} is getting ${S(plan.amount, plan.currency)}.`;
    } else if (plan.kind === "request") {
      const r = await createRequest(user, { from: await toParty(plan.party!), amount: plan.amount, currency: plan.currency, note: plan.noteEn ?? undefined, item: plan.noteEn ?? undefined, command: s.input.text, source: s.input.source, guardian: g });
      result = { kind: "request", transactionIds: [r.transaction.id], status: r.transaction.status, payUrl: r.invoice.payerViewUrl, qr: r.invoice.qrDataUrl };
      english = `Sent. ${plan.party!.name} has a PayPal invoice for ${money(plan.amount, plan.currency, L)}.`;
      sayEn = `Sent, ${plan.party!.name} has the invoice.`;
    } else {
      const members = [];
      for (const m of plan.members!) members.push({ party: await toParty(m.party), amount: m.share });
      const r = await createSplit(user, { title: plan.title!, currency: plan.currency, total: plan.amount, members, command: s.input.text, source: s.input.source, receipt: s.receipt ?? undefined });
      const ok = r.members.filter((m) => m.ok);
      result = { kind: "split", transactionIds: ok.map((m) => m.transaction.id), status: ok.length === r.members.length ? "sent" : "partial" };
      english = ok.length === r.members.length ? `Sent ${ok.length} invoices. I'll let you know when they pay.` : `Sent ${ok.length} of ${r.members.length} invoices; some failed.`;
    }
    if (s.guardian.eventId && result.transactionIds[0] && !isAdmin(plan.kind)) await linkGuardianEvent(s.guardian.eventId, result.transactionIds[0]);
    const title = { pay: "Paid", request: "Requested", split: "Invoices sent", cancel_invoice: "Invoice cancelled", add_contact: "Contact added", set_guardian: "Guardian updated" }[plan.kind];
    const reply = await replyIn(english, L, sayEn);
    return { result, outcome: "done", reply, steps: { done: { status: "done", title, detail: reply.text } } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reply = await replyIn(`That didn't go through: ${msg}`, L, "Sorry, that didn't go through. The details are on screen.");
    return { outcome: "error", reply, steps: { done: { status: "error", title: "Didn't go through", detail: msg } } };
  }
}

async function respond(s: AgentState): Promise<Partial<AgentState>> {
  return s.reply ? {} : { reply: await replyIn("Okay.", s.language) };
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
