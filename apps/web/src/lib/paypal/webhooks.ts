import "server-only";
import { requireEnv } from "../env";
import { paypalFetch } from "./client";

export interface WebhookEvent<R = Record<string, unknown>> {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  resource: R;
}

/**
 * Verify a webhook with PayPal's verify-webhook-signature postback.
 * Uses the raw body (never re-serialised) so the signed payload is byte-identical.
 * Note: PayPal does not support this for Webhook Simulator mock events.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const h = (n: string) => headers.get(n);
  const required = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"];
  if (required.some((n) => !h(n))) return false;

  // Only trust PayPal-hosted certs.
  try {
    const cert = new URL(h("paypal-cert-url")!);
    if (cert.protocol !== "https:" || !/(^|\.)paypal\.com$/.test(cert.hostname)) return false;
  } catch {
    return false;
  }

  const fields = {
    auth_algo: h("paypal-auth-algo")!,
    cert_url: h("paypal-cert-url")!,
    transmission_id: h("paypal-transmission-id")!,
    transmission_sig: h("paypal-transmission-sig")!,
    transmission_time: h("paypal-transmission-time")!,
    webhook_id: requireEnv("PAYPAL_WEBHOOK_ID"),
  };
  // Splice the raw event JSON in verbatim instead of JSON.parse → stringify.
  const rawBodyJson = JSON.stringify(fields).slice(0, -1) + `,"webhook_event":${rawBody}}`;
  const res = await paypalFetch<{ verification_status: "SUCCESS" | "FAILURE" }>(
    "/v1/notifications/verify-webhook-signature",
    { method: "POST", rawBody: rawBodyJson },
  );
  return res.verification_status === "SUCCESS";
}
