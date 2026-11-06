import { z } from "zod";
import { amount, currency, email, handle } from "@/lib/api";
import { executePay } from "@/lib/payments/service";

const Body = z.object({
  to: email,
  toName: z.string().max(100).optional(),
  amount,
  currency,
  note: z.string().max(255).optional(),
  // Hard rule: never execute without explicit user confirmation.
  // Phase 4 replaces this flag with a signed token issued by the agent's Confirm step.
  confirmed: z.literal(true, { error: "Payment requires explicit user confirmation" }),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { to, toName, amount, currency, note } = Body.parse(await req.json());
    const transaction = await executePay({ to, toName, amount, currency, note });
    return Response.json({ transaction }, { status: 201 });
  });
}
