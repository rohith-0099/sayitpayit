import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { PayPalError } from "./paypal";

/** Wrap a route body: zod → 400, PayPal → 502 with PayPal's reason, anything else → 500. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    unstable_rethrow(e); // let Next's internal control-flow errors through
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: z.flattenError(e) }, { status: 400 });
    if (e instanceof PayPalError) {
      console.error("[paypal]", e.message);
      return Response.json({ error: e.message, issue: e.issue, debugId: e.debugId }, { status: e.status === 422 || e.status === 400 ? 422 : 502 });
    }
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}

export const currency = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase());
// Sandbox demo cap keeps a typo from draining test balances.
export const amount = z.number().positive().max(10_000);
export const email = z.email();
