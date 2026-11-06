import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ApiError } from "./errors";
import { PayPalError } from "./paypal";
import type { Party } from "./payments/service";
import { resolveRecipient } from "./users";

export { ApiError };

/** Wrap a route body: zod → 400, PayPal → 502 with PayPal's reason, anything else → 500. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    unstable_rethrow(e); // let Next's internal control-flow errors through
    if (e instanceof ApiError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
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

/** A recipient given as a contact name ("Maria") or an email. */
export const recipient = z.string().trim().min(1).max(254);

/** Resolve a name/email to a Party, or fail with 404 (unknown) / 409 (ambiguous). */
export async function toParty(userId: string, to: string, name?: string): Promise<Party> {
  const r = await resolveRecipient(userId, to);
  switch (r.kind) {
    case "exact":
      return { contact: r.contact };
    case "new_email":
      return { email: r.email, name };
    case "ambiguous":
      throw new ApiError(409, `"${to}" matches more than one contact`, {
        candidates: r.candidates.map((c) => ({ nickname: c.nickname, fullName: c.fullName, email: c.paypalEmail })),
      });
    case "none":
      throw new ApiError(404, `No contact called "${to}". Use their PayPal email or add them as a contact.`);
  }
}
