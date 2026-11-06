import "server-only";
import { money, paypalFetch, type Money } from "./client";

export type InvoiceStatus =
  | "DRAFT" | "SENT" | "SCHEDULED" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "REFUNDED"
  | "PARTIALLY_PAID" | "PARTIALLY_REFUNDED" | "MARKED_AS_REFUNDED" | "UNPAID" | "PAYMENT_PENDING";

export interface InvoiceItemInput {
  name: string;
  amount: number;
  quantity?: number;
  description?: string;
}

export interface CreateInvoiceInput {
  recipientEmail: string;
  recipientName?: string;
  currency: string;
  items: InvoiceItemInput[];
  /** Shown to the payer on the invoice. */
  note?: string;
  /** Our reference (transaction id). Stored in detail.reference. */
  reference?: string;
  /** Days until due. Default 7. */
  dueInDays?: number;
}

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  detail: {
    invoice_number: string;
    currency_code: string;
    reference?: string;
    note?: string;
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string };
  };
  primary_recipients?: { billing_info: { email_address: string } }[];
  amount: { currency_code: string; value: string };
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_id: string; payment_date?: string }[] };
  links?: { href: string; rel: string; method: string }[];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Create a DRAFT invoice (Invoicing v2). Returns the full invoice. */
export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const currency = input.currency.toUpperCase();
  const [given, ...rest] = (input.recipientName ?? "").trim().split(/\s+/);
  const due = new Date(Date.now() + (input.dueInDays ?? 7) * 86_400_000);
  return paypalFetch<Invoice>("/v2/invoicing/invoices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    idempotencyKey: input.reference ? `inv-${input.reference}` : undefined,
    body: {
      detail: {
        currency_code: currency,
        reference: input.reference,
        note: input.note,
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: isoDate(due) },
      },
      invoicer: { business_name: "SayItPayIt" },
      primary_recipients: [
        {
          billing_info: {
            email_address: input.recipientEmail,
            ...(given ? { name: { given_name: given, ...(rest.length ? { surname: rest.join(" ") } : {}) } } : {}),
          },
        },
      ],
      items: input.items.map((it) => ({
        name: it.name.slice(0, 200),
        description: it.description,
        quantity: String(it.quantity ?? 1),
        unit_amount: money(it.amount, currency),
        unit_of_measure: "AMOUNT",
      })),
    },
  });
}

/** Move a draft to payable and email the payer. Returns the payer-view link. */
export async function sendInvoice(
  id: string,
  opts: { subject?: string; note?: string; sendToRecipient?: boolean } = {},
): Promise<{ href?: string }> {
  const res = await paypalFetch<{ href?: string; links?: { href: string; rel: string }[] }>(
    `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`,
    {
      method: "POST",
      idempotencyKey: `inv-send-${id}`,
      body: {
        subject: opts.subject,
        note: opts.note,
        send_to_invoicer: false,
        send_to_recipient: opts.sendToRecipient ?? true,
      },
    },
  );
  return { href: res?.href ?? res?.links?.find((l) => l.rel === "payer-view")?.href };
}

/**
 * QR code (PNG) that opens the payer view. PayPal returns the image base64-encoded,
 * sometimes wrapped in a multipart body. Returns a data: URL ready for <img src>.
 */
export async function generateInvoiceQR(id: string, size = 400): Promise<string> {
  const res = await paypalFetch<unknown>(`/v2/invoicing/invoices/${encodeURIComponent(id)}/generate-qr-code`, {
    method: "POST",
    body: { width: size, height: size, action: "pay" },
  });
  return `data:image/png;base64,${extractBase64(res)}`;
}

export function extractBase64(res: unknown): string {
  if (typeof res !== "string") throw new Error("Unexpected QR response from PayPal");
  // Multipart: take the longest base64-looking run.
  const runs = res.match(/[A-Za-z0-9+/=\r\n]{200,}/g);
  const b64 = (runs ? runs.sort((a, b) => b.length - a.length)[0] : res).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new Error("Could not parse QR code from PayPal response");
  return b64;
}

export function getInvoice(id: string): Promise<Invoice> {
  return paypalFetch<Invoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);
}

/** Friendly reminder email from PayPal for an unpaid invoice. */
export async function remindInvoice(id: string, note?: string): Promise<void> {
  await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    method: "POST",
    body: { note, send_to_invoicer: false },
  });
}

export async function cancelInvoice(id: string, note?: string): Promise<void> {
  await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: { note, send_to_invoicer: false, send_to_recipient: true },
  });
}
