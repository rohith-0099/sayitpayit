"use client";

import { motion } from "motion/react";

const enter = { initial: { opacity: 0, y: 24, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { type: "spring" as const, stiffness: 260, damping: 26 } };

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
    <motion.section {...enter} key={question.index} aria-label="Guardian question" className="relative overflow-hidden rounded-[28px] bg-panel p-6 ring-1 ring-amber/45 sm:p-8">
      <span aria-hidden className="absolute inset-x-8 top-0 h-px bg-amber shadow-[0_0_24px_2px_var(--color-amber)]" />
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-amber">Guardian has a quick question</p>
        <span className="flex items-center gap-1.5" aria-label={`Question ${question.index + 1} of ${question.total}`}>
          {Array.from({ length: question.total }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === question.index ? "w-6 bg-amber" : i < question.index ? "w-1.5 bg-amber/60" : "w-1.5 bg-line"}`} />
          ))}
        </span>
      </div>
      <p className="mt-4 font-display text-3xl leading-tight font-bold tracking-tight text-balance">{question.text}</p>
      <p className="mt-3 text-sm text-mist">Banks ask these too. There&apos;s no wrong answer; it helps spot scams.</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={() => onAnswer("Yes")} className="rounded-full bg-paper px-7 py-3 text-lg font-bold text-ink transition hover:bg-white disabled:opacity-50">
          Yes
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer("No")} className="rounded-full bg-paper px-7 py-3 text-lg font-bold text-ink transition hover:bg-white disabled:opacity-50">
          No
        </button>
        <button
          type="button"
          disabled={busy || listening}
          onClick={onAnswerByVoice}
          className="rounded-full bg-accent px-6 py-3 text-lg font-bold text-white transition hover:bg-accent-hi disabled:opacity-50"
        >
          {listening ? "Listening…" : "Answer in your words"}
        </button>
      </div>
    </motion.section>
  );
}

/** Guardian mode: paused until the trusted contact decides. */
export function HoldCard({ hold, busy, onCancel }: { hold: { contactName: string; url: string; reason: string }; busy: boolean; onCancel: () => void }) {
  return (
    <motion.section {...enter} aria-label="Payment on hold" className="relative overflow-hidden rounded-[28px] bg-panel p-6 ring-1 ring-coral/50 sm:p-8">
      <span aria-hidden className="absolute inset-x-8 top-0 h-px bg-coral shadow-[0_0_24px_2px_var(--color-coral)]" />
      <p className="flex items-center gap-2 font-bold text-coral">
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 5 6v5c0 4.4 2.9 8.5 7 10 4.1-1.5 7-5.6 7-10V6l-7-3Zm-2 6v6m4-6v6" />
        </svg>
        Paused to keep you safe
      </p>
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
        <a href={hold.url} target="_blank" rel="noreferrer" className="rounded-full bg-accent px-6 py-3 font-bold text-white transition hover:bg-accent-hi">
          Open {hold.contactName}&apos;s approval page
        </a>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-full px-6 py-3 ring-1 ring-line transition hover:ring-mist disabled:opacity-50">
          Cancel the payment
        </button>
      </div>
      <p className="mt-3 text-xs text-mist">Demo: in production {hold.contactName} gets this link by text message.</p>
    </motion.section>
  );
}
