import { randomUUID } from "node:crypto";
import { z } from "zod";
import { amount, currency, handle, recipient } from "@/lib/api";
import { collect, runAgent } from "@/lib/agent/run";
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
 * Structured pay. Goes through the same agent graph as voice (Guardian + read-back) and
 * stops at the confirmation: answer with POST /api/agent/{threadId} {"answer":"yes"}.
 * There is deliberately no way to pay in one call.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const b = Body.parse(await req.json());
    const user = await getCurrentUser();
    const threadId = randomUUID();
    const last = await collect(
      runAgent({
        userId: user.id,
        threadId,
        input: {
          text: `Pay ${b.to} ${b.amount}${b.currency ? ` ${b.currency}` : ""}${b.note ? ` for ${b.note}` : ""}`,
          source: "api",
          intent: { kind: "pay", recipient: b.to, members: [], amount: b.amount, currency: b.currency ?? null, note: b.note ?? null, includeMe: true, language: "en", clarification: null },
        },
      }),
    );
    if (last?.type === "confirm") {
      return Response.json({ threadId, awaiting: "confirmation", readback: last.readback, guardian: last.view.guardian, quote: last.view.quote }, { status: 202 });
    }
    if (last?.type === "final") return Response.json({ threadId, ...last.view }, { status: last.view.outcome === "blocked" ? 403 : 422 });
    return Response.json(last ?? { error: "No response" }, { status: 500 });
  });
}
