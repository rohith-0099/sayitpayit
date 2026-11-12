import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { VoiceAgent } from "@/components/agent/VoiceAgent";
import { LiteModeBanner } from "@/components/LiteModeBanner";
import { ActivityLists } from "@/components/activity/ActivityLists";
import { toRows } from "@/components/activity/rows";
import { listActivity, listOutstanding } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";
import { getVoiceProfile } from "@/lib/voice";
import { guardianConfigured } from "@/lib/guardian-url";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-10 px-4 py-6 sm:gap-12 sm:px-10 lg:py-10">
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
        <span className="ml-3 rounded-full px-2.5 py-1 align-middle text-xs font-medium text-mist ring-1 ring-line">PayPal sandbox</span>
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
      <nav className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 text-sm [&>*]:whitespace-nowrap">
        <Link href="/dashboard" className="text-paper transition hover:text-accent-hi">
          Dashboard
        </Link>
        {!guardianConfigured() ? (
          <span className="text-mist">Voice ID: available in local demo</span>
        ) : (
          <Link href="/voice" className={voice ? "text-signal hover:brightness-110" : "text-amber hover:brightness-110"}>
            {voice ? "Voice ID on" : "Set up Voice ID"}
          </Link>
        )}
        <Link href="/link" className="max-w-full truncate text-mist transition hover:text-accent-hi">
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
  const initial = toRows(
    activity.map((r) => ({ ...r.tx, contact: r.contact })),
    owed.map((o) => ({ ...o.tx, nickname: o.nickname, splitTitle: o.splitTitle })),
  );
  return <ActivityLists initial={initial} homeCurrency={user.homeCurrency} />;
}
