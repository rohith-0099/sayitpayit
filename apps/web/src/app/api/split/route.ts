import { z } from "zod";
import { amount, currency, handle, recipient } from "@/lib/api";
import { startStructured, structuredIntent } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  title: z.string().min(1).max(200),
  /** Bill total, split equally. */
  total: amount,
  currency: currency.optional(),
  /** Whether you pay a share too (default true). */
  includeMe: z.boolean().optional(),
  /** Contact names or PayPal emails. */
  members: z.array(recipient).min(1).max(20),
});

/** Structured equal split: one invoice per person after Guardian + read-back + your yes (202 until then). */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const user = await getCurrentUser();
    return startStructured(user.id, {
      text: `Split ${b.title} ${b.total}${b.currency ? ` ${b.currency}` : ""} with ${b.members.join(", ")}`,
      source: "api",
      intent: structuredIntent({ kind: "split", members: b.members, amount: b.total, currency: b.currency ?? null, note: b.title, includeMe: b.includeMe ?? true }),
    });
  });
}
