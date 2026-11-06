import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { Contact, User } from "../db/schema";
import { getRate, round2 } from "../fx";
import { ApiError } from "../errors";
import {
  chargeVaultedPayPal,
  createInvoice,
  createPayout,
  generateInvoiceQR,
  getPayout,
  PayPalError,
  refundCapture,
  sendInvoice,
  type WebhookEvent,
} from "../paypal";
import { equalShares, interpretWebhook, payoutItemStatus } from "./logic";

const { transactions, splits, splitMembers, invoices, contacts, webhookEvents } = schema;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Who the money goes to / comes from: a saved contact, or a brand-new email. */
export type Party = { contact: Contact } | { email: string; name?: string };

const partyFields = (p: Party) =>
  "contact" in p
    ? {
        contactId: p.contact.id,
        counterpartyEmail: p.contact.paypalEmail,
        counterpartyName: p.contact.fullName ?? p.contact.nickname,
        relationship: p.contact.relationship,
      }
    : { contactId: null, counterpartyEmail: p.email, counterpartyName: p.name ?? null, relationship: null };

async function homeValue(user: User, amount: number, currency: string) {
  const { rate } = await getRate(currency, user.homeCurrency);
  return { homeAmount: round2(amount * rate).toFixed(2), fxRate: String(round2(rate * 1e4) / 1e4) };
}

type Source = "voice" | "text" | "api";

// ---------- Pay (Payouts) ----------

export interface PayInput {
  to: Party;
  amount: number;
  currency: string;
  note?: string;
  command?: string;
  source?: Source;
  /** Exactly what was read back to the user (home currency, incl. fees). Defaults to the FX value. */
  chargeTotal?: number;
  /** Fees included in chargeTotal, for the record. */
  fee?: number;
  guardian?: { riskScore: number; decision: "ALLOW" | "ASK_QUESTIONS" | "GUARDIAN_HOLD" | "PASSKEY_REQUIRED" | "BLOCK" };
}

/**
 * Execute a payment: charge the user's linked PayPal (Vault, no popup), then pay the
 * recipient with Payouts. If the payout fails after the charge, the charge is refunded.
 * Callers MUST have obtained explicit user confirmation first; from Phase 4 only the
 * agent graph's Confirm node may reach this.
 *
 * Sandbox demo architecture: funds pass through the merchant account between the two
 * steps. Doing this in production would need money-transmission licensing.
 */
