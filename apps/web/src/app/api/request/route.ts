import { z } from "zod";
import { amount, currency, handle, recipient, toParty } from "@/lib/api";
import { createRequest } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  /** Contact name ("John") or PayPal email. */
  from: recipient,
  fromName: z.string().max(100).optional(),
  amount,
  /** Defaults to the user's home currency. */
  currency: currency.optional(),
  note: z.string().max(4000).optional(),
  item: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const user = await getCurrentUser();
    const from = await toParty(user.id, body.from, body.fromName);
    const result = await createRequest(user, {
      from,
      amount: body.amount,
      currency: body.currency ?? user.homeCurrency,
      note: body.note,
      item: body.item,
    });
    return Response.json(result, { status: 201 });
  });
}
