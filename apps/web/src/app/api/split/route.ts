import { z } from "zod";
import { amount, currency, handle, recipient, toParty } from "@/lib/api";
import { createSplit } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";

const Body = z
  .object({
    title: z.string().min(1).max(200),
    currency: currency.optional(),
    total: amount.optional(),
    includeMe: z.boolean().optional(),
    members: z
      .array(z.object({ who: recipient, name: z.string().max(100).optional(), amount: amount.optional() }))
      .min(1)
      .max(20),
  })
  .refine((b) => b.total !== undefined || b.members.every((m) => m.amount !== undefined), {
    message: "Give a total, or an amount for every member",
  });

export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const user = await getCurrentUser();
    // Resolve everyone first so a typo fails before any invoice is sent.
    const members = [];
    for (const m of body.members) members.push({ party: await toParty(user.id, m.who, m.name), amount: m.amount });
    const result = await createSplit(user, {
      title: body.title,
      currency: body.currency ?? user.homeCurrency,
      total: body.total,
      includeMe: body.includeMe,
      members,
    });
    const allOk = result.members.every((m) => m.ok);
    return Response.json(result, { status: allOk ? 201 : 207 });
  });
}
