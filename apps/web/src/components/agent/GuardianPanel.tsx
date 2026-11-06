import type { PublicView } from "@/lib/agent/run";

const TONE = {
  ALLOW: { color: "var(--color-signal)", label: "Looks safe" },
  ASK_QUESTIONS: { color: "var(--color-amber)", label: "Needs a closer look" },
  PASSKEY_REQUIRED: { color: "var(--color-amber)", label: "Extra check needed" },
  GUARDIAN_HOLD: { color: "var(--color-amber)", label: "Held for family approval" },
  BLOCK: { color: "var(--color-coral)", label: "Stopped" },
} as const;

/** Half-circle risk gauge, 0–100. */
function Gauge({ value, color }: { value: number; color: string }) {
  const r = 52;
  const len = Math.PI * r;
  return (
    <svg viewBox="0 0 120 68" className="w-36" role="img" aria-label={`Risk ${value} out of 100`}>
      <path d={`M8 60 A${r} ${r} 0 0 1 112 60`} fill="none" stroke="var(--color-line)" strokeWidth="10" strokeLinecap="round" />
      <path
        d={`M8 60 A${r} ${r} 0 0 1 112 60`}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - Math.max(0.02, value / 100))}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
      <text x="60" y="58" textAnchor="middle" className="fill-paper font-display text-[26px] font-bold">
        {value}
      </text>
    </svg>
  );
}

export function GuardianPanel({ guardian, voice }: { guardian: PublicView["guardian"]; voice: PublicView["voice"] }) {
  if (!guardian) {
    return (
      <section aria-label="Guardian" className="rounded-2xl border border-line p-5">
        <h2 className="font-display text-xl font-bold">Guardian</h2>
        <p className="mt-1 text-sm text-mist">Checks your voice and the payment for scam signs before anything can be sent.</p>
      </section>
    );
  }
  const tone = TONE[guardian.decision];
  return (
    <section aria-label="Guardian" className="rounded-2xl border border-line p-5" style={{ borderColor: `color-mix(in oklab, ${tone.color} 45%, transparent)` }}>
      <div className="flex items-center gap-5">
        <Gauge value={Math.round(guardian.riskScore * 100)} color={tone.color} />
        <div>
          <h2 className="font-display text-xl font-bold">Guardian</h2>
          <p className="text-lg font-bold" style={{ color: tone.color }}>
            {tone.label}
          </p>
          <p className="text-sm text-mist">Risk score out of 100</p>
        </div>
      </div>
      <p className="mt-3 text-base leading-snug">{guardian.explanation}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {voice && (
          <li className={voice.status === "verified" ? "text-signal" : voice.status === "failed" ? "text-coral" : voice.status === "unsure" ? "text-amber" : "text-mist"}>
            {voice.status === "verified" ? "✓" : voice.status === "failed" ? "✕" : voice.status === "unsure" ? "!" : "○"} {voice.detail}
            {typeof voice.speakerScore === "number" && <span className="text-mist"> (voice match {Math.round(voice.speakerScore * 100)}/100)</span>}
          </li>
        )}
        {voice?.answer && (
          <li className={voice.answer.phraseMatch ? "text-signal" : "text-amber"}>
            {voice.answer.phraseMatch ? "✓" : "!"} Heard &ldquo;{voice.answer.heard}&rdquo;
            {typeof voice.answer.speakerScore === "number" && <span className="text-mist"> (voice match {Math.round(voice.answer.speakerScore * 100)}/100)</span>}
          </li>
        )}
        {guardian.signals.map((s) => (
          <li key={s.id} className="text-amber">
            ! {s.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
