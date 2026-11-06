import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { User } from "./db/schema";
import { ApiError } from "./errors";
import { createPaymentToken, createPayPalSetupToken, deletePaymentToken } from "./paypal";

const { users } = schema;

/** Public view of the link (never includes the payment token). */
export function linkStatus(user: User) {
  return {
    linked: !!user.paypalVaultId,
    email: user.paypalPayerEmail,
    linkedAt: user.paypalLinkedAt,
  };
}

/** Step 1: issue a setup token for this user and remember it. */
export async function startLink(user: User, origin: string) {
  const token = await createPayPalSetupToken({
    returnUrl: `${origin}/link?paypal=return`,
    cancelUrl: `${origin}/link?paypal=cancel`,
    requestId: `setup-${user.id}-${Date.now()}`,
    customerId: user.paypalCustomerId ?? undefined,
  });
  await db.update(users).set({ paypalPendingSetupToken: token.id }).where(eq(users.id, user.id));
  return { vaultSetupToken: token.id };
}

/**
 * Step 2 (after the payer approves): convert OUR pending setup token into a payment token.
 * A token from the browser is only accepted if it matches the one we issued.
 */
export async function completeLink(user: User, vaultSetupToken?: string) {
  const pending = user.paypalPendingSetupToken;
  if (!pending) throw new ApiError(409, "No PayPal link in progress. Start again from /link.");
  if (vaultSetupToken && vaultSetupToken !== pending) throw new ApiError(400, "Setup token mismatch. Start again from /link.");

  const pt = await createPaymentToken(pending);
  const paypal = pt.payment_source.paypal;
  const [updated] = await db
    .update(users)
    .set({
      paypalVaultId: pt.id,
      paypalCustomerId: pt.customer?.id,
      paypalPayerEmail: paypal?.email_address ?? null,
      paypalLinkedAt: new Date(),
      paypalPendingSetupToken: null,
    })
    .where(eq(users.id, user.id))
    .returning();
  return linkStatus(updated);
}

export async function unlink(user: User) {
  if (user.paypalVaultId) {
    await deletePaymentToken(user.paypalVaultId).catch((e) => {
      // Already gone on PayPal's side is fine; anything else should surface.
      if (e?.status !== 404) throw e;
    });
  }
  const [updated] = await db
    .update(users)
    .set({ paypalVaultId: null, paypalPayerEmail: null, paypalLinkedAt: null, paypalPendingSetupToken: null })
    .where(eq(users.id, user.id))
    .returning();
  return linkStatus(updated);
}