export async function executePay(user: User, input: PayInput) {
  if (!user.paypalVaultId) {
    throw new ApiError(409, "Link your PayPal first: open /link and approve SayItPayIt once.", { code: "PAYPAL_NOT_LINKED" });
  }
  const party = partyFields(input.to);
  const home = await homeValue(user, input.amount, input.currency);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: user.id,
      ...party,
      type: "pay",
      source: input.source ?? "api",
      amount: input.amount.toFixed(2),
      currency: input.currency,
      ...home,
      note: input.note,
      command: input.command,
      fee: input.fee?.toFixed(2),
      riskScore: input.guardian?.riskScore,
      decision: input.guardian?.decision,
    })
    .returning();

  const fail = async (e: unknown, extra: Partial<typeof transactions.$inferInsert> = {}) => {
    await db
      .update(transactions)
      .set({ status: "failed", error: errMsg(e), updatedAt: new Date(), ...extra })
      .where(eq(transactions.id, tx.id));
    throw e;
  };

  // 1. Charge the user's vaulted PayPal in their home currency.
  let charge;
  try {
    charge = await chargeVaultedPayPal({
      amount: input.chargeTotal ?? Number(home.homeAmount),
      currency: user.homeCurrency,
      referenceId: tx.id,
      description: `SayItPayIt: ${input.amount.toFixed(2)} ${input.currency} to ${party.counterpartyName ?? party.counterpartyEmail}`,
      vaultId: user.paypalVaultId,
    });
  } catch (e) {
    return fail(e);
  }
  await db
    .update(transactions)
    .set({ paypalOrderId: charge.orderId, paypalCaptureId: charge.captureId, updatedAt: new Date() })
    .where(eq(transactions.id, tx.id));

  // 2. Pay the recipient in their currency.
  try {
    const batch = await createPayout({
      receiver: party.counterpartyEmail,
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
    // Never keep the user's money for a payment that didn't go out.
    try {
      await refundCapture(charge.captureId, "SayItPayIt: the payment couldn't be delivered, so we refunded you.");
      return fail(e, { status: "refunded" });
    } catch (refundErr) {
      console.error("[pay] REFUND FAILED after payout failure", tx.id, refundErr);
      return fail(new Error(`${errMsg(e)}; refund also failed: ${errMsg(refundErr)}`));
    }
  }
}

/** Pull payout item status from PayPal for still-in-flight payouts (fallback when webhooks can't reach us). */
export async function syncPendingPayouts(userId: string) {
  const pending = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, "pay"), inArray(transactions.status, ["sent", "pending"])));
  let updated = 0;
  for (const tx of pending) {
    if (!tx.paypalBatchId) continue;
    const batch = await getPayout(tx.paypalBatchId);
    const item = batch.items?.find((i) => i.payout_item.sender_item_id === tx.id) ?? batch.items?.[0];
    if (!item) continue;
    await db
      .update(transactions)
      .set({
        status: payoutItemStatus(item.transaction_status),
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
  guardian?: PayInput["guardian"];
  from: Party;
  amount: number;
  currency: string;
  note?: string;
  /** Line-item name shown on the invoice. */
  item?: string;
  command?: string;
  source?: Source;
  splitId?: string;
}

export async function createRequest(user: User, input: RequestInput) {
  const party = partyFields(input.from);
  const language = "contact" in input.from ? input.from.contact.language : "en";
  const itemName = input.item ?? input.note ?? "Payment request";

  const [tx] = await db
    .insert(transactions)
    .values({
      userId: user.id,
      ...party,
      type: input.splitId ? "split" : "request",
      source: input.source ?? "api",
      amount: input.amount.toFixed(2),
      currency: input.currency,
      ...(await homeValue(user, input.amount, input.currency)),
      note: input.note,
      command: input.command,
      splitId: input.splitId,
      riskScore: input.guardian?.riskScore,
      decision: input.guardian?.decision,
    })
    .returning();

  try {
    const inv = await createInvoice({
      recipientEmail: party.counterpartyEmail,
      recipientName: party.counterpartyName ?? undefined,
      currency: input.currency,
      items: [{ name: itemName, amount: input.amount }],
      note: input.note,
      reference: tx.id,
    });
    await db.update(transactions).set({ paypalInvoiceId: inv.id, updatedAt: new Date() }).where(eq(transactions.id, tx.id));

    const { href } = await sendInvoice(inv.id, { subject: `Payment request from ${user.name} via SayItPayIt` });
    const qr = await generateInvoiceQR(inv.id).catch(() => null); // QR is nice-to-have
    const payUrl = href ?? inv.detail.metadata?.recipient_view_url ?? null;

    const [invoice] = await db
      .insert(invoices)
      .values({
        transactionId: tx.id,
        paypalInvoiceId: inv.id,
        payerViewUrl: payUrl,
        qrDataUrl: qr,
        language,
        items: [{ name: itemName, amount: input.amount }],
        dueDate: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    const [updated] = await db
      .update(transactions)
      .set({ status: "sent", paypalInvoiceUrl: payUrl, updatedAt: new Date() })
      .where(eq(transactions.id, tx.id))
      .returning();
    return { transaction: updated, invoice };
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
  members: { party: Party; amount?: number }[];
  command?: string;
  source?: Source;
  receipt?: unknown;
}

export async function createSplit(user: User, input: SplitInput) {
  const explicit = input.members.every((m) => m.amount !== undefined);
  let amounts: number[];
  let myShare: number;
  if (explicit) {
    amounts = input.members.map((m) => m.amount!);
    const others = amounts.reduce((a, b) => a + b, 0);
    myShare = input.total !== undefined ? Math.max(round2(input.total - others), 0) : 0;
  } else {
    if (!input.total) throw new Error("total is required for an equal split");
    const includeMe = input.includeMe !== false;
    const shares = equalShares(input.total, input.members.length + (includeMe ? 1 : 0));
    // The user keeps the (possibly cent-heavier) first share; members get the rest.
    myShare = includeMe ? shares[0] : 0;
    amounts = includeMe ? shares.slice(1) : shares;
  }
  const total = input.total ?? amounts.reduce((a, b) => a + b, 0) + myShare;

  const [split] = await db
    .insert(splits)
    .values({
      userId: user.id,
      title: input.title,
      total: total.toFixed(2),
      currency: input.currency,
      myShare: myShare.toFixed(2),
      receipt: input.receipt,
    })
    .returning();

  // Sequential to stay friendly with sandbox rate limits; partial failures are reported per member.
  const results = [];
  for (const [i, m] of input.members.entries()) {
    const party = partyFields(m.party);
    try {
      const r = await createRequest(user, {
        from: m.party,
        amount: amounts[i],
        currency: input.currency,
        note: `Your share of ${input.title}`,
        item: input.title,
        command: input.command,
        source: input.source,
        splitId: split.id,
      });
      await db.insert(splitMembers).values({
        splitId: split.id,
        contactId: party.contactId,
        name: party.counterpartyName,
        email: party.counterpartyEmail,
        share: amounts[i].toFixed(2),
        transactionId: r.transaction.id,
      });
      results.push({ email: party.counterpartyEmail, name: party.counterpartyName, amount: amounts[i], ok: true as const, ...r });
    } catch (e) {
      results.push({ email: party.counterpartyEmail, name: party.counterpartyName, amount: amounts[i], ok: false as const, error: errMsg(e) });
    }
  }
  return { split, members: results };
}

// ---------- Activity ----------

export function listActivity(userId: string, limit = 50) {
  return db
    .select({
      tx: transactions,
      contact: { id: contacts.id, nickname: contacts.nickname, country: contacts.country, currency: contacts.currency },
    })
    .from(transactions)
    .leftJoin(contacts, eq(contacts.id, transactions.contactId))
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

/** Open requests/split shares: who still owes the user money. */
export function listOutstanding(userId: string) {
  return db
    .select({ tx: transactions, nickname: contacts.nickname, splitTitle: splits.title })
    .from(transactions)
    .leftJoin(contacts, eq(contacts.id, transactions.contactId))
    .leftJoin(splits, eq(splits.id, transactions.splitId))
    .where(
      and(eq(transactions.userId, userId), inArray(transactions.type, ["request", "split"]), eq(transactions.status, "sent")),
    )
    .orderBy(desc(transactions.createdAt));
}

// ---------- Webhooks ----------

/** Record + apply a verified webhook. Returns duplicate=true if this event id was already processed. */
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
