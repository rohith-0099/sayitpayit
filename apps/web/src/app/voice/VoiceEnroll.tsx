"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRecorder } from "@/components/agent/useRecorder";

const SENTENCES = [
  "My voice is my password, and I use it to pay my friends and family.",
  "Please check that it's really me speaking, not a recording or a copy.",
  "Every payment waits for my yes, and Guardian listens before money moves.",
];

export function VoiceEnroll({ enrolled, enrolledAt }: { enrolled: boolean; enrolledAt: string | null }) {
  const router = useRouter();
  const [samples, setSamples] = useState<(Blob | null)[]>([null, null, null]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redo, setRedo] = useState(false);

  const rec = useRecorder((blob) => {
    setSamples((s) => s.map((x, i) => (i === active ? blob : x)));
    setActive((a) => Math.min(a + 1, SENTENCES.length - 1));
  });

  const done = samples.every(Boolean);

  const save = async () => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    samples.forEach((b, i) => b && form.append("samples", b, `sample${i + 1}.webm`));
    const r = await fetch("/api/voice", { method: "POST", body: form });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(body.error ?? "Couldn't save your Voice ID. Try again.");
    setRedo(false);
    router.refresh();
  };

  if (enrolled && !redo) {
    return (
      <section className="flex flex-col gap-4 rounded-3xl bg-signal/10 p-6 ring-1 ring-signal/40">
        <p className="font-display text-2xl font-bold text-signal">Voice ID is on</p>
        <p className="text-paper/90">
          Guardian checks your voice on every spoken payment, and asks you to say a fresh phrase before money leaves.
          {enrolledAt && <span className="text-mist"> Set up {new Date(enrolledAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.</span>}
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setRedo(true)} className="rounded-full px-5 py-2.5 ring-1 ring-line hover:ring-mist">
            Record again
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/voice", { method: "DELETE" });
              router.refresh();
            }}
            className="rounded-full px-5 py-2.5 text-mist hover:text-coral"
          >
            Delete Voice ID
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3">
        {SENTENCES.map((s, i) => {
          const isActive = i === active && !samples[i];
          return (
            <li
              key={s}
              className={`flex items-start gap-4 rounded-2xl p-4 ring-1 transition ${isActive ? "bg-panel ring-signal/60" : "ring-line"}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${samples[i] ? "border-signal bg-signal text-ink" : isActive ? "border-signal text-signal" : "border-line text-mist"}`}
              >
                {samples[i] ? "✓" : i + 1}
              </span>
              <p className={`font-display text-xl leading-snug ${isActive ? "text-paper" : samples[i] ? "text-paper/70" : "text-mist"}`}>{s}</p>
              {samples[i] && (
                <button
                  type="button"
                  onClick={() => {
                    setSamples((x) => x.map((b, j) => (j === i ? null : b)));
                    setActive(i);
                  }}
                  className="ml-auto shrink-0 text-sm text-mist hover:text-paper"
                >
                  Redo
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-5">
        {!done ? (
          <button
            type="button"
            onClick={() => (rec.recording ? rec.stop() : void rec.start())}
            aria-pressed={rec.recording}
            className="relative flex size-20 shrink-0 items-center justify-center rounded-full bg-signal text-ink"
          >
            <span aria-hidden className="absolute inset-0 rounded-full bg-signal/30" style={{ transform: `scale(${1 + rec.level * 0.7})` }} />
            <span className="relative font-bold">{rec.recording ? "Stop" : "Record"}</span>
          </button>
        ) : (
          <button type="button" onClick={save} disabled={busy} className="rounded-full bg-signal px-7 py-3 text-lg font-bold text-ink disabled:opacity-60">
            {busy ? "Saving…" : "Save my Voice ID"}
          </button>
        )}
        <p className="text-mist" aria-live="polite">
          {done ? "All three recorded." : rec.recording ? `Reading sentence ${active + 1}… I'll stop when you pause.` : `Tap Record and read sentence ${active + 1} in your normal voice.`}
        </p>
      </div>
      {(error || rec.error) && <p className="text-coral">{error ?? rec.error}</p>}
    </section>
  );
}
