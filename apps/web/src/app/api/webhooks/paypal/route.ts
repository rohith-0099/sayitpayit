import { applyWebhook } from "@/lib/payments/service";
import { verifyWebhookSignature, type WebhookEvent } from "@/lib/paypal";

/**
 * PayPal webhook listener. Every event is signature-verified with PayPal
 * before we touch the database; unverified events get 401.
 */
export async function POST(req: Request) {
  const raw = await req.text(); // raw body: required for signature verification

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, raw);
  } catch (e) {
    console.error("[webhook] verification error", e);
    return Response.json({ error: "verification unavailable" }, { status: 503 }); // PayPal retries
  }
  if (!verified) {
    console.warn("[webhook] rejected unverified event");
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as WebhookEvent;
  try {
    const result = await applyWebhook(event);
    console.log(`[webhook] ${event.event_type} ${event.id}`, result);
    return Response.json({ received: true, ...result });
  } catch (e) {
    console.error("[webhook] processing failed", e);
    return Response.json({ error: "processing failed" }, { status: 500 }); // PayPal retries
  }
}
