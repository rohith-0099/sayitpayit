// Pure helpers: no I/O, unit tested in logic.test.ts.

export type TxStatus = "pending" | "sent" | "completed" | "failed" | "unclaimed" | "cancelled" | "refunded";

/** Split `total` into `n` shares that sum exactly to total (extra cents go to the first shares). */
export function equalShares(total: number, n: number): number[] {
  if (!Number.isFinite(total) || total <= 0) throw new Error("total must be positive");
  if (!Number.isInteger(n) || n < 1) throw new Error("need at least one person");
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  const extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** Payouts item status → our status. */
export function payoutItemStatus(s: string | undefined): TxStatus {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESS":
      return "completed";
    case "UNCLAIMED":
      return "unclaimed";
    case "FAILED":
    case "BLOCKED":
    case "DENIED":
    case "RETURNED":
      return "failed";
    case "REFUNDED":
    case "REVERSED":
      return "refunded";
    case "CANCELED":
    case "CANCELLED":
      return "cancelled";
    default:
      return "sent"; // PENDING, ONHOLD, PROCESSING, NEW
  }
}

/** Invoicing v2 status → our status. */
export function invoiceStatus(s: string | undefined): TxStatus {
  switch ((s ?? "").toUpperCase()) {
    case "PAID":
    case "MARKED_AS_PAID":
      return "completed";
    case "CANCELLED":
      return "cancelled";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "MARKED_AS_REFUNDED":
      return "refunded";
    case "DRAFT":
      return "pending";
    default:
      return "sent"; // SENT, UNPAID, PARTIALLY_PAID, PAYMENT_PENDING, SCHEDULED
  }
}

export interface WebhookUpdate {
  match: { paypalInvoiceId: string } | { paypalItemId: string; senderItemId?: string } | { paypalBatchId: string };
  status: TxStatus;
  paypalTransactionId?: string;
  error?: string;
}

/**
 * Decide what a verified PayPal webhook means for our transactions.
 * Returns null for events we don't track.
 */
export function interpretWebhook(event: { event_type: string; resource: Record<string, unknown> }): WebhookUpdate | null {
  const type = event.event_type;
  const r = event.resource ?? {};

  if (type.startsWith("INVOICING.INVOICE.")) {
    // v2 payloads nest the invoice under resource.invoice; older ones use resource directly.
    const inv = ((r.invoice as Record<string, unknown>) ?? r) as { id?: string; status?: string; payments?: { transactions?: { payment_id?: string }[] } };
    if (!inv.id) return null;
    const byType: Record<string, TxStatus> = {
      "INVOICING.INVOICE.PAID": "completed",
      "INVOICING.INVOICE.CANCELLED": "cancelled",
      "INVOICING.INVOICE.REFUNDED": "refunded",
    };
    const status = byType[type] ?? invoiceStatus(inv.status);
    return {
      match: { paypalInvoiceId: inv.id },
      status,
      paypalTransactionId: inv.payments?.transactions?.at(-1)?.payment_id,
    };
  }

  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const item = r as {
      payout_item_id?: string;
      transaction_id?: string;
      transaction_status?: string;
      payout_item?: { sender_item_id?: string };
      errors?: { message?: string; name?: string };
    };
    if (!item.payout_item_id) return null;
    const suffix = type.slice("PAYMENT.PAYOUTS-ITEM.".length);
    const status = payoutItemStatus(item.transaction_status ?? (suffix === "SUCCEEDED" ? "SUCCESS" : suffix));
    return {
      match: { paypalItemId: item.payout_item_id, senderItemId: item.payout_item?.sender_item_id },
      status,
      paypalTransactionId: item.transaction_id,
      error: item.errors?.message ?? item.errors?.name,
    };
  }

  if (type === "PAYMENT.PAYOUTSBATCH.DENIED") {
    const id = (r.batch_header as { payout_batch_id?: string } | undefined)?.payout_batch_id;
    return id ? { match: { paypalBatchId: id }, status: "failed", error: "Payout batch denied" } : null;
  }

  return null;
}
