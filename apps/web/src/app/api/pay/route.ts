import { z } from "zod";
import { amount, currency, handle, recipient } from "@/lib/api";
import { startStructured, structuredIntent } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  /** Contact name ("Maria") or PayPal email. */
  to: recipient,
  amount,
  /** Defaults to the contact's currency. */
  currency: currency.optional(),
  note: z.string().max(255).optional(),
});

/**
 * Structured pay through the same agent graph as voice (Guardian + read-back). Returns 202 and
 * stops at the confirmation: POST /api/agent/{threadId} {"answer":"yes"}. No one-call payments.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const user = await getCurrentUser();
    return startStructured(user.id, {
      text: `Pay ${b.to} ${b.amount}${b.currency ? ` ${b.currency}` : ""}${b.note ? ` for ${b.note}` : ""}`,
      source: "api",
      intent: structuredIntent({ kind: "pay", recipient: b.to, amount: b.amount, currency: b.currency ?? null, note: b.note ?? null, noteEn: b.note ?? null }),
    });
  });
}
