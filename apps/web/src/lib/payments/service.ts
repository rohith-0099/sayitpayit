import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import {
  createInvoice,
  createPayout,
  generateInvoiceQR,
  getPayout,
  PayPalError,
  sendInvoice,
  type WebhookEvent,
} from "../paypal";
import { equalShares, interpretWebhook, payoutItemStatus } from "./logic";

const { transactions, splits, webhookEvents } = schema;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- Pay (Payouts) ----------

export interface PayInput {
  to: string;
  toName?: string;
  amount: number;
  currency: string;
  note?: string;
}

/**
 * Execute a payment. Callers MUST have obtained explicit user confirmation first;
 * from Phase 4 only the agent graph's Confirm node may reach this.
 */
export async function executePay(input: PayInput) {
  const [tx] = await db
    .insert(transactions)
    .values({
      type: "pay",
      amount: input.amount.toFixed(2),
      currency: input.currency,
      counterpartyEmail: input.to,
      counterpartyName: input.toName,
      note: input.note,
    })
    .returning();

  try {
    const batch = await createPayout({
      receiver: input.to,
      amount: input.amount,
      currency: input.currency,
      note: input.note,
      senderItemId: tx.id,
    });
    const [updated] = await db
      .update(transactions)
      .set({ status: "sent", paypalBatchId: batch.batch_header.payout_batch_id, updatedAt: new Date() })
      .where(eq(transactions.id, tx.id))
      .returning();
    return updated;
  } catch (e) {
    await db.update(transactions).set({ status: "failed", error: errMsg(e), updatedAt: new Date() }).where(eq(transactions.id, tx.id));
    throw e;
  }
}

/** Pull payout item status from PayPal for still-in-flight payouts (fallback when webhooks can't reach us). */
export async function syncPendingPayouts() {
  const pending = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.status, ["sent", "pending"]));
  let updated = 0;
  for (const tx of pending) {
    if (tx.type !== "pay" || !tx.paypalBatchId) continue;
    const batch = await getPayout(tx.paypalBatchId);
    const item = batch.items?.find((i) => i.payout_item.sender_item_id === tx.id) ?? batch.items?.[0];
    if (!item) continue;
    const status = payoutItemStatus(item.transaction_status);
    await db
      .update(transactions)
      .set({
        status,
        paypalItemId: item.payout_item_id,
        paypalTransactionId: item.transaction_id,
        fee: item.payout_item_fee?.value,
        error: item.errors?.message,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, tx.id));
    updated++;
  }
  return updated;
}

// ---------- Request (Invoicing) ----------

export interface RequestInput {
  from: string;
  fromName?: string;
  amount: number;
  currency: string;
  note?: string;
  /** Line-item name shown on the invoice. */
  item?: string;
  splitId?: string;
}

export async function createRequest(input: RequestInput) {
  const [tx] = await db
    .insert(transactions)
    .values({
      type: input.splitId ? "split" : "request",
      amount: input.amount.toFixed(2),
      currency: input.currency,
      counterpartyEmail: input.from,
      counterpartyName: input.fromName,
      note: input.note,
      splitId: input.splitId,
    })
    .returning();

  try {
    const inv = await createInvoice({
      recipientEmail: input.from,
      recipientName: input.fromName,
      currency: input.currency,
      items: [{ name: input.item ?? input.note ?? "Payment request", amount: input.amount }],
      note: input.note,
      reference: tx.id,
    });
    await db.update(transactions).set({ paypalInvoiceId: inv.id, updatedAt: new Date() }).where(eq(transactions.id, tx.id));

    const { href } = await sendInvoice(inv.id, { subject: `Payment request via SayItPayIt` });
    const qr = await generateInvoiceQR(inv.id).catch(() => null); // QR is nice-to-have
    const [updated] = await db
      .update(transactions)
      .set({ status: "sent", paypalInvoiceUrl: href ?? inv.detail.metadata?.recipient_view_url, updatedAt: new Date() })
      .where(eq(transactions.id, tx.id))
      .returning();
    return { transaction: updated, invoiceId: inv.id, payUrl: updated.paypalInvoiceUrl, qr };
  } catch (e) {
    await db.update(transactions).set({ status: "failed", error: errMsg(e), updatedAt: new Date() }).where(eq(transactions.id, tx.id));
    throw e;
  }
}

