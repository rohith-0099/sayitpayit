import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { appUrl } from "./env";

const { guardianHolds, trustedContacts } = schema;

export interface HoldSummary {
  userName: string;
  what: string; // "Pay Maria €500 for gift cards"
  amountText: string;
  recipient: string;
  signals: string[];
  qa: { q: string; a: string }[];
  familySummary: string;
  command: string;
}

/** Create (or return the existing) hold for this conversation. Idempotent: graph nodes re-run on resume. */
export async function openHold(opts: { userId: string; threadId: string; summary: HoldSummary }) {
  const [existing] = await db.select().from(guardianHolds).where(eq(guardianHolds.threadId, opts.threadId));
  const [contact] = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, opts.userId)).limit(1);
  const hold =
    existing ??
    (
      await db
        .insert(guardianHolds)
        .values({ userId: opts.userId, threadId: opts.threadId, token: randomBytes(24).toString("base64url"), trustedContactId: contact?.id, summary: opts.summary })
        .returning()
    )[0];
  return { hold, contact: contact ?? null, url: `${appUrl()}/approve/${hold.token}` };
}

export async function getHoldByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await db
    .select({ hold: guardianHolds, contact: trustedContacts })
    .from(guardianHolds)
    .leftJoin(trustedContacts, eq(trustedContacts.id, guardianHolds.trustedContactId))
    .where(eq(guardianHolds.token, token));
  return row ?? null;
}

/** Record the family member's decision once. Returns the updated hold, or null if already decided. */
export async function decideHold(token: string, status: "approved" | "denied") {
  const [row] = await db
    .update(guardianHolds)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(guardianHolds.token, token), eq(guardianHolds.status, "pending")))
    .returning();
  return row ?? null;
}

export async function cancelHold(threadId: string) {
  await db.update(guardianHolds).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(guardianHolds.threadId, threadId), eq(guardianHolds.status, "pending")));
}
