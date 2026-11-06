import "server-only";
import { money, paypalFetch } from "./client";

export interface Order {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: { href: string; rel: string; method: string }[];
  purchase_units?: {
    reference_id?: string;
    payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[] };
  }[];
  payment_source?: Record<string, unknown>;
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  description?: string;
  /** Our transaction id. */
  referenceId: string;
  /**
   * Vault v3 payment token id (Phase 3). With it, PayPal charges the saved
   * PayPal wallet server-side with no buyer popup.
   */
  vaultId?: string;
}

/** Orders v2: create a CAPTURE-intent order. */
export function createOrder(input: CreateOrderInput): Promise<Order> {
  return paypalFetch<Order>("/v2/checkout/orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    idempotencyKey: `order-${input.referenceId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description?.slice(0, 127),
          amount: money(input.amount, input.currency),
        },
      ],
      ...(input.vaultId ? { payment_source: { paypal: { vault_id: input.vaultId } } } : {}),
    },
  });
}

export function captureOrder(orderId: string): Promise<Order> {
  return paypalFetch<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    idempotencyKey: `capture-${orderId}`,
    body: {},
  });
}

export function getOrder(orderId: string): Promise<Order> {
  return paypalFetch<Order>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}
