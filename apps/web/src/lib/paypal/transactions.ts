import "server-only";
import { paypalFetch } from "./client";

export interface TransactionDetail {
  transaction_info: {
    transaction_id: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_amount: { currency_code: string; value: string };
    fee_amount?: { currency_code: string; value: string };
    transaction_status: string;
    transaction_subject?: string;
    transaction_note?: string;
  };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
}

/**
 * Transaction Search (v1 reporting). Max 31-day window. Note: in sandbox, new
 * transactions can take up to a few hours to appear here.
 */
export async function listTransactions(opts: { start?: Date; end?: Date; pageSize?: number } = {}) {
  const end = opts.end ?? new Date();
  const start = opts.start ?? new Date(end.getTime() - 30 * 86_400_000);
  const res = await paypalFetch<{ transaction_details: TransactionDetail[]; total_items: number }>(
    "/v1/reporting/transactions",
    {
      query: {
        start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
        end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
        fields: "transaction_info,payer_info",
        page_size: opts.pageSize ?? 100,
      },
    },
  );
  return res.transaction_details ?? [];
}
