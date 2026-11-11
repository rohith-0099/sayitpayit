import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { VoiceAgent } from "@/components/agent/VoiceAgent";
import { LiteModeBanner } from "@/components/LiteModeBanner";
import { listActivity, listOutstanding } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";
import { getVoiceProfile } from "@/lib/voice";
import { guardianConfigured } from "@/lib/guardian-url";

const fmt = (amount: string | number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));

const STATUS: Record<string, { label: string; className: string }> = {
  completed: { label: "Done", className: "text-signal" },
  sent: { label: "On its way", className: "text-paper/80" },
  unclaimed: { label: "Waiting to be claimed", className: "text-amber" },
  failed: { label: "Failed", className: "text-coral" },
  refunded: { label: "Refunded", className: "text-amber" },
  cancelled: { label: "Cancelled", className: "text-mist" },
  pending: { label: "Pending", className: "text-mist" },
};

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-12 px-6 py-8 sm:px-10 lg:py-10">
      <Suspense fallback={<Header />}>
        <HeaderWithUser />
      </Suspense>
      <Suspense fallback={null}>
        <LiteModeBanner />
      </Suspense>
      <Suspense fallback={<p className="text-mist">Loading…</p>}>
        <Agent />
      </Suspense>
      <Suspense fallback={null}>
        <Activity />
      </Suspense>
    </main>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <p className="font-display text-2xl font-bold tracking-tight">
        SayItPayIt
        <span className="ml-3 align-middle text-sm font-normal text-mist">PayPal sandbox</span>
      </p>
      {children}
    </header>
  );
}

async function HeaderWithUser() {
  await connection();
  const user = await getCurrentUser();
  const voice = await getVoiceProfile(user.id);
  return (
    <Header>
      <nav className="flex items-center gap-6 text-sm">
        <Link href="/dashboard" className="text-paper hover:text-signal">
          Dashboard
        </Link>
        {!guardianConfigured() ? (
          <span className="text-mist">Voice ID: local only</span>
        ) : (
          <Link href="/voice" className={voice ? "text-signal hover:brightness-110" : "text-amber hover:brightness-110"}>
            {voice ? "Voice ID on" : "Set up Voice ID"}
          </Link>
        )}
        <Link href="/link" className="text-mist hover:text-paper">
          {user.paypalVaultId ? <>Paying from {user.paypalPayerEmail ?? "your PayPal"}</> : "Link your PayPal"}
        </Link>
      </nav>
    </Header>
  );
}

async function Agent() {
  await connection();
  const user = await getCurrentUser();
  return <VoiceAgent linked={!!user.paypalVaultId} />;
}

async function Activity() {
  await connection();
  const user = await getCurrentUser();
  const [activity, owed] = await Promise.all([listActivity(user.id, 8), listOutstanding(user.id)]);
  const owedTotal = owed.reduce((a, o) => a + Number(o.tx.homeAmount ?? o.tx.amount), 0);

  return (
    <section className="grid gap-10 border-t border-line pt-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14">
      <div>
        <h2 className="font-display text-xl font-bold">Recent</h2>
        <ul className="mt-3 divide-y divide-line">
          {activity.map(({ tx, contact }) => {
            const st = STATUS[tx.status] ?? STATUS.pending;
            return (
              <li key={tx.id} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0 truncate">
                  {tx.type === "pay" ? "You paid " : "You asked "}
                  <span className="font-bold">{contact?.nickname ?? tx.counterpartyName}</span>
                  {tx.note && <span className="text-mist"> for {tx.note.replace(/^Your share of /, "their share of ")}</span>}
                </span>
                <span className="flex shrink-0 items-baseline gap-4">
                  <span className={`text-sm ${st.className}`}>{st.label}</span>
                  <span className="font-display text-lg font-semibold tabular-nums">{fmt(tx.amount, tx.currency)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h2 className="font-display text-xl font-bold">Waiting on</h2>
        {owed.length === 0 ? (
          <p className="mt-3 text-mist">Nobody owes you anything right now.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-mist">About {fmt(owedTotal, user.homeCurrency)} in open requests</p>
            <ul className="mt-3 divide-y divide-line">
              {owed.slice(0, 6).map(({ tx, nickname, splitTitle }) => (
                <li key={tx.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0 truncate">
                    <span className="font-bold">{nickname ?? tx.counterpartyName}</span>
                    {(splitTitle ?? tx.note) && <span className="text-mist"> for {splitTitle ?? tx.note}</span>}
                  </span>
                  <span className="font-display text-lg font-semibold tabular-nums text-amber">{fmt(tx.amount, tx.currency)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
