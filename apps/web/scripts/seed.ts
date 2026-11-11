// Seed the demo user, contacts and ~60 days of history.  Usage: npm run db:seed
//
// Safe to re-run:
// - rows tagged source='seed' are replaced (history is deterministic, so it comes back identical)
// - real sandbox rows (source='api'/'voice'/'text') are KEPT and linked to the demo user/contacts
// - contacts are updated in place, so their ids stay stable
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEMO_USER } from "../src/lib/demo";
import { quote } from "../src/lib/fees";
import { fallbackRate, round2 } from "../src/lib/fx";
import * as s from "../src/lib/db/schema";
import { generateSeed, SEED_CONTACTS, SEED_TRUSTED_CONTACT, type ContactKey } from "../src/lib/seed/data";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // no .env.local (e.g. on Render): use the real environment
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing (apps/web/.env.local)");

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema: s });

async function main() {
  // --if-empty (used on Render start): only seed a fresh database; never touch existing demo data.
  if (process.argv.includes("--if-empty")) {
    const existing = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, DEMO_USER.email)).limit(1);
    if (existing.length) {
      console.log("Demo data already present; skipping seed.");
      return;
    }
  }
  const { txs, splits, events } = generateSeed();

  const summary = await db.transaction(async (q) => {
    // 1. Demo user
    const [user] = await q
      .insert(s.users)
      .values({ ...DEMO_USER })
      .onConflictDoUpdate({ target: s.users.email, set: { name: DEMO_USER.name } })
      .returning();

    // 2. Clear previous seed rows (+ Phase 1 rows that failed before Invoicing was enabled)
    const oldSeed = q.select({ id: s.transactions.id }).from(s.transactions).where(eq(s.transactions.source, "seed"));
    await q.delete(s.guardianEvents).where(inArray(s.guardianEvents.transactionId, oldSeed));
    await q.delete(s.splits).where(
      inArray(
        s.splits.id,
        q.select({ id: sql<string>`${s.transactions.splitId}` }).from(s.transactions).where(eq(s.transactions.source, "seed")),
      ),
    );
    const removedSeed = await q.delete(s.transactions).where(eq(s.transactions.source, "seed")).returning({ id: s.transactions.id });
    const removedFailed = await q
      .delete(s.transactions)
      .where(and(eq(s.transactions.status, "failed"), sql`${s.transactions.error} like '%NOT_AUTHORIZED%'`))
      .returning({ id: s.transactions.id });
    // Splits left with no transactions at all (their only members were those failed rows).
    await q.execute(sql`delete from splits sp where not exists (select 1 from transactions t where t.split_id = sp.id)`);

    // 3. Contacts (update in place to keep ids stable) + trusted contact
    const contactIds = {} as Record<ContactKey, string>;
    for (const [key, c] of Object.entries(SEED_CONTACTS) as [ContactKey, (typeof SEED_CONTACTS)[ContactKey]][]) {
      const [existing] = await q
        .select({ id: s.contacts.id })
        .from(s.contacts)
        .where(and(eq(s.contacts.userId, user.id), sql`lower(${s.contacts.nickname}) = lower(${c.nickname})`));
      if (existing) {
        await q.update(s.contacts).set(c).where(eq(s.contacts.id, existing.id));
        contactIds[key] = existing.id;
      } else {
        const [row] = await q.insert(s.contacts).values({ ...c, userId: user.id }).returning({ id: s.contacts.id });
        contactIds[key] = row.id;
      }
    }
    await q.delete(s.trustedContacts).where(eq(s.trustedContacts.userId, user.id));
    await q.insert(s.trustedContacts).values({ ...SEED_TRUSTED_CONTACT, userId: user.id });

    // 4. Splits, transactions, split members, invoices, guardian events
    const splitIds: Record<string, string> = {};
    for (const sp of splits) {
      const [row] = await q
        .insert(s.splits)
        .values({ userId: user.id, title: sp.title, total: sp.total.toFixed(2), currency: sp.currency, myShare: sp.myShare.toFixed(2), createdAt: sp.createdAt })
        .returning({ id: s.splits.id });
      splitIds[sp.key] = row.id;
    }

    const txIds: Record<string, string> = {};
    for (const t of txs) {
      const c = SEED_CONTACTS[t.contact];
      const [row] = await q
        .insert(s.transactions)
        .values({
          userId: user.id,
          contactId: contactIds[t.contact],
          type: t.type,
          status: t.status,
          source: "seed",
          amount: t.amount.toFixed(2),
          currency: t.currency,
          homeAmount: t.homeAmount.toFixed(2),
          // Same fee model as the live read-back (PayPal's published consumer fees).
          fee:
            t.type === "pay"
              ? quote({ amount: t.amount, currency: t.currency, homeCurrency: "USD", rate: t.fxRate, category: c.relationship, senderCountry: "US", recipientCountry: c.country })
                  .fees.reduce((a, x) => a + x.amount, 0)
                  .toFixed(2)
              : null,
          fxRate: String(t.fxRate),
          relationship: c.relationship,
          counterpartyEmail: c.paypalEmail,
          counterpartyName: c.fullName,
          note: t.note,
          command: t.command,
          splitId: t.splitKey ? splitIds[t.splitKey] : undefined,
          riskScore: t.type === "pay" ? t.riskScore : null,
          decision: t.type === "pay" ? (t.riskScore > 0.4 ? "ASK_QUESTIONS" : "ALLOW") : null,
          createdAt: t.createdAt,
          updatedAt: t.createdAt,
        })
        .returning({ id: s.transactions.id });
      txIds[t.key] = row.id;

      if (t.type !== "pay") {
        await q.insert(s.invoices).values({
          transactionId: row.id,
          language: c.language,
          items: [{ name: t.note, amount: t.amount }],
          dueDate: new Date(t.createdAt.getTime() + 7 * 86_400_000),
          createdAt: t.createdAt,
        });
      }
    }

    for (const sp of splits) {
      const splitTxs = txs.filter((t) => t.splitKey === sp.key);
      await q.insert(s.splitMembers).values(
        sp.members.map((m) => {
          const tx = splitTxs.find((t) => t.contact === m.contact)!;
          return {
            splitId: splitIds[sp.key],
            contactId: contactIds[m.contact],
            name: SEED_CONTACTS[m.contact].fullName,
            email: SEED_CONTACTS[m.contact].paypalEmail,
            share: m.share.toFixed(2),
            transactionId: txIds[tx.key],
          };
        }),
      );
    }

    await q.insert(s.guardianEvents).values(
      events.map((e) => ({
        userId: user.id,
        transactionId: txIds[e.txKey],
        decision: e.decision,
        riskScore: e.riskScore,
        scamScore: e.scamScore,
        voiceMatch: e.voiceMatch,
        spoofScore: e.spoofScore,
        signals: e.signals,
        explanation: e.explanation,
        resolution: e.resolution,
        createdAt: txs.find((t) => t.key === e.txKey)!.createdAt,
      })),
    );

    // 5. Link real (non-seed) sandbox rows to the demo user and contacts
    const real = await q.select().from(s.transactions).where(sql`${s.transactions.source} <> 'seed'`);
    const contacts = await q.select().from(s.contacts).where(eq(s.contacts.userId, user.id));
    for (const t of real) {
      const c = contacts.find((x) => x.paypalEmail.toLowerCase() === t.counterpartyEmail.toLowerCase());
      const fx = t.fxRate ? Number(t.fxRate) : fallbackRate(t.currency, user.homeCurrency);
      await q
        .update(s.transactions)
        .set({
          userId: t.userId ?? user.id,
          contactId: t.contactId ?? c?.id,
          relationship: t.relationship ?? c?.relationship,
          fxRate: t.fxRate ?? String(round2(fx * 1e4) / 1e4),
          homeAmount: t.homeAmount ?? round2(Number(t.amount) * fx).toFixed(2),
        })
        .where(eq(s.transactions.id, t.id));
      if (t.type !== "pay" && t.paypalInvoiceId) {
        await q
          .insert(s.invoices)
          .values({
            transactionId: t.id,
            paypalInvoiceId: t.paypalInvoiceId,
            payerViewUrl: t.paypalInvoiceUrl,
            language: c?.language ?? "en",
            items: [{ name: t.note ?? "Payment request", amount: Number(t.amount) }],
            createdAt: t.createdAt,
          })
          .onConflictDoNothing();
      }
    }
    await q.update(s.splits).set({ userId: user.id }).where(isNull(s.splits.userId));
    // Real splits created in Phase 1 have no member rows yet.
    await q.execute(sql`
      insert into split_members (split_id, contact_id, name, email, share, transaction_id)
      select t.split_id, t.contact_id, t.counterparty_name, t.counterparty_email, t.amount, t.id
      from transactions t
      where t.split_id is not null and t.source <> 'seed'
        and not exists (select 1 from split_members m where m.transaction_id = t.id)`);

    // my_share for real splits = total − what was invoiced to others.
    await q.execute(sql`
      update splits sp set my_share = greatest(sp.total - coalesce((select sum(m.share) from split_members m where m.split_id = sp.id), 0), 0)
      where sp.my_share is null`);

    return {
      user: user.email,
      contacts: Object.keys(contactIds).length,
      seedTransactions: txs.length,
      splits: splits.length,
      guardianEvents: events.length,
      replacedSeedRows: removedSeed.length,
      removedFailedPhase1Rows: removedFailed.length,
      realRowsLinked: real.length,
    };
  });

  console.table(summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
