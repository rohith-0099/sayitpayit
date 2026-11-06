import { z } from "zod";
import { amount, currency, email, handle } from "@/lib/api";
import { createSplit } from "@/lib/payments/service";

const Body = z
  .object({
    title: z.string().min(1).max(200),
    currency,
    total: amount.optional(),
    includeMe: z.boolean().optional(),
    members: z
      .array(z.object({ email, name: z.string().max(100).optional(), amount: amount.optional() }))
      .min(1)
      .max(20),
  })
  .refine((b) => b.total !== undefined || b.members.every((m) => m.amount !== undefined), {
    message: "Give a total, or an amount for every member",
  });

export async function POST(req: Request) {
  return handle(async () => {
    const result = await createSplit(Body.parse(await req.json()));
    const allOk = result.members.every((m) => m.ok);
    return Response.json(result, { status: allOk ? 201 : 207 });
  });
}
