import type { Readback } from "@/lib/agent/graph";

export function ReadbackCard({
  readback,
  reask,
  note,
  busy,
  listening,
  onYes,
  onNo,
  onSayPhrase,
}: {
  readback: Readback;
  reask: boolean;
  note: string | null;
  busy: boolean;
  listening: boolean;
  onYes: () => void;
  onNo: () => void;
  onSayPhrase: () => void;
}) {
  const phrase = readback.challenge;
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
      {phrase && (
        <div className="mt-6 rounded-2xl bg-ink/60 p-5 ring-1 ring-signal/40">
          <p className="text-mist">To send it, say this out loud</p>
          <p className="mt-2 flex flex-wrap gap-2" aria-label={`Say: ${phrase}`}>
            {phrase.split(" ").map((w, i) => (
              <span key={i} className="rounded-xl bg-panel px-4 py-2 font-display text-3xl font-bold tracking-tight text-signal ring-1 ring-line">
                {w}
              </span>
            ))}
          </p>
          <p className="mt-3 text-sm text-mist">A new phrase every time, in your voice, so a recording can&apos;t pay.</p>
        </div>
      )}
      {note && (
        <p role="status" className="mt-4 rounded-xl bg-amber/10 px-4 py-2.5 text-amber ring-1 ring-amber/30">
          {note}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={phrase ? onSayPhrase : onYes}
          disabled={busy || (phrase ? listening : false)}
          className="rounded-full bg-signal px-7 py-3 text-lg font-bold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {phrase ? (listening ? "Listening…" : "Say the phrase") : "Yes, send it"}
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
          {phrase ? "" : listening ? "Listening for yes or no…" : reask ? "I need a clear yes or no." : "Or just say yes."}
        </p>
      </div>
    </section>
  );
}
