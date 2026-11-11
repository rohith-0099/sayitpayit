// Reset the LOCAL demo database for video retakes.  Usage: npm run demo:reset
//
// Deletes: every non-seed transaction (+ its invoices, split members, Guardian events),
//          splits that held them, paused agent conversations, voice-check records.
// Keeps:   the demo user and their PayPal link, contacts, trusted contact, voice profile.
// Then re-runs the seed so the 60-day history ends today.
// PayPal's sandbox is never touched: invoices/payouts already sent stay in PayPal.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // no .env.local (e.g. on Render): use the real environment
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing (apps/web/.env.local)");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
  console.error(`Refusing to reset a non-local database (${host}). This script is for local retakes only.`);
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

async function count(q: ReturnType<typeof sql>) {
  const [row] = await db.execute<{ n: number }>(q);
  return Number(row?.n ?? 0);
}

async function main() {
  const before = {
    nonSeedTransactions: await count(sql`select count(*) n from transactions where source <> 'seed'`),
    agentGuardianEvents: await count(
      sql`select count(*) n from guardian_events g where g.transaction_id is null or not exists (select 1 from transactions t where t.id = g.transaction_id and t.source = 'seed')`,
    ),
  };

  await db.transaction(async (q) => {
    // Guardian events from agent runs (seeded events stay attached to seeded transactions).
    await q.execute(sql`
      delete from guardian_events g
      where g.transaction_id is null
         or not exists (select 1 from transactions t where t.id = g.transaction_id and t.source = 'seed')`);
    // Splits that contain any non-seed transaction (split_members cascade).
    await q.execute(sql`delete from splits where id in (select split_id from transactions where source <> 'seed' and split_id is not null)`);
    // Non-seed transactions (invoices cascade).
    await q.execute(sql`delete from transactions where source <> 'seed'`);
    // Paused confirmations and voice checks (tables may not exist yet).
    for (const t of ["langgraph.checkpoint_writes", "langgraph.checkpoint_blobs", "langgraph.checkpoints", "voice_checks"]) {
      await q.execute(sql.raw(`do $$ begin if to_regclass('${t}') is not null then execute 'delete from ${t}'; end if; end $$;`));
    }
  });

  const kept = await db.execute<{ users: number; linked: number; contacts: number; voice: number }>(sql`
    select (select count(*) from users) users,
           (select count(*) from users where paypal_vault_id is not null) linked,
           (select count(*) from contacts) contacts,
           (select count(*) from voice_profiles) voice`);

  console.log("Removed:", before);
  console.log("Kept:", kept[0]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
