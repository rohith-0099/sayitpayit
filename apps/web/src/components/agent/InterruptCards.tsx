"use client";

/** Scam Interrupt: one bank-style question at a time. */
export function QuestionCard({
  question,
  busy,
  listening,
  onAnswer,
  onAnswerByVoice,
}: {
  question: { text: string; index: number; total: number };
  busy: boolean;
  listening: boolean;
  onAnswer: (a: string) => void;
  onAnswerByVoice: () => void;
}) {
  return (
    <section aria-label="Guardian question" className="rounded-3xl bg-panel p-6 ring-1 ring-amber/50 sm:p-8">
      <p className="flex items-center gap-3 text-amber">
        <span className="font-bold">Guardian has a quick question</span>
        <span className="text-sm text-mist">
          {question.index + 1} of {question.total}
        </span>
      </p>
      <p className="mt-4 font-display text-3xl leading-tight font-bold tracking-tight text-balance">{question.text}</p>
      <p className="mt-3 text-sm text-mist">Banks ask these too. There&apos;s no wrong answer; it helps spot scams.</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => onAnswer("Yes")} className="rounded-full bg-paper px-7 py-3 text-lg font-bold text-ink disabled:opacity-50">
          Yes
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer("No")} className="rounded-full bg-paper px-7 py-3 text-lg font-bold text-ink disabled:opacity-50">
          No
        </button>
        <button
          type="button"
          disabled={busy || listening}
          onClick={onAnswerByVoice}
          className="rounded-full px-6 py-3 text-lg ring-1 ring-line transition hover:ring-mist disabled:opacity-50"
        >
          {listening ? "Listening…" : "Answer in your words"}
        </button>
      </div>
    </section>
  );
}

/** Guardian mode: paused until the trusted contact decides. */
export function HoldCard({ hold, busy, onCancel }: { hold: { contactName: string; url: string; reason: string }; busy: boolean; onCancel: () => void }) {
  return (
    <section aria-label="Payment on hold" className="rounded-3xl bg-coral/10 p-6 ring-1 ring-coral/50 sm:p-8">
      <p className="font-bold text-coral">Paused to keep you safe</p>
      <p className="mt-3 font-display text-3xl leading-tight font-bold tracking-tight text-balance">{hold.reason}</p>
      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-ink/50 px-5 py-4 ring-1 ring-line">
        <span aria-hidden className="relative flex size-3">
          <span className="absolute inline-flex size-full rounded-full bg-amber opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-3 rounded-full bg-amber" />
        </span>
        <p aria-live="polite">
          I&apos;ve asked <span className="font-bold">{hold.contactName}</span> to check this payment. Nothing leaves your account unless they approve and you confirm.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a href={hold.url} target="_blank" rel="noreferrer" className="rounded-full bg-paper px-6 py-3 font-bold text-ink">
          Open {hold.contactName}&apos;s approval page
        </a>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-full px-6 py-3 ring-1 ring-line transition hover:ring-mist disabled:opacity-50">
          Cancel the payment
        </button>
      </div>
      <p className="mt-3 text-xs text-mist">Demo: in production {hold.contactName} gets this link by text message.</p>
    </section>
  );
}
