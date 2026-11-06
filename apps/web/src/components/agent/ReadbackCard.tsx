import type { Readback } from "@/lib/agent/graph";

export function ReadbackCard({
  readback,
  reask,
  busy,
  listening,
  onYes,
  onNo,
}: {
  readback: Readback;
  reask: boolean;
  busy: boolean;
  listening: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <section aria-label="Confirm payment" className="rounded-3xl bg-panel p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)] ring-1 ring-line sm:p-8">
      <h2 className="font-display text-3xl font-bold tracking-tight">{readback.title}</h2>
      <dl className="mt-5 flex flex-col divide-y divide-line">
        {readback.lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-6 py-2.5">
            <dt className="text-mist">{l.label}</dt>
            <dd className={l.emphasis ? "font-display text-2xl font-bold tabular-nums" : "text-lg tabular-nums"}>{l.value}</dd>
          </div>
        ))}
      </dl>
      {readback.notes.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 text-sm text-mist">
          {readback.notes.map((n) => (
            <li key={n} className={n.startsWith("Guardian") ? "text-amber" : undefined}>
              {n}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onYes}
          disabled={busy}
          className="rounded-full bg-signal px-7 py-3 text-lg font-bold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          Yes, send it
        </button>
        <button
          type="button"
          onClick={onNo}
          disabled={busy}
          className="rounded-full px-6 py-3 text-lg text-paper ring-1 ring-line transition hover:ring-mist disabled:opacity-50"
        >
          Cancel
        </button>
        <p className="text-sm text-mist" aria-live="polite">
          {listening ? "Listening for yes or no…" : reask ? "I need a clear yes or no." : "Or just say yes."}
        </p>
      </div>
    </section>
  );
}
