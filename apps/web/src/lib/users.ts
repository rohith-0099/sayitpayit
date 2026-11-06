import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { DEMO_USER } from "./demo";
import { matchContact, type MatchResult } from "./contacts-match";
import type { Contact } from "./db/schema";

/** No auth in the hackathon build: the current user is the seeded demo user. */
export async function getCurrentUser() {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, DEMO_USER.email));
  if (!user) throw new Error("Demo user not found. Run `npm run db:seed` in apps/web.");
  return user;
}

export function listContacts(userId: string) {
  return db.select().from(schema.contacts).where(eq(schema.contacts.userId, userId)).orderBy(asc(schema.contacts.nickname));
}

export type { Contact };

/**
 * Resolve a recipient given as an email or a spoken name.
 * Unknown emails are allowed (a brand-new payee; Guardian weighs that), unknown names are not.
 */
export async function resolveRecipient(
  userId: string,
  to: string,
): Promise<MatchResult<Contact> | { kind: "new_email"; email: string }> {
  const contacts = await listContacts(userId);
  const r = matchContact(to, contacts);
  if (r.kind === "none" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) return { kind: "new_email", email: to.trim() };
  return r;
}
