import type { Step, StepId } from "@/lib/agent/graph";

export type UiStep = Step | { status: "pending"; title?: string; detail?: string };

const ORDER: { id: StepId; label: string }[] = [
  { id: "listening", label: "Listening" },
  { id: "understood", label: "Understood" },
  { id: "guardian", label: "Guardian check" },
  { id: "confirm", label: "Confirm" },
  { id: "done", label: "Paid" },
];

const DOT: Record<UiStep["status"], string> = {
  pending: "border-line text-mist",
  active: "border-signal text-signal shadow-[0_0_0_6px_rgba(63,208,182,0.12)]",
  done: "border-signal bg-signal text-ink",
  warn: "border-amber bg-amber text-ink",
  error: "border-coral bg-coral text-ink",
  skipped: "border-dashed border-mist text-mist",
};

const TITLE: Record<UiStep["status"], string> = {
  pending: "text-mist",
  active: "text-paper",
  done: "text-paper",
  warn: "text-amber",
  error: "text-coral",
  skipped: "text-mist line-through decoration-1",
};

/** The agent's work as one vertical line: each step lights up when it actually completes. */
export function Stepper({ steps, doneLabel }: { steps: Partial<Record<StepId, UiStep>>; doneLabel: string }) {
  return (
    <ol className="relative flex flex-col" aria-label="What the agent is doing">
      {ORDER.map(({ id, label }, i) => {
        const s: UiStep = steps[id] ?? { status: "pending" };
        const next = ORDER[i + 1] && (steps[ORDER[i + 1].id]?.status ?? "pending");
        const lineLit = s.status === "done" && next && next !== "pending";
        return (
          <li key={id} className="relative flex gap-4 pb-7 last:pb-0" aria-current={s.status === "active" ? "step" : undefined}>
            {i < ORDER.length - 1 && (
              <span
                aria-hidden
                className={`absolute top-9 left-[17px] h-[calc(100%-2.25rem)] w-0.5 transition-colors duration-500 ${lineLit ? "bg-signal" : "bg-line"}`}
              />
            )}
            <span
              className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-300 ${DOT[s.status]} ${s.status === "active" ? "motion-safe:animate-pulse" : ""}`}
            >
              {s.status === "done" ? "✓" : s.status === "error" ? "✕" : s.status === "warn" ? "!" : i + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p className={`text-lg font-bold leading-tight ${TITLE[s.status]}`}>
                {id === "done" ? (s.status === "pending" ? doneLabel : (s.title ?? doneLabel)) : label}
              </p>
              {id !== "done" && s.title && s.status !== "pending" && <p className="mt-0.5 text-base text-paper/90">{s.title}</p>}
              {s.detail && s.status !== "pending" && <p className="mt-0.5 text-sm leading-snug text-mist">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
