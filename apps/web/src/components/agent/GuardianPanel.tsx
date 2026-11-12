"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import type { PublicView } from "@/lib/agent/run";

const TONE = {
  ALLOW: { color: "var(--color-signal)", text: "text-signal", chip: "bg-signal/15 text-signal", label: "Looks safe" },
  ASK_QUESTIONS: { color: "var(--color-amber)", text: "text-amber", chip: "bg-amber/15 text-amber", label: "Needs a closer look" },
  PASSKEY_REQUIRED: { color: "var(--color-amber)", text: "text-amber", chip: "bg-amber/15 text-amber", label: "Extra check needed" },
  GUARDIAN_HOLD: { color: "var(--color-amber)", text: "text-amber", chip: "bg-amber/15 text-amber", label: "Held for family approval" },
  BLOCK: { color: "var(--color-coral)", text: "text-coral", chip: "bg-coral/15 text-coral", label: "Stopped" },
} as const;

const Shield = ({ className = "size-5" }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 5 6v5c0 4.4 2.9 8.5 7 10 4.1-1.5 7-5.6 7-10V6l-7-3Z" />
  </svg>
);

/** Half-circle risk gauge, 0–100. The arc sweeps and the number counts up when a score arrives. */
function Gauge({ value, color }: { value: number; color: string }) {
  const n = useMotionValue(0);
  const shown = useTransform(n, (v) => Math.round(v));
  useEffect(() => {
    const c = animate(n, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [n, value]);
  const arc = "M10 62 A52 52 0 0 1 114 62";
  return (
    <svg viewBox="0 0 124 72" className="w-40 shrink-0" role="img" aria-label={`Risk ${value} out of 100`}>
      <path d={arc} fill="none" stroke="var(--color-line)" strokeWidth="9" strokeLinecap="round" />
      {/* quarter ticks */}
      {[0.25, 0.5, 0.75].map((t) => {
        const a = Math.PI * (1 - t);
        return <line key={t} x1={62 + 40 * Math.cos(a)} y1={62 - 40 * Math.sin(a)} x2={62 + 35 * Math.cos(a)} y2={62 - 35 * Math.sin(a)} stroke="var(--color-line)" strokeWidth="2" strokeLinecap="round" />;
      })}
      <motion.path
        d={arc}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: Math.max(0.015, value / 100) }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{ filter: `drop-shadow(0 0 6px color-mix(in oklab, ${color} 55%, transparent))` }}
      />
      <motion.text x="62" y="60" textAnchor="middle" className="fill-paper font-display text-[28px] font-bold tabular-nums">
        {shown}
      </motion.text>
    </svg>
  );
}

type Check = { key: string; tone: "ok" | "warn" | "bad" | "info"; text: React.ReactNode };

const DOT = { ok: "bg-signal", warn: "bg-amber", bad: "bg-coral", info: "bg-mist" } as const;

export function GuardianPanel({ guardian, voice }: { guardian: PublicView["guardian"]; voice: PublicView["voice"] }) {
  if (!guardian) {
    return (
      <section aria-label="Guardian" className="flex items-start gap-4 rounded-2xl bg-panel/60 p-5 ring-1 ring-line">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-mist">
          <Shield />
        </span>
        <div>
          <h2 className="font-display text-lg font-bold">Guardian</h2>
          <p className="mt-0.5 text-sm leading-snug text-mist">Checks your voice and the payment for scam signs before anything can be sent.</p>
        </div>
      </section>
    );
  }
  const tone = TONE[guardian.decision];
  const checks: Check[] = [];
  if (voice) {
    checks.push({
      key: "voice",
      tone: voice.status === "verified" ? "ok" : voice.status === "failed" ? "bad" : voice.status === "unsure" ? "warn" : "info",
      text: (
        <>
          {voice.detail}
          {typeof voice.speakerScore === "number" && <span className="text-mist"> (voice match {Math.round(voice.speakerScore * 100)}/100)</span>}
        </>
      ),
    });
  }
  if (voice?.answer) {
    checks.push({
      key: "answer",
      tone: voice.answer.phraseMatch ? "ok" : "warn",
      text: (
        <>
          Heard &ldquo;{voice.answer.heard}&rdquo;
          {typeof voice.answer.speakerScore === "number" && <span className="text-mist"> (voice match {Math.round(voice.answer.speakerScore * 100)}/100)</span>}
        </>
      ),
    });
  }
  for (const s of guardian.signals) checks.push({ key: s.id, tone: guardian.decision === "BLOCK" ? "bad" : "warn", text: s.label });

  return (
    <motion.section
      aria-label="Guardian"
      key={guardian.decision}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="rounded-2xl bg-panel/80 p-5 ring-1"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tone.color} 40%, transparent), 0 20px 50px -30px color-mix(in oklab, ${tone.color} 70%, transparent)` }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <span className={tone.text}>
            <Shield />
          </span>
          Guardian
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${tone.chip}`}>{tone.label}</span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Gauge value={Math.round(guardian.riskScore * 100)} color={tone.color} />
        <p className="text-[15px] leading-snug text-paper/90">{guardian.explanation}</p>
      </div>
      {checks.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
          {checks.map((c, i) => (
            <motion.li
              key={c.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.07, duration: 0.25 }}
              className="flex items-start gap-2.5"
            >
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[c.tone]}`} />
              <span className={c.tone === "bad" ? "text-coral" : c.tone === "warn" ? "text-amber" : "text-paper/90"}>{c.text}</span>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
