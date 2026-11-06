import { z } from "zod";
import { amount, currency, handle, recipient, toParty } from "@/lib/api";
import { executePay } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  /** Contact name ("Maria") or PayPal email. */
  to: recipient,
  toName: z.string().max(100).optional(),
  amount,
  /** Defaults to the contact's currency, else USD. */
  currency: currency.optional(),
  note: z.string().max(255).optional(),
  // Hard rule: never execute without explicit user confirmation.
  // Phase 4 replaces this flag with a signed token issued by the agent's Confirm step.
  confirmed: z.literal(true, { error: "Payment requires explicit user confirmation" }),
});

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const user = await getCurrentUser();
    const to = await toParty(user.id, body.to, body.toName);
    const cur = body.currency ?? ("contact" in to ? to.contact.currency : "USD");
    const transaction = await executePay(user, { to, amount: body.amount, currency: cur, note: body.note });
    return Response.json({ transaction }, { status: 201 });
  });
}
