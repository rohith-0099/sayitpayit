import "server-only";
// Non-payment actions the voice agent can take after a "yes": cancel an invoice, add a contact,
// change the trusted Guardian contact. Nothing here moves money.
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { User } from "./db/schema";
import { cancelInvoice } from "./paypal";

const { transactions, contacts, trustedContacts } = schema;

/** Invoices the user sent that nobody has paid yet (requests and split shares). */
export function listOpenInvoices(userId: string) {
  return db
    .select({ tx: transactions, nickname: contacts.nickname })
    .from(transactions)
    .leftJoin(contacts, eq(contacts.id, transactions.contactId))
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.type, ["request", "split"]),
        eq(transactions.status, "sent"),
        isNotNull(transactions.paypalInvoiceId),
      ),
    )
    .orderBy(desc(transactions.createdAt));
}

export type OpenInvoice = Awaited<ReturnType<typeof listOpenInvoices>>[number];
export { pickInvoices } from "./invoice-pick";

export async function cancelOpenInvoice(user: User, transactionId: string) {
  const [tx] = await db.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userId, user.id)));
  if (!tx?.paypalInvoiceId) throw new Error("That invoice doesn't exist any more.");
  if (tx.status !== "sent") throw new Error(`That invoice is already ${tx.status === "completed" ? "paid" : tx.status}.`);
  await cancelInvoice(tx.paypalInvoiceId, `${user.name} cancelled this request in SayItPayIt. You don't need to pay it.`);
  const [updated] = await db.update(transactions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(transactions.id, tx.id)).returning();
  return updated;
}

export async function findContactConflict(userId: string, nickname: string, email: string) {
  const [byName] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), sql`lower(${contacts.nickname}) = ${nickname.toLowerCase()}`));
  if (byName) return { field: "name" as const, contact: byName };
  const [byEmail] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), sql`lower(${contacts.paypalEmail}) = ${email.toLowerCase()}`));
  return byEmail ? { field: "email" as const, contact: byEmail } : null;
}

export async function addContact(
  user: User,
  c: { nickname: string; fullName: string | null; email: string; relationship: "friends_family" | "business"; currency: string; country: string; language: string },
) {
  const [row] = await db
    .insert(contacts)
    .values({ userId: user.id, nickname: c.nickname, fullName: c.fullName, paypalEmail: c.email, relationship: c.relationship, currency: c.currency, country: c.country, language: c.language })
    .returning();
  return row;
}

export async function getTrustedContact(userId: string) {
  const [row] = await db.select().from(trustedContacts).where(eq(trustedContacts.userId, userId)).limit(1);
  return row ?? null;
}

/** Guardian mode has one trusted contact per user: replace it. */
export async function setTrustedContact(userId: string, t: { name: string; email: string; relation: string; language: string }) {
  return db.transaction(async (q) => {
    await q.delete(trustedContacts).where(eq(trustedContacts.userId, userId));
    const [row] = await q.insert(trustedContacts).values({ userId, ...t }).returning();
    return row;
  });
}
