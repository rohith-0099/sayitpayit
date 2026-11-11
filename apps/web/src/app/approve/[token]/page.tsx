import { connection } from "next/server";
import { Suspense } from "react";
import { getHoldByToken, type HoldSummary } from "@/lib/holds";
import { Decide } from "./Decide";

export const metadata = { title: "Check a payment · SayItPayIt Guardian", robots: { index: false } };

export default function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-5 py-10">
      <p className="font-display text-xl font-bold">SayItPayIt Guardian</p>
      <Suspense fallback={<p className="text-mist">Loading…</p>}>
        <Hold params={params} />
      </Suspense>
    </main>
  );
}

async function Hold({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const found = await getHoldByToken(token);
  if (!found) return <p className="rounded-2xl bg-coral/10 p-5 text-coral ring-1 ring-coral/40">This link isn&apos;t valid or has expired.</p>;
  const s = found.hold.summary as HoldSummary;
  const contact = found.contact?.name.split(" ")[0] ?? "there";
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
          Hi {contact}, {s.userName.split(" ")[0]} may be talking to a scammer.
        </h1>
        <p className="text-mist">Guardian paused this payment and asked you to check it.</p>
      </header>

      <section className="rounded-3xl bg-panel p-6 ring-1 ring-line">
        <p className="text-mist">{s.userName.split(" ")[0]} asked to</p>
        <p className="mt-1 font-display text-2xl font-bold">{s.what}</p>
        <p className="mt-4 text-mist">What they said</p>
        <p className="mt-1 italic">&ldquo;{s.command}&rdquo;</p>
      </section>

      <section className="rounded-3xl bg-coral/10 p-6 ring-1 ring-coral/40">
        <p className="font-bold text-coral">Why Guardian paused it</p>
        <p className="mt-2">{s.familySummary}</p>
        {s.signals.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-amber">
            {s.signals.map((x) => (
              <li key={x}>! {x}</li>
            ))}
          </ul>
        )}
      </section>

      {s.qa.length > 0 && (
        <section className="rounded-3xl p-6 ring-1 ring-line">
          <p className="font-bold">Guardian&apos;s questions</p>
          <dl className="mt-3 flex flex-col gap-3">
            {s.qa.map((x) => (
              <div key={x.q}>
                <dt className="text-sm text-mist">{x.q}</dt>
                <dd className="mt-0.5">&ldquo;{x.a}&rdquo;</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Decide token={token} initialStatus={found.hold.status} contactFirstName={contact} userFirstName={s.userName.split(" ")[0]} />
    </>
  );
}