// ---------- Split (one invoice per person) ----------

export interface SplitInput {
  title: string;
  currency: string;
  /** Total bill. Required when any member has no explicit amount. */
  total?: number;
  /** Count the user as one of the people splitting (they pay their own share). Default true. */
  includeMe?: boolean;
  members: { email: string; name?: string; amount?: number }[];
}

export async function createSplit(input: SplitInput) {
  const explicit = input.members.every((m) => m.amount !== undefined);
  let amounts: number[];
  if (explicit) {
    amounts = input.members.map((m) => m.amount!);
  } else {
    if (!input.total) throw new Error("total is required for an equal split");
    const people = input.members.length + (input.includeMe === false ? 0 : 1);
    const shares = equalShares(input.total, people);
    // The user keeps the (possibly cent-heavier) first share; members get the rest.
    amounts = input.includeMe === false ? shares : shares.slice(1);
  }
  const total = input.total ?? amounts.reduce((a, b) => a + b, 0);

  const [split] = await db
    .insert(splits)
    .values({ title: input.title, total: total.toFixed(2), currency: input.currency })
    .returning();

  // Sequential to stay friendly with sandbox rate limits; partial failures are reported per member.
  const results = [];
  for (const [i, m] of input.members.entries()) {
    try {
      const r = await createRequest({
        from: m.email,
        fromName: m.name,
        amount: amounts[i],
        currency: input.currency,
        note: `Your share of ${input.title}`,
        item: input.title,
        splitId: split.id,
      });
      results.push({ email: m.email, amount: amounts[i], ok: true as const, ...r });
    } catch (e) {
      results.push({ email: m.email, amount: amounts[i], ok: false as const, error: errMsg(e) });
    }
  }
  return { split, members: results };
}

// ---------- Activity ----------

export function listActivity(limit = 50) {
  return db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(limit);
}

// ---------- Webhooks ----------

/** Record + apply a verified webhook. Returns false if this event id was already processed. */
export async function applyWebhook(event: WebhookEvent) {
  const update = interpretWebhook(event);
  const mm = update?.match;
  const resourceId = !mm
    ? ((event.resource as { id?: string }).id ?? null)
    : "paypalInvoiceId" in mm
      ? mm.paypalInvoiceId
      : "paypalItemId" in mm
        ? mm.paypalItemId
        : mm.paypalBatchId;

  return db.transaction(async (q) => {
    const inserted = await q
      .insert(webhookEvents)
      .values({ id: event.id, eventType: event.event_type, resourceId, payload: event })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { duplicate: true, updated: 0 };
    if (!update) return { duplicate: false, updated: 0 };

    const set = {
      status: update.status,
      ...(update.paypalTransactionId ? { paypalTransactionId: update.paypalTransactionId } : {}),
      ...(update.error ? { error: update.error } : {}),
      updatedAt: new Date(),
    };
    const m = update.match;
    let where;
    if ("paypalInvoiceId" in m) where = eq(transactions.paypalInvoiceId, m.paypalInvoiceId);
    else if ("paypalBatchId" in m) where = eq(transactions.paypalBatchId, m.paypalBatchId);
    // Payout items: our tx id is the sender_item_id; fall back to item id.
    else if (m.senderItemId && /^[0-9a-f-]{36}$/i.test(m.senderItemId)) where = eq(transactions.id, m.senderItemId);
    else where = eq(transactions.paypalItemId, m.paypalItemId);

    const rows = await q
      .update(transactions)
      .set({ ...set, ...("paypalItemId" in m ? { paypalItemId: m.paypalItemId } : {}) })
      .where(where)
      .returning({ id: transactions.id });
    return { duplicate: false, updated: rows.length };
  });
}

export { PayPalError };
