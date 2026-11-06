import "server-only";
import { generateJson, type Part } from "../ai/gemini";
import type { Contact } from "../db/schema";

export type IntentKind = "pay" | "request" | "split" | "unknown";

export interface Intent {
  kind: IntentKind;
  /** Name or email exactly as the user referred to them (pay/request). */
  recipient: string | null;
  /** People to split with (split), as the user named them. */
  members: string[];
  amount: number | null;
  /** ISO 4217, or null if the user didn't say a currency. */
  currency: string | null;
  /** Short purpose in the user's own words/language ("for the logo"). */
  note: string | null;
  /** The same purpose in English (invoices are always English). */
  noteEn: string | null;
  /** Split: whether the user also pays a share. */
  includeMe: boolean;
  /** BCP-47 primary language of the user's command ("en", "es", "ml"). */
  language: string;
  /** If something essential is missing or unclear: one short question, in the user's language. */
  clarification: string | null;
}

export interface Receipt {
  merchant: string | null;
  currency: string | null;
  total: number | null;
  items: { name: string; amount: number }[];
}

const INTENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["pay", "request", "split", "unknown"] },
    recipient: { type: "STRING", nullable: true },
    members: { type: "ARRAY", items: { type: "STRING" } },
    amount: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", nullable: true },
    note: { type: "STRING", nullable: true },
    noteEn: { type: "STRING", nullable: true },
    includeMe: { type: "BOOLEAN" },
    language: { type: "STRING" },
    clarification: { type: "STRING", nullable: true },
  },
  required: ["kind", "recipient", "members", "amount", "currency", "note", "noteEn", "includeMe", "language", "clarification"],
};

const SYSTEM = `You turn a spoken money command into JSON for SayItPayIt, a voice payment app on PayPal.
You only EXTRACT what the user said. You never decide to send money, and you never invent amounts, people or currencies.

kind:
- "pay": the user sends money ("pay Maria 50 euros", "send John 20", "mándale 500 pesos a Ana", "ജോണിന് 20 ഡോളർ അയക്കൂ").
- "request": the user asks someone to pay THEM ("ask John for 200", "John owes me", "request", "cóbrale", "pídele").
- "split": share a bill between people ("split dinner with John and Maria", "divide la cuenta").
- "unknown": anything else (questions, chit-chat, unclear).

Rules:
- The command usually comes from speech recognition and may be misspelled or phonetically garbled (especially Malayalam, Hindi, Tamil). Read it charitably: recover the intended names, numbers and purpose, and write the note correctly spelled.
- recipient / members: use the name as spoken; prefer the matching contact nickname from the list when it's clearly the same person (accents/transliteration, e.g. "Mariya" → "Maria").
- currency: ISO code only if the user said or clearly implied one ("euros"→EUR, "bucks"/"dollars"→USD, "pesos"→MXN, "rupees"→INR, "yen"→JPY). Otherwise null.
- amount: a number in that currency; for split it is the bill TOTAL. Words like "fifty" or "cincuenta" → 50.
- note: the purpose as a short natural phrase in the user's language, without the amount, the person or the word "for" ("for the logo" → "the logo", "para la renta" → "la renta"). null if none.
- noteEn: the same purpose in plain English ("la renta" → "rent", "el logo" → "the logo"). null if none.
- includeMe: true unless the user says the others should cover all of it.
- language: the language of the command TEXT (ISO 639-1). Judge by the words, not by names in it.
- clarification: if kind is pay/request/split but the person or amount is missing, ask ONE short question in the user's language. Otherwise null.`;

export async function parseIntent(text: string, ctx: { contacts: Contact[]; homeCurrency: string; receipt?: Receipt | null }): Promise<Intent> {
  const contactList = ctx.contacts
    .map((c) => `${c.nickname}${c.aliases.length ? ` (also: ${c.aliases.join(", ")})` : ""}: ${c.currency}, ${c.country}`)
    .join("\n");
  const receiptLine = ctx.receipt
    ? `\nThe user attached a receipt: ${ctx.receipt.merchant ?? "a bill"}, total ${ctx.receipt.total} ${ctx.receipt.currency ?? ""}. If they want to split it and didn't say an amount, use that total and currency.`
    : "";
  const parts: Part[] = [
    { text: `Contacts:\n${contactList}\nUser's home currency: ${ctx.homeCurrency}.${receiptLine}\n\nCommand: """${text.slice(0, 600)}"""` },
  ];
  const out = await generateJson<Intent>(parts, INTENT_SCHEMA, { system: SYSTEM });
  return {
    ...out,
    members: out.members ?? [],
    currency: out.currency ? out.currency.toUpperCase().slice(0, 3) : null,
    amount: typeof out.amount === "number" && out.amount > 0 ? out.amount : null,
    language: (out.language || "en").toLowerCase().slice(0, 2),
  };
}

const RECEIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    merchant: { type: "STRING", nullable: true },
    currency: { type: "STRING", nullable: true },
    total: { type: "NUMBER", nullable: true },
    items: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, amount: { type: "NUMBER" } }, required: ["name", "amount"] } },
  },
  required: ["merchant", "currency", "total", "items"],
};

/** Read a receipt photo with Gemini vision. */
export async function parseReceipt(image: { mimeType: string; base64: string }): Promise<Receipt> {
  const r = await generateJson<Receipt>(
    [
      { inlineData: { mimeType: image.mimeType, data: image.base64 } },
      { text: "Read this receipt. Return the merchant, ISO currency, the final total actually paid (including tax and tip), and the line items. If it is not a receipt, return nulls and no items." },
    ],
    RECEIPT_SCHEMA,
    { timeoutMs: 20_000 },
  );
  return { ...r, currency: r.currency?.toUpperCase().slice(0, 3) ?? null };
}
