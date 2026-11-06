import { connection } from "next/server";
import { Suspense } from "react";
import { listActivity, listOutstanding } from "@/lib/payments/service";
import { getCurrentUser, listContacts } from "@/lib/users";

// Phase 2 view: proves the app reads contacts + history from Postgres.
// Phase 4 replaces this with the voice UI.

const fmt = (amount: string | number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));

const FLAGS: Record<string, string> = { US: "🇺🇸", DE: "🇩🇪", MX: "🇲🇽", JP: "🇯🇵" };

const STATUS_STYLE: Record<string, string> = {
  completed: "text-emerald-300",
  sent: "text-amber-300",
  unclaimed: "text-sky-300",
  failed: "text-rose-300",
};

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-14 text-zinc-50">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">SayItPayIt</h1>
        <p className="text-zinc-400">
          Pay anyone, anywhere, just by saying it, and the scam stops before the money leaves.
        </p>
        <span className="w-fit rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-0.5 text-xs text-emerald-300">
          PayPal sandbox · Guardian on
        </span>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Loading your money…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}

async function Overview() {
  await connection();
  const user = await getCurrentUser();
  const [contacts, activity, owed] = await Promise.all([
    listContacts(user.id),
    listActivity(user.id, 12),
    listOutstanding(user.id),
  ]);

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">{user.name}&apos;s contacts</h2>
        <ul className="flex flex-wrap gap-2">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              <span className="mr-1">{FLAGS[c.country] ?? "🌍"}</span>
              <span className="font-medium">{c.nickname}</span>
              <span className="ml-2 text-zinc-500">
                {c.currency} · {c.relationship === "business" ? "Goods & Services" : "Friends & Family"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Who owes you</h2>
        {owed.length === 0 ? (
          <p className="text-zinc-500">Everyone&apos;s square.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
            {owed.map(({ tx, nickname, splitTitle }) => (
              <li key={tx.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{nickname ?? tx.counterpartyName ?? tx.counterpartyEmail}</span>
                  <span className="ml-2 text-zinc-500">{splitTitle ?? tx.note}</span>
                </span>
                <span className="tabular-nums text-amber-300">{fmt(tx.amount, tx.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Recent activity</h2>
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900">
          {activity.map(({ tx, contact }) => (
            <li key={tx.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-zinc-500">{tx.type === "pay" ? "Paid" : "Requested from"} </span>
                <span className="font-medium">{contact?.nickname ?? tx.counterpartyName}</span>
                <span className="ml-2 text-zinc-500">{tx.note}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className={`text-xs ${STATUS_STYLE[tx.status] ?? "text-zinc-400"}`}>{tx.status}</span>
                <span className="tabular-nums">{fmt(tx.amount, tx.currency)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
