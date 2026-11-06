import { z } from "zod";
import { amount, currency, handle, recipient } from "@/lib/api";
import { startStructured, structuredIntent } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  /** Contact name ("John") or PayPal email. */
  from: recipient,
  amount,
  /** Defaults to the user's home currency. */
  currency: currency.optional(),
  /** What it's for; becomes the invoice line item. */
  note: z.string().max(200).optional(),
});

/** Structured request: Guardian + read-back, then waits for a yes (202). Nothing is sent until then. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const user = await getCurrentUser();
    return startStructured(user.id, {
      text: `Ask ${b.from} for ${b.amount}${b.currency ? ` ${b.currency}` : ""}${b.note ? ` for ${b.note}` : ""}`,
      source: "api",
      intent: structuredIntent({ kind: "request", recipient: b.from, amount: b.amount, currency: b.currency ?? null, note: b.note ?? null, noteEn: b.note ?? null }),
    });
  });
}
