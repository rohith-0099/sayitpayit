import "server-only";
import { money, paypalFetch } from "./client";

export type PayoutBatchStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";
export type PayoutItemStatus =
  | "SUCCESS" | "FAILED" | "PENDING" | "UNCLAIMED" | "RETURNED" | "ONHOLD" | "BLOCKED" | "REFUNDED" | "REVERSED";

export interface CreatePayoutInput {
  /** Recipient's PayPal email. */
  receiver: string;
  amount: number;
  currency: string;
  note?: string;
  /** Our own id for this item (we use the transaction id). Max 63 chars. */
  senderItemId: string;
  emailSubject?: string;
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: PayoutBatchStatus;
  sender_batch_header: { sender_batch_id: string };
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status: PayoutItemStatus;
  payout_item_fee?: { currency: string; value: string };
  payout_item: { receiver: string; amount: { currency: string; value: string }; sender_item_id?: string; note?: string };
  errors?: { name: string; message: string };
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader & {
    amount?: { currency: string; value: string };
    fees?: { currency: string; value: string };
  };
  items?: PayoutItem[];
}

/** Send money to one PayPal email (Payouts v1). Idempotent on senderItemId. */
export async function createPayout(input: CreatePayoutInput): Promise<PayoutBatch> {
  const m = money(input.amount, input.currency);
  return paypalFetch<PayoutBatch>("/v1/payments/payouts", {
    method: "POST",
    idempotencyKey: `payout-${input.senderItemId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: `sip_${input.senderItemId}`,
        email_subject: input.emailSubject ?? "You got paid via SayItPayIt",
        email_message: input.note ?? "Sent with SayItPayIt",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: input.receiver,
          amount: { value: m.value, currency: m.currency_code },
          note: input.note ?? "Sent with SayItPayIt",
          sender_item_id: input.senderItemId,
        },
      ],
    },
  });
}

export function getPayout(batchId: string): Promise<PayoutBatch> {
  return paypalFetch<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`, { query: { fields: "batch_header,items" } });
}

export function getPayoutItem(itemId: string): Promise<PayoutItem> {
  return paypalFetch<PayoutItem>(`/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
}
