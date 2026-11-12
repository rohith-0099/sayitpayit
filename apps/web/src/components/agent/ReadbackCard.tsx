"use client";

import { motion } from "motion/react";
import type { Readback } from "@/lib/agent/graph";

const rise = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

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
    <motion.section
      aria-label="Confirm payment"
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="relative overflow-hidden rounded-[28px] bg-panel p-6 ring-1 ring-line shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)] sm:p-8"
    >
      {/* the card's one accent: a lit top edge, the colour of "the agent is asking you" */}
      <span aria-hidden className="absolute inset-x-8 top-0 h-px bg-accent shadow-[0_0_24px_2px_var(--color-accent)]" />

      <motion.div initial="hidden" animate="show" transition={{ staggerChildren: 0.06, delayChildren: 0.12 }}>
        <motion.h2 variants={rise} className="font-display text-3xl font-bold tracking-tight text-balance">
          {readback.title}
        </motion.h2>
        <dl className="mt-5 flex flex-col">
          {readback.lines.map((l) => (
            <motion.div
              key={l.label}
              variants={rise}
              className={`flex items-baseline justify-between gap-6 border-b border-line/70 last:border-0 ${l.emphasis ? "py-3.5" : "py-2.5"}`}
            >
              <dt className={l.emphasis ? "text-paper/90" : "text-mist"}>{l.label}</dt>
              <dd className={l.emphasis ? "font-display text-[28px] leading-none font-bold tracking-tight tabular-nums" : "text-lg text-paper/90 tabular-nums"}>{l.value}</dd>
            </motion.div>
          ))}
        </dl>
        {readback.notes.length > 0 && (
          <motion.ul variants={rise} className="mt-4 flex flex-col gap-1.5 text-sm leading-snug text-mist">
            {readback.notes.map((n) => (
              <li key={n} className={n.startsWith("Guardian") ? "text-amber" : undefined}>
                {n}
              </li>
            ))}
          </motion.ul>
        )}
      </motion.div>

      {phrase && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="mt-6 rounded-2xl bg-ink/70 p-5 ring-1 ring-accent/40"
        >
          <p className="text-paper/90">To send it, say this out loud</p>
          <p className="mt-3 flex flex-wrap gap-2" aria-label={`Say: ${phrase}`}>
            {phrase.split(" ").map((w, i) => (
              <motion.span
                key={`${w}-${i}`}
                initial={{ opacity: 0, y: 12, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.45 + i * 0.09, type: "spring", stiffness: 500, damping: 24 }}
                className="rounded-xl bg-raised px-4 py-2 font-display text-3xl font-bold tracking-tight text-accent-hi ring-1 ring-accent/30"
              >
                {w}
              </motion.span>
            ))}
          </p>
          <p className="mt-3 text-sm text-mist">A new phrase every time, in your voice, so a recording can&apos;t pay.</p>
        </motion.div>
      )}
      {note && (
        <motion.p
          key={note}
          role="status"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: [0, -4, 4, 0] }}
          transition={{ duration: 0.35 }}
          className="mt-4 rounded-xl bg-amber/10 px-4 py-2.5 text-amber ring-1 ring-amber/30"
        >
          {note}
        </motion.p>
      )}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={phrase ? onSayPhrase : onYes}
          disabled={busy || (phrase ? listening : false)}
          className="rounded-full bg-accent px-7 py-3 text-lg font-bold text-white shadow-[0_10px_30px_-10px_var(--color-accent)] transition hover:bg-accent-hi disabled:opacity-50"
        >
          {phrase ? (listening ? "Listening…" : "Say the phrase") : "Yes, send it"}
        </motion.button>
        <button
          type="button"
          onClick={onNo}
          disabled={busy}
          className="rounded-full px-6 py-3 text-lg text-paper ring-1 ring-line transition hover:bg-raised disabled:opacity-50"
        >
          Cancel
        </button>
        <p className="text-sm text-mist" aria-live="polite">
          {phrase ? "" : listening ? "Listening for yes or no…" : reask ? "I need a clear yes or no." : "Or just say yes."}
        </p>
      </div>
    </motion.section>
  );
}
