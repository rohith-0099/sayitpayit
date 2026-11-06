import { z } from "zod";
import { amount, currency, email, handle } from "@/lib/api";
import { createRequest } from "@/lib/payments/service";

const Body = z.object({
  from: email,
  fromName: z.string().max(100).optional(),
  amount,
  currency,
  note: z.string().max(4000).optional(),
  item: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  return handle(async () => Response.json(await createRequest(Body.parse(await req.json())), { status: 201 }));
}
