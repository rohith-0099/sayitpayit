"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Step, StepId } from "@/lib/agent/graph";

export type UiStep = Step | { status: "pending"; title?: string; detail?: string };
type Status = UiStep["status"];

const ORDER: { id: StepId; label: string }[] = [
  { id: "listening", label: "Listening" },
  { id: "understood", label: "Understood" },
  { id: "guardian", label: "Guardian check" },
  { id: "confirm", label: "Confirm" },
  { id: "done", label: "Paid" },
];

// Line icons, 24px grid, drawn for this flow (one per node).
const ICON: Record<StepId, React.ReactNode> = {
  listening: <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0m6 6v3" />,
  understood: <path d="M4 6h16M4 12h10M4 18h7m8-4 1.2 2.6L23 18l-2.8 1.4L19 22l-1.2-2.6L15 18l2.8-1.4Z" />,
  guardian: <path d="M12 3 5 6v5c0 4.4 2.9 8.5 7 10 4.1-1.5 7-5.6 7-10V6l-7-3Zm-3 9 2 2 4-4" />,
  confirm: <path d="M7 11V7a2 2 0 1 1 4 0v4m0-1V5a2 2 0 1 1 4 0v6m0-3a2 2 0 1 1 4 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.5 13a1.8 1.8 0 0 1 3-2L7 12" />,
  done: <path d="m4 12 16-8-5 17-3.5-7.5L4 12Zm7.5 1.5L20 4" />,
};

/** Which colour a finished step earns: teal is reserved for "safe" and "paid". */
function tone(id: StepId, s: Status) {
  if (s === "error") return "coral";
  if (s === "warn") return "amber";
  if (s === "done" && (id === "guardian" || id === "done")) return "signal";
  if (s === "done" || s === "active") return "accent";
  return "idle";
}

const TILE: Record<string, string> = {
  accent: "bg-accent text-white",
  signal: "bg-signal text-ink",
  amber: "bg-amber text-ink",
  coral: "bg-coral text-ink",
  idle: "bg-raised text-mist",
};
const RING: Record<string, string> = {
  accent: "ring-accent/50",
  signal: "ring-signal/45",
  amber: "ring-amber/55",
  coral: "ring-coral/60",
  idle: "ring-line",
};
const PILL: Record<Status, string> = {
  pending: "Waiting",
  active: "Working",
  done: "Done",
  warn: "Check",
  error: "Stopped",
  skipped: "Skipped",
};
const STROKE: Record<string, string> = {
  accent: "var(--color-accent)",
  signal: "var(--color-signal)",
  amber: "var(--color-amber)",
  coral: "var(--color-coral)",
  idle: "var(--color-line)",
};

/** The wire between two nodes. Flows while the next step works; a packet runs down it when it lights. */
function Wire({ from, to, color }: { from: Status; to: Status; color: string }) {
  const lit = from !== "pending" && to !== "pending" && from !== "skipped";
  const flowing = to === "active";
  return (
    <div aria-hidden className="relative ml-[27px] h-7 w-4">
      <svg viewBox="0 0 16 28" className="absolute inset-0 h-full w-full overflow-visible">
        <line x1="8" y1="0" x2="8" y2="28" stroke="var(--color-line)" strokeWidth="2" strokeDasharray="3 5" />
        {lit && (
          <motion.line
            x1="8"
            y1="0"
            x2="8"
            y2="28"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={flowing ? "6 4" : undefined}
            className={flowing ? "wire-flow" : undefined}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        )}
        <AnimatePresence>
          {lit && (
            <motion.circle
              key={`${from}-${to}`}
              cx="8"
              r="3.5"
              fill={color}
              initial={{ cy: 0, opacity: 1 }}
              animate={{ cy: 28, opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeIn" }}
            />
          )}
        </AnimatePresence>
      </svg>
    </div>
  );
}

/**
 * The agent's work as a node flow (n8n-style): one node per step, wired top to bottom.
 * Each node lights up only when that step actually reports back from the server.
 */
export function Stepper({ steps, doneLabel }: { steps: Partial<Record<StepId, UiStep>>; doneLabel: string }) {
  return (
    // A node-editor canvas: faint dot grid, the flow sits on it.
    <ol
      className="flex flex-col rounded-3xl p-4 ring-1 ring-line/70 [background-image:radial-gradient(color-mix(in_oklab,var(--color-mist)_22%,transparent)_1px,transparent_1px)] [background-size:18px_18px]"
      aria-label="What the agent is doing"
    >
      {ORDER.map(({ id, label }, i) => {
        const s: UiStep = steps[id] ?? { status: "pending" };
        const t = tone(id, s.status);
        const next = ORDER[i + 1];
        const nextStatus: Status = next ? (steps[next.id]?.status ?? "pending") : "pending";
        const name = id === "done" ? (s.status === "pending" ? doneLabel : (s.title ?? doneLabel)) : label;
        const quiet = s.status === "pending" || s.status === "skipped";
        return (
          <li key={id} aria-current={s.status === "active" ? "step" : undefined}>
            <motion.div
              layout
              animate={{ opacity: quiet ? 0.55 : 1 }}
              transition={{ layout: { type: "spring", stiffness: 380, damping: 34 }, opacity: { duration: 0.3 } }}
              className={`relative flex items-start gap-4 rounded-2xl bg-panel/80 p-3.5 ring-1 backdrop-blur-sm transition-shadow duration-500 ${RING[t]} ${
                s.status === "active" ? "shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-accent)_14%,transparent),0_12px_32px_-12px_color-mix(in_oklab,var(--color-accent)_60%,transparent)]" : ""
              }`}
            >
              {/* input / output ports, like a node editor */}
              {i > 0 && <span aria-hidden className={`absolute -top-1 left-[31px] size-2 rounded-full ring-2 ring-ink ${quiet ? "bg-line" : "bg-paper/70"}`} />}
              {next && <span aria-hidden className={`absolute -bottom-1 left-[31px] size-2 rounded-full ring-2 ring-ink ${quiet ? "bg-line" : "bg-paper/70"}`} />}

              <motion.span
                key={`${id}-${s.status}`}
                initial={s.status === "pending" ? false : { scale: 0.6, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }}
                className={`relative flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors duration-300 ${TILE[t]}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {ICON[id]}
                </svg>
                {s.status === "active" && <span aria-hidden className="absolute inset-0 rounded-xl ring-2 ring-accent motion-safe:animate-ping" />}
              </motion.span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className={`font-display text-lg leading-tight font-bold ${s.status === "skipped" ? "text-mist line-through decoration-1" : "text-paper"}`}>{name}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      t === "idle" ? "text-mist" : t === "accent" ? "bg-accent/15 text-accent-hi" : t === "signal" ? "bg-signal/15 text-signal" : t === "amber" ? "bg-amber/15 text-amber" : "bg-coral/15 text-coral"
                    }`}
                  >
                    {PILL[s.status]}
                  </span>
                </div>
                <AnimatePresence initial={false}>
                  {s.status !== "pending" && (s.title || s.detail) && (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      {id !== "done" && s.title && <p className="mt-1 text-[15px] text-paper/90">{s.title}</p>}
                      {s.detail && <p className="mt-0.5 text-sm leading-snug text-mist">{s.detail}</p>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
            {next && <Wire from={s.status} to={nextStatus} color={STROKE[tone(next.id, nextStatus === "pending" ? "active" : nextStatus)]} />}
          </li>
        );
      })}
    </ol>
  );
}
