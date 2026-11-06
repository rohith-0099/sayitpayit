import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { classifyScam } from "../guardian-client";
import type { User } from "../db/schema";

export type Decision = "ALLOW" | "ASK_QUESTIONS" | "GUARDIAN_HOLD" | "PASSKEY_REQUIRED" | "BLOCK";

export interface Signal {
  id: string;
  label: string;
  weight: number;
}

export interface GuardianResult {
  decision: Decision;
  riskScore: number;
  scamScore: number;
  signals: Signal[];
  explanation: string;
  /** Which engine produced this: the Guardian ML service (Phase 6+) or interim rules. */
  engine: "guardian-service" | "rules";
  eventId?: string;
}

export interface GuardianInput {
  user: User;
  kind: "pay" | "request" | "split";
  counterpartyEmail: string;
  counterpartyName: string;
  homeAmount: number;
  command: string;
  voice?: { status: string; spoofSuspect?: boolean | null } | null;
}

// Fallback scam cues, used only when the Guardian service (our classifier) is unreachable.
const SCAM_CUES: { id: string; label: string; re: RegExp }[] = [
  { id: "gift_cards", label: "Mentions gift cards", re: /gift ?cards?|tarjetas? de regalo|itunes|google play card|steam card|geschenkkarte/i },
  { id: "authority", label: "Claims to be the tax office, police or a bank", re: /\b(irs|tax office|taxman|police|sheriff|social security|bank called|hacienda|polic[ií]a|sat\b|finanzamt|income tax)/i },
  { id: "urgency", label: "Urgent pressure", re: /\b(urgent|urgently|right now|immediately|asap|urgente|ahora mismo|sofort|tout de suite)\b/i },
  { id: "secrecy", label: "Told to keep it secret", re: /(don'?t tell|do not tell|keep (it|this) (a )?secret|no le digas|no se lo digas|nicht sagen|ne dis pas)/i },
  { id: "crypto_wire", label: "Crypto, wire or gift-card style payment", re: /\b(bitcoin|crypto|usdt|western union|wire transfer|moneygram)\b/i },
];

const W = { newPayee: 0.2, spike: 0.3, large: 0.2, oddHour: 0.1, scamCue: 0.3 };

export async function runGuardian(input: GuardianInput): Promise<GuardianResult> {
  const { user } = input;
  const signals: Signal[] = [];

  // Requests/splits ask others for money; nothing leaves the user's account.
  if (input.kind === "pay") {
    const history = await db
      .select({ homeAmount: schema.transactions.homeAmount, email: schema.transactions.counterpartyEmail })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, user.id),
          eq(schema.transactions.type, "pay"),
          inArray(schema.transactions.status, ["completed", "sent", "unclaimed"]),
        ),
      );
    const toPayee = history.filter((h) => h.email.toLowerCase() === input.counterpartyEmail.toLowerCase());
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)] : 0;
    };
    const payeeTypical = median(toPayee.map((h) => Number(h.homeAmount ?? 0)));
    const overallTypical = median(history.map((h) => Number(h.homeAmount ?? 0)));

    if (toPayee.length === 0) signals.push({ id: "new_payee", label: `First payment to ${input.counterpartyName}`, weight: W.newPayee });
    const typical = toPayee.length >= 2 ? payeeTypical : overallTypical;
    if (typical > 0 && input.homeAmount > 3 * typical) {
      signals.push({ id: "amount_spike", label: `About ${Math.round(input.homeAmount / typical)}x your usual amount`, weight: W.spike });
    }
    if (input.homeAmount >= 1000) signals.push({ id: "large_amount", label: "Large amount", weight: W.large });

    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: user.timezone }).format(new Date()));
    if (hour >= 0 && hour < 5) signals.push({ id: "odd_hour", label: "Unusual time of night for you", weight: W.oddHour });
  }

  // Voice gate results (Phase 5). A payment in someone else's voice, or one we can't check
  // because the voice service is down, never goes out (fail closed).
  const v = input.voice;
  let forceBlock = false;
  if (input.kind === "pay" && v?.status === "failed") {
    signals.push({ id: "voice_mismatch", label: "The voice doesn't match yours", weight: 0.9 });
    forceBlock = true;
  }
  if (input.kind === "pay" && v?.status === "unavailable") {
    signals.push({ id: "voice_unavailable", label: "Couldn't check your voice (Guardian offline)", weight: 0.5 });
    forceBlock = true;
  }
  if (input.kind === "pay" && v?.status === "unsure") signals.push({ id: "voice_unsure", label: "Couldn't fully confirm your voice", weight: 0.3 });
  // Weak signal (AASIST-L false-positives on live mics); only raised for very high scores (Guardian threshold 0.9).
  if (v?.spoofSuspect) signals.push({ id: "synthetic_voice", label: "The voice may be a recording or AI voice", weight: 0.1 });

  // Scam language: our fine-tuned multilingual classifier in the Guardian service (Phase 6).
  // If Guardian is unreachable, fall back to local keyword cues so a check still happens.
  const model = await classifyScam(input.command);
  let scamScore: number;
  let cueCount: number;
  if (model) {
    scamScore = model.probability;
    cueCount = model.signals.length;
    if (scamScore >= 0.5) signals.push({ id: "scam_language", label: `Sounds like a known scam (${Math.round(scamScore * 100)}% match)`, weight: Math.min(0.7, scamScore * 0.7) });
    for (const c of model.signals) signals.push({ id: c.id, label: c.label, weight: scamScore >= 0.5 ? 0.15 : 0.05 });
  } else {
    const cues = SCAM_CUES.filter((c) => c.re.test(input.command));
    for (const c of cues) signals.push({ id: c.id, label: c.label, weight: W.scamCue });
    scamScore = Math.min(1, cues.length * 0.35);
    cueCount = cues.length;
  }

  const riskScore = Math.round((1 - signals.reduce((p, s) => p * (1 - s.weight), 1)) * 100) / 100;
  // Interim decision rules; Phase 7 adds the Scam Interrupt questions and Guardian-mode hold.
  let decision: Decision =
    input.kind !== "pay" ? "ALLOW"
    : (scamScore >= 0.9 && cueCount >= 2) || riskScore >= 0.9 ? "BLOCK"
    : scamScore >= 0.5 || riskScore >= 0.45 ? "ASK_QUESTIONS"
    : "ALLOW";
  if (decision === "ALLOW" && input.kind === "pay" && input.homeAmount >= 1000) decision = "PASSKEY_REQUIRED";
  if (forceBlock) decision = "BLOCK";

  const explanation =
    signals.length === 0
      ? input.kind === "pay"
        ? `Normal payment to someone you pay regularly.`
        : `Asking for money doesn't move any of yours, so this is low risk.`
      : decision === "ALLOW"
        ? `Looks OK. Noted: ${signals.map((s) => s.label.toLowerCase()).join("; ")}.`
        : decision === "BLOCK"
          ? `${signals.map((s) => s.label).join(". ")}.`
          : `Flagged: ${signals.map((s) => s.label.toLowerCase()).join("; ")}.`;

  const [event] = await db
    .insert(schema.guardianEvents)
    .values({ userId: user.id, decision, riskScore, scamScore, signals, explanation })
    .returning({ id: schema.guardianEvents.id });

  return { decision, riskScore, scamScore, signals, explanation, engine: model ? "guardian-service" : "rules", eventId: event.id };
}

export async function linkGuardianEvent(eventId: string, transactionId: string) {
  await db.update(schema.guardianEvents).set({ transactionId }).where(eq(schema.guardianEvents.id, eventId));
}

