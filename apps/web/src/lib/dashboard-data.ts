import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db";

// Flat, display-ready rows for the AG Studio dashboard. Amounts in USD (the user's home currency)
// so totals across currencies are meaningful; the original currency stays alongside.

export interface TxRow {
  id: string;
  date: string; // YYYY-MM-DD
  kind: "Paid" | "Requested" | "Split share";
  person: string;
  country: string;
  currency: string;
  amount: number; // in `currency`
  amountUsd: number;
  feeUsd: number;
  status: string;
  risk: number | null; // 0-100
  decision: string;
  category: "Friends & Family" | "Goods & Services" | "—";
  route: "Abroad" | "Domestic";
  channel: "Voice" | "Typed" | "API" | "History";
  note: string;
}

export interface GuardianRow {
  id: string;
  date: string;
  decision: string;
  risk: number; // 0-100
  scam: number; // 0-100
  signals: string;
  person: string;
  intervened: number; // 1 if Guardian questioned, held or blocked
}

export interface OwedRow {
  id: string;
  person: string;
  forWhat: string;
  amountUsd: number;
  currency: string;
  amount: number;
  daysOpen: number;
}

export interface DashboardData {
  transactions: TxRow[];
  guardian: GuardianRow[];
  owed: OwedRow[];
  asOf: string;
  homeCountry: string;
}

const STATUS: Record<string, string> = {
  completed: "Done",
  sent: "On its way",
  unclaimed: "Unclaimed",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
  pending: "Pending",
};
const DECISION: Record<string, string> = {
  ALLOW: "Allowed",
  ASK_QUESTIONS: "Questioned",
  GUARDIAN_HOLD: "Held for family",
  PASSKEY_REQUIRED: "Extra check",
  BLOCK: "Stopped",
};
const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

export async function loadDashboardData(userId: string, homeCountry: string): Promise<DashboardData> {
  const t = schema.transactions;
  const c = schema.contacts;
  const rows = await db
    .select({ tx: t, nickname: c.nickname, country: c.country })
    .from(t)
    .leftJoin(c, eq(c.id, t.contactId))
    .where(eq(t.userId, userId))
    .orderBy(desc(t.createdAt));

  const transactions: TxRow[] = rows
    .filter((r) => r.tx.status !== "failed" || r.tx.source !== "seed")
    .map(({ tx, nickname, country }) => ({
      id: tx.id,
      date: day(tx.createdAt),
      kind: tx.type === "pay" ? "Paid" : tx.type === "request" ? "Requested" : "Split share",
      person: nickname ?? tx.counterpartyName ?? tx.counterpartyEmail,
      country: country ?? homeCountry,
      currency: tx.currency,
      amount: num(tx.amount),
      amountUsd: num(tx.homeAmount ?? tx.amount),
      feeUsd: num(tx.fee),
      status: STATUS[tx.status] ?? tx.status,
      risk: tx.riskScore == null ? null : Math.round(tx.riskScore * 100),
      decision: tx.decision ? (DECISION[tx.decision] ?? tx.decision) : "—",
      category: tx.relationship === "business" ? "Goods & Services" : tx.relationship === "friends_family" ? "Friends & Family" : "—",
      route: (country ?? homeCountry) !== homeCountry ? "Abroad" : "Domestic",
      channel: tx.source === "voice" ? "Voice" : tx.source === "text" ? "Typed" : tx.source === "api" ? "API" : "History",
      note: tx.note ?? "",
    }));

  const g = schema.guardianEvents;
  const events = await db
    .select({ ev: g, person: t.counterpartyName, nickname: c.nickname })
    .from(g)
    .leftJoin(t, eq(t.id, g.transactionId))
    .leftJoin(c, eq(c.id, t.contactId))
    .where(eq(g.userId, userId))
    .orderBy(desc(g.createdAt));
  const guardian: GuardianRow[] = events.map(({ ev, person, nickname }) => ({
    id: ev.id,
    date: day(ev.createdAt),
    decision: DECISION[ev.decision] ?? ev.decision,
    risk: Math.round((ev.riskScore ?? 0) * 100),
    scam: Math.round((ev.scamScore ?? 0) * 100),
    signals: (ev.signals ?? []).map((s) => s.label).join("; "),
    person: nickname ?? person ?? "—",
    intervened: ev.decision === "ALLOW" ? 0 : 1,
  }));

  const now = Date.now();
  const owed: OwedRow[] = rows
    .filter(({ tx }) => (tx.type === "request" || tx.type === "split") && tx.status === "sent")
    .map(({ tx, nickname }) => ({
      id: tx.id,
      person: nickname ?? tx.counterpartyName ?? tx.counterpartyEmail,
      forWhat: (tx.note ?? "").replace(/^Your share of /, ""),
      amountUsd: num(tx.homeAmount ?? tx.amount),
      currency: tx.currency,
      amount: num(tx.amount),
      daysOpen: Math.max(0, Math.floor((now - tx.createdAt.getTime()) / 86_400_000)),
    }));

  return { transactions, guardian, owed, asOf: new Date().toISOString(), homeCountry };
}
