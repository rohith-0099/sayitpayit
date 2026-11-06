import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { linkStatus } from "@/lib/link";
import { getCurrentUser } from "@/lib/users";
import { LinkPayPal } from "./LinkPayPal";
import { UnlinkButton } from "./UnlinkButton";

export const metadata = { title: "Link your PayPal · SayItPayIt" };

export default function LinkPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Link href="/" className="text-sm text-mist hover:text-paper/90">
        ← SayItPayIt
      </Link>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Link your PayPal, once.</h1>
        <p className="text-mist">
          Approve SayItPayIt one time. After that, you pay anyone by just saying it, with no PayPal pop-up.
        </p>
      </header>
      <ul className="flex flex-col gap-2 text-sm text-paper/90">
        <li>✓ Every payment is read back to you and waits for your &ldquo;yes&rdquo;.</li>
        <li>✓ Guardian checks your voice and stops scams before money leaves.</li>
        <li>✓ Unlink any time. PayPal keeps your login and card details, never us.</li>
      </ul>
      <Suspense fallback={<p className="text-sm text-mist">Checking your link…</p>}>
        <Status />
      </Suspense>
      <p className="text-xs text-mist/70">PayPal sandbox. No real money moves.</p>
    </main>
  );
}

async function Status() {
  await connection();
  const status = linkStatus(await getCurrentUser());
  if (!status.linked) return <LinkPayPal />;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-signal/40 bg-signal/10 p-5">
      <p className="font-medium text-signal">PayPal linked</p>
      <p className="text-sm text-paper/90">
        {status.email ?? "Your PayPal account"}
        {status.linkedAt && (
          <span className="text-mist"> · since {status.linkedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
        )}
      </p>
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-signal hover:underline">
          Start paying →
        </Link>
        <UnlinkButton />
      </div>
    </div>
  );
}
