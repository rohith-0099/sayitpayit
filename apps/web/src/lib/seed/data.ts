// Deterministic demo data: Sam's contacts and ~60 days of realistic money history.
// Pure (no I/O) so it's unit tested; scripts/seed.ts writes it to Postgres.
import { fallbackRate, round2 } from "../fx";

export type ContactKey = "john" | "maria" | "ana" | "kenji";

export const SEED_CONTACTS: Record<
  ContactKey,
  {
    nickname: string;
    fullName: string;
    aliases: string[];
    paypalEmail: string;
    currency: string;
    country: string;
    language: string;
    relationship: "friends_family" | "business";
    sandboxAccount: boolean;
  }
> = {
  // Real PayPal sandbox accounts: money actually lands here in the demo.
  john: {
    nickname: "John",
    fullName: "John Miller",
    aliases: ["Johnny", "Jon"],
    paypalEmail: "sb-avlzc53756906@personal.example.com",
    currency: "USD",
    country: "US",
    language: "en",
    relationship: "friends_family",
    sandboxAccount: true,
  },
  maria: {
    nickname: "Maria",
    fullName: "Maria Schmidt",
    aliases: ["Mariya", "Marie"],
    paypalEmail: "sb-nipbf53756879@personal.example.com",
    currency: "EUR",
    country: "DE",
    language: "de",
    relationship: "business",
    sandboxAccount: true,
  },
  // History-only contacts (example.com, never real money) for a richer dashboard.
  ana: {
    nickname: "Ana",
    fullName: "Ana López",
    aliases: ["Anita", "Ana Lopez"],
    paypalEmail: "ana.lopez@example.com",
    currency: "MXN",
    country: "MX",
    language: "es",
    relationship: "friends_family",
    sandboxAccount: false,
  },
  kenji: {
    nickname: "Kenji",
    fullName: "Kenji Tanaka",
    aliases: ["Kenji-san"],
    paypalEmail: "kenji.tanaka@example.com",
    currency: "JPY",
    country: "JP",
    language: "ja",
    relationship: "business",
    sandboxAccount: false,
  },
};

export const SEED_TRUSTED_CONTACT = {
  name: "Elena Rivera",
  email: "elena.rivera@example.com",
  relation: "sister",
  language: "en",
};

export type SeedStatus = "completed" | "sent" | "unclaimed";

export interface SeedTx {
  key: string; // stable id within the seed, used to link splits/events
  type: "pay" | "request" | "split";
  contact: ContactKey;
  amount: number;
  currency: string;
  homeAmount: number;
  fxRate: number;
  note: string;
  command: string;
  status: SeedStatus;
  createdAt: Date;
  riskScore: number;
  splitKey?: string;
}

export interface SeedSplit {
  key: string;
  title: string;
  total: number;
  currency: string;
  myShare: number;
  createdAt: Date;
  members: { contact: ContactKey; share: number; status: SeedStatus }[];
}

export interface SeedGuardianEvent {
  txKey: string;
  decision: "ALLOW" | "ASK_QUESTIONS";
  riskScore: number;
  scamScore: number;
  voiceMatch: number;
  spoofScore: number;
  signals: { id: string; label: string; weight?: number }[];
  explanation: string;
  resolution?: Record<string, unknown>;
}

