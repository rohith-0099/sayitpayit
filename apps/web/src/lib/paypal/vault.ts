import "server-only";
import { paypalFetch } from "./client";

export interface SetupToken {
  id: string;
  status: "CREATED" | "PAYER_ACTION_REQUIRED" | "APPROVED" | "VAULTED" | "TOKENIZED";
  customer?: { id: string };
}

export interface PaymentToken {
  id: string;
  customer: { id: string };
  payment_source: {
    paypal?: {
      email_address?: string;
      payer_id?: string;
      name?: { given_name?: string; surname?: string; full_name?: string };
    };
  };
}

/**
 * Vault v3 setup token for saving the payer's PayPal wallet without a purchase.
 * MERCHANT usage: we charge it later on the payer's explicit instruction (each voice payment).
 */
export function createPayPalSetupToken(opts: { returnUrl: string; cancelUrl: string; requestId: string; customerId?: string }) {
  return paypalFetch<SetupToken>("/v3/vault/setup-tokens", {
    method: "POST",
    idempotencyKey: opts.requestId,
    body: {
      ...(opts.customerId ? { customer: { id: opts.customerId } } : {}),
      payment_source: {
        paypal: {
          description: "SayItPayIt: send money by voice from your PayPal, after you confirm each payment",
          usage_type: "MERCHANT",
          usage_pattern: "IMMEDIATE",
          customer_type: "CONSUMER",
          permit_multiple_payment_tokens: false,
          experience_context: {
            brand_name: "SayItPayIt",
            shipping_preference: "NO_SHIPPING",
            vault_instruction: "ON_PAYER_APPROVAL",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    },
  });
}

/** Exchange an approved setup token for a long-lived payment token. */
export function createPaymentToken(setupTokenId: string) {
  return paypalFetch<PaymentToken>("/v3/vault/payment-tokens", {
    method: "POST",
    idempotencyKey: `ptoken-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
}

export async function deletePaymentToken(id: string): Promise<void> {
  await paypalFetch(`/v3/vault/payment-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}
