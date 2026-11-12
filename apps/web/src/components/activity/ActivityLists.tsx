"use client";

import { useEffect, useState } from "react";
import { toRows, type ActivityRow, type OwedRow } from "./rows";

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

/**
 * "Recent" and "Waiting on". Reloads whenever the agent finishes something (the `sip:activity`
 * event), then once more a few seconds later to pick up PayPal's payout status.
 */
export function ActivityLists({ initial, homeCurrency, limit = 8 }: { initial: { activity: ActivityRow[]; owed: OwedRow[] }; homeCurrency: string; limit?: number }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (sync = false) => {
      const r = await fetch(`/api/activity?limit=${limit}${sync ? "&sync=1" : ""}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const body = await r.json();
      setData(toRows(body.transactions, body.outstanding));
    };
    const onChange = () => {
      void load();
      clearTimeout(timer);
      timer = setTimeout(() => void load(true), 5000);
    };
    window.addEventListener("sip:activity", onChange);
    return () => {
      window.removeEventListener("sip:activity", onChange);
      clearTimeout(timer);
    };
  }, [limit]);

  const owedTotal = data.owed.reduce((a, o) => a + Number(o.homeAmount ?? o.amount), 0);

  return (
    <section className="grid gap-10 border-t border-line pt-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14">
      <div>
        <h2 className="font-display text-xl font-bold">Recent</h2>
        <ul className="mt-3 divide-y divide-line">
          {data.activity.map((tx) => {
            const st = STATUS[tx.status] ?? STATUS.pending;
            return (
              <li key={tx.id} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0 truncate">
                  {tx.type === "pay" ? "You paid " : "You asked "}
                  <span className="font-bold">{tx.name}</span>
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
        {data.owed.length === 0 ? (
          <p className="mt-3 text-mist">Nobody owes you anything right now.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-mist">About {fmt(owedTotal, homeCurrency)} in open requests</p>
            <ul className="mt-3 divide-y divide-line">
              {data.owed.slice(0, 6).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0 truncate">
                    <span className="font-bold">{o.name}</span>
                    {o.label && <span className="text-mist"> for {o.label}</span>}
                  </span>
                  <span className="font-display text-lg font-semibold tabular-nums text-amber">{fmt(o.amount, o.currency)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