/** mulberry32: tiny seeded PRNG so every seed run produces identical history. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME = "USD";
const DAY = 86_400_000;

export function generateSeed(now = new Date(), days = 60, seed = 20261112) {
  const rand = prng(seed);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  /** A timestamp `daysAgo` back, during waking hours (8:00–22:00 New York ≈ 13:00–03:00 UTC). */
  const at = (daysAgo: number) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setUTCHours(13 + Math.floor(rand() * 14), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
    return d.getTime() > now.getTime() ? new Date(now.getTime() - 3_600_000) : d;
  };

  const txs: SeedTx[] = [];
  const splits: SeedSplit[] = [];
  const events: SeedGuardianEvent[] = [];
  let n = 0;

  const add = (t: Omit<SeedTx, "key" | "homeAmount" | "fxRate" | "riskScore"> & { riskScore?: number }) => {
    const fxRate = fallbackRate(t.currency, HOME);
    const tx: SeedTx = {
      ...t,
      key: `tx${++n}`,
      fxRate: round2(fxRate * 1e4) / 1e4,
      homeAmount: round2(t.amount * fxRate),
      riskScore: t.riskScore ?? round2(between(0.01, 0.12) * 100) / 100,
    };
    txs.push(tx);
    return tx;
  };

  // John: small F&F payments every few days.
  const johnNotes = ["Coffee", "Lunch", "Movie tickets", "Pizza night", "Uber share", "Groceries", "Gas money"];
  for (let d = days - 2; d > 1; d -= 2 + Math.floor(rand() * 4)) {
    const note = pick(johnNotes);
    const amount = Math.round(between(6, 45));
    add({ type: "pay", contact: "john", amount, currency: "USD", note, command: `Pay John ${amount} dollars for ${note.toLowerCase()}`, status: "completed", createdAt: at(d) });
  }

  // John owes Sam his utilities share each month (requests).
  for (const [d, status] of [[55, "completed"], [25, "completed"]] as const) {
    const amount = Math.round(between(60, 90));
    add({ type: "request", contact: "john", amount, currency: "USD", note: "Utilities share", command: `Ask John for ${amount} dollars for utilities`, status, createdAt: at(d) });
  }

  // Maria: logo/branding work, paid in EUR (Goods & Services).
  for (const [d, note, amount] of [
    [52, "Logo concepts", 180],
    [38, "Brand guidelines", 320],
    [17, "Social media pack", 150],
    [6, "Logo final files", 50],
  ] as const) {
    add({ type: "pay", contact: "maria", amount, currency: "EUR", note, command: `Pay Maria ${amount} euros for ${note.toLowerCase()}`, status: "completed", createdAt: at(d) });
  }

  // Ana: monthly family support in MXN (commands sometimes in Spanish).
  for (const [d, note, amount, cmd] of [
    [58, "Para la renta", 2500, "Mándale 2500 pesos a Ana para la renta"],
    [44, "Cumpleaños de mamá", 1800, "Send Ana 1800 pesos for mom's birthday"],
    [28, "Para la renta", 2500, "Mándale 2500 pesos a Ana para la renta"],
  ] as const) {
    add({ type: "pay", contact: "ana", amount, currency: "MXN", note, command: cmd, status: "completed", createdAt: at(d) });
  }
  // One larger-than-usual payment that Guardian questioned, then allowed.
  const bigAna = add({
    type: "pay",
    contact: "ana",
    amount: 9000,
    currency: "MXN",
    note: "Hospital bill for tía Carmen",
    command: "Mándale 9000 pesos a Ana, es urgente, para el hospital",
    status: "completed",
    createdAt: at(11),
    riskScore: 0.46,
  });

  // Kenji: one translation job. He hasn't claimed it yet (no PayPal account on that email).
  add({ type: "pay", contact: "kenji", amount: 15000, currency: "JPY", note: "Website translation (JA)", command: "Pay Kenji 15000 yen for the Japanese translation", status: "unclaimed", createdAt: at(9), riskScore: 0.18 });

  // Splits: one invoice per member, mixed paid/unpaid for the "who owes what" scoreboard.
  const addSplit = (
    title: string,
    total: number,
    currency: string,
    daysAgo: number,
    members: { contact: ContactKey; status: SeedStatus }[],
  ) => {
    const people = members.length + 1;
    const cents = Math.round(total * 100);
    const base = Math.floor(cents / people);
    const myShare = (cents - base * members.length) / 100; // Sam keeps any extra cents
    const key = `split${splits.length + 1}`;
    const createdAt = at(daysAgo);
    const split: SeedSplit = { key, title, total, currency, myShare, createdAt, members: [] };
    for (const m of members) {
      const share = base / 100;
      split.members.push({ contact: m.contact, share, status: m.status });
      add({
        type: "split",
        contact: m.contact,
        amount: share,
        currency,
        note: `Your share of ${title}`,
        command: `Split ${title.toLowerCase()} ${total} ${currency} with ${members.map((x) => SEED_CONTACTS[x.contact].nickname).join(" and ")}`,
        status: m.status,
        createdAt,
        splitKey: key,
      });
    }
    splits.push(split);
  };
  addSplit("Dinner at Nopa", 96, "USD", 33, [{ contact: "john", status: "completed" }]);
  addSplit("Berlin trip Airbnb", 450, "EUR", 20, [
    { contact: "maria", status: "completed" },
    { contact: "john", status: "sent" },
  ]);
  addSplit("Concert tickets", 180, "USD", 4, [
    { contact: "john", status: "completed" },
    { contact: "ana", status: "sent" },
  ]);

  // One open request (John hasn't paid yet).
  add({ type: "request", contact: "john", amount: 40, currency: "USD", note: "Half of the Costco run", command: "Ask John for 40 dollars for half the Costco run", status: "sent", createdAt: at(2) });

  // Guardian ran on every outgoing payment.
  for (const t of txs) {
    if (t.type !== "pay") continue;
    if (t.key === bigAna.key) {
      events.push({
        txKey: t.key,
        decision: "ASK_QUESTIONS",
        riskScore: t.riskScore,
        scamScore: 0.31,
        voiceMatch: 0.71,
        spoofScore: 0.04,
        signals: [
          { id: "amount_spike", label: "About 4x what Sam usually sends Ana", weight: 0.42 },
          { id: "urgency", label: "Urgent language (\"es urgente\")", weight: 0.27 },
        ],
        explanation: "This is much more than you usually send Ana, and the request sounds urgent. We asked a couple of quick questions first.",
        resolution: {
          questions: [
            { q: "Did Ana ask you for this herself, in her own voice or in person?", a: "Yes, she called me from the hospital." },
            { q: "Is anyone else telling you to send this or keep it secret?", a: "No." },
          ],
          outcome: "ALLOW",
        },
      });
    } else {
      events.push({
        txKey: t.key,
        decision: "ALLOW",
        riskScore: t.riskScore,
        scamScore: round2(between(0.01, 0.08)),
        voiceMatch: round2(between(0.62, 0.84)),
        spoofScore: round2(between(0.01, 0.06)),
        signals: [],
        explanation: `Normal payment to a known contact.`,
      });
    }
  }

  txs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { txs, splits, events };
}
