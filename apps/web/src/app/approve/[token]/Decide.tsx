"use client";

import { useState } from "react";

export function Decide({ token, initialStatus, userFirstName }: { token: string; initialStatus: string; contactFirstName: string; userFirstName: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "approved" | "denied") => {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/holds/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(body.error ?? "Couldn't save your decision. Try again.");
    setStatus(body.status);
  };

  if (status === "denied")
    return (
      <p role="status" className="rounded-3xl bg-signal/10 p-6 font-display text-2xl font-bold text-signal ring-1 ring-signal/40">
        Stopped. Nothing was sent. Consider calling {userFirstName} to check they&apos;re okay.
      </p>
    );
  if (status === "approved")
    return (
      <p role="status" className="rounded-3xl p-6 text-lg ring-1 ring-line">
        Approved. {userFirstName} still has to confirm the payment before anything is sent.
      </p>
    );
  if (status === "cancelled")
    return <p className="rounded-3xl p-6 text-lg ring-1 ring-line">{userFirstName} cancelled this payment. Nothing was sent.</p>;

  return (
    <div className="flex flex-col gap-3">
      <button type="button" disabled={busy} onClick={() => decide("denied")} className="rounded-full bg-coral px-6 py-4 text-lg font-bold text-ink disabled:opacity-60">
        Stop this payment
      </button>
      <button type="button" disabled={busy} onClick={() => decide("approved")} className="rounded-full px-6 py-4 text-lg ring-1 ring-line hover:ring-mist disabled:opacity-60">
        It&apos;s fine, let {userFirstName} continue
      </button>
      {error && <p className="text-coral">{error}</p>}
    </div>
  );
}
