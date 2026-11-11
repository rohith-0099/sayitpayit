"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Readback, StepId } from "@/lib/agent/graph";
import type { AgentEvent, PublicView } from "@/lib/agent/run";
import { fileToDataUrl, postStream, speak, stopSpeaking, transcribeAudio } from "./client";
import { GuardianPanel } from "./GuardianPanel";
import { HoldCard, QuestionCard } from "./InterruptCards";
import { ReadbackCard } from "./ReadbackCard";
import { Stepper, type UiStep } from "./Stepper";
import { useRecorder } from "./useRecorder";

type Phase = "idle" | "recording" | "transcribing" | "thinking" | "confirm" | "question" | "hold" | "answering" | "final";
type Waiting = "confirm" | "question" | "hold";
type Steps = Partial<Record<StepId, UiStep>>;

const LANGS = [
  { id: "auto", label: "Any language" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "ml", label: "മലയാളം" },
  { id: "hi", label: "हिन्दी" },
  { id: "de", label: "Deutsch" },
];

const EXAMPLES = ["Pay Maria 50 euros for the logo", "Ask John for 200 dollars for the website", "Págale a María 30 euros por el logo"];

export function VoiceAgent({ linked }: { linked: boolean }) {
  const router = useRouter();
  const [lang, setLang] = useState("auto");
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [steps, setSteps] = useState<Steps>({});
  const [view, setView] = useState<PublicView | null>(null);
  const [readback, setReadback] = useState<{ readback: Readback; reask: boolean; note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [question, setQuestion] = useState<{ text: string; index: number; total: number } | null>(null);
  const [holdInfo, setHoldInfo] = useState<{ contactName: string; url: string; reason: string } | null>(null);
  /** What the agent is waiting on, so errors can return there. */
  const waiting = useRef<Waiting>("confirm");
  const thread = useRef<string | null>(null);
  const mode = useRef<"command" | "answer">("command");
  const spokenCommand = useRef(false);
  /** Set once the recorder exists; lets the confirm step start listening hands-free. */
  const listenForAnswer = useRef<() => void>(() => {});

  useEffect(() => {
    const saved = localStorage.getItem("sip-lang");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved preference once on mount
    if (saved) setLang(saved);
  }, []);

  const onEvent = useCallback(
    (e: AgentEvent) => {
      if (e.type === "thread") thread.current = e.threadId;
      else if (e.type === "update") setSteps((s) => ({ ...s, ...e.steps }));
      else if (e.type === "question") {
        waiting.current = "question";
        setView(e.view);
        setSteps(e.view.steps);
        setReadback(null);
        setHoldInfo(null);
        setQuestion({ text: e.question, index: e.index, total: e.total });
        setPhase("question");
        void speak(e.question, e.view.language).then(() => {
          if (spokenCommand.current) {
            mode.current = "answer";
            listenForAnswer.current();
          }
        });
      } else if (e.type === "hold") {
        waiting.current = "hold";
        setView(e.view);
        setSteps(e.view.steps);
        setQuestion(null);
        setHoldInfo({ contactName: e.contactName, url: e.url, reason: e.reason });
        setPhase("hold");
        void speak(e.reason, e.view.language);
      } else if (e.type === "confirm") {
        waiting.current = "confirm";
        setView(e.view);
        setSteps(e.view.steps);
        setQuestion(null);
        setHoldInfo(null);
        setReadback({ readback: e.readback, reask: e.reask, note: e.note });
        setPhase("confirm");
        void speak(e.note ?? e.readback.spoken, e.view.language).then(() => {
          // Hands-free: after a spoken command, listen for the yes/no right away.
          if (spokenCommand.current) {
            mode.current = "answer";
            listenForAnswer.current();
          }
        });
      } else if (e.type === "final") {
        setView(e.view);
        setSteps(e.view.steps);
        setReadback(null);
        setQuestion(null);
        setHoldInfo(null);
        setPhase("final");
        if (e.view.reply) void speak(e.view.reply.text, e.view.language);
        router.refresh(); // activity list below
      } else if (e.type === "error") {
        setError(e.message);
        setPhase(thread.current ? waiting.current : "idle");
      }
    },
    [router],
  );

  const runCommand = useCallback(
    async (text: string, source: "voice" | "text", language: string | null, voiceCheckId: string | null = null) => {
      setError(null);
      setView(null);
      setReadback(null);
      setQuestion(null);
      setHoldInfo(null);
      thread.current = null;
      setTranscript(text || "Split this receipt");
      setSteps({ listening: { status: "done", title: source === "voice" ? "Heard you" : "Typed" }, understood: { status: "active" } });
      setPhase("thinking");
      try {
        await postStream("/api/agent", { text, source, language, image: receipt, voiceCheckId }, onEvent);
        setReceipt(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setSteps((s) => ({ ...s, understood: { status: "error", title: "Didn't go through" } }));
        setPhase("idle");
      }
    },
    [onEvent, receipt],
  );

  const answer = useCallback(
    async (text: string, voiceCheckId: string | null = null) => {
      if (!thread.current) return;
      setError(null);
      setPhase("answering");
      try {
        await postStream(`/api/agent/${thread.current}`, { answer: text, voiceCheckId }, onEvent);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setPhase(waiting.current);
      }
    },
    [onEvent],
  );

  const recorder = useRecorder(async (blob) => {
    const isAnswer = mode.current === "answer";
    setPhase(isAnswer ? "answering" : "transcribing");
    if (!isAnswer) setSteps({ listening: { status: "active", title: "Transcribing…" } });
    try {
      const t = await transcribeAudio(blob, lang, { kind: isAnswer ? "answer" : "command", threadId: isAnswer ? thread.current : null });
      if (isAnswer) {
        await answer(t.text || "unclear", t.voice?.checkId ?? null);
      } else {
        if (!t.text) throw new Error("I didn't catch that. Tap the mic and try again.");
        spokenCommand.current = true;
        await runCommand(t.text, "voice", t.language, t.voice?.checkId ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't hear that.");
      setPhase(isAnswer ? waiting.current : "idle");
      if (!isAnswer) setSteps({});
    }
  });

  const startRecorder = recorder.start;
  useEffect(() => {
    listenForAnswer.current = () => void startRecorder();
  }, [startRecorder]);

  // While on hold, check for the family member's decision every 2 seconds.
  useEffect(() => {
    if (phase !== "hold" || !thread.current) return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/agent/${thread.current}`, { cache: "no-store" }).catch(() => null);
      const e = r?.ok ? ((await r.json()) as AgentEvent) : null;
      if (e && e.type !== "hold") onEvent(e);
    }, 2000);
    return () => clearInterval(id);
  }, [phase, onEvent]);

  const isWaiting = phase === "confirm" || phase === "question" || phase === "hold";
  const micBusy = phase === "transcribing" || phase === "thinking" || phase === "answering";
  const toggleMic = () => {
    if (recorder.recording) return recorder.stop();
    stopSpeaking();
    mode.current = phase === "confirm" || phase === "question" || phase === "hold" ? "answer" : "command";
    if (mode.current === "command") {
      setTranscript("");
      setView(null);
      setReadback(null);
      setSteps({ listening: { status: "active", title: "Speak now" } });
    }
    void recorder.start();
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed.trim() && !receipt) return;
    spokenCommand.current = false;
    const text = typed.trim();
    setTyped("");
    if (isWaiting) void answer(text);
    else void runCommand(text, "text", null);
  };

  const doneLabel = view?.intent?.kind === "request" ? "Requested" : view?.intent?.kind === "split" ? "Invoices sent" : "Paid";
  const result = view?.result;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14">
      {/* The conversation */}
      <div className="flex min-w-0 flex-col gap-8">
        <div className="min-h-[9rem]" aria-live="polite" data-testid="transcript">
          {transcript ? (
            <p className="font-display text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">&ldquo;{transcript}&rdquo;</p>
          ) : (
            <div>
              <p className="font-display text-4xl leading-[1.1] font-semibold tracking-tight text-paper/40 sm:text-5xl">Say who to pay, and how much.</p>
              <p className="mt-4 text-mist">
                For example: {EXAMPLES.map((x, i) => (
                  <button key={x} type="button" onClick={() => setTyped(x)} className="text-paper/80 underline decoration-line underline-offset-4 hover:decoration-mist">
                    {x}
                    {i < EXAMPLES.length - 1 ? "," : ""}
                  </button>
                )).reduce<React.ReactNode[]>((a, b) => [...a, " ", b], [])}
              </p>
            </div>
          )}
        </div>

        {question && phase !== "final" && (
          <QuestionCard
            question={question}
            busy={phase === "answering"}
            listening={recorder.recording && phase === "question"}
            onAnswerByVoice={() => {
              stopSpeaking();
              mode.current = "answer";
              void recorder.start();
            }}
            onAnswer={(a) => {
              recorder.cancel();
              void answer(a);
            }}
          />
        )}

        {holdInfo && phase !== "final" && (
          <HoldCard
            hold={holdInfo}
            busy={phase === "answering"}
            onCancel={() => {
              recorder.cancel();
              void answer("cancel");
            }}
          />
        )}

        {readback && phase !== "final" && (
          <ReadbackCard
            readback={readback.readback}
            reask={readback.reask}
            note={readback.note}
            onSayPhrase={() => {
              stopSpeaking();
              mode.current = "answer";
              void recorder.start();
            }}
            busy={phase === "answering"}
            listening={recorder.recording && phase === "confirm"}
            onYes={() => {
              recorder.cancel();
              mode.current = "command";
              void answer("yes");
            }}
            onNo={() => {
              recorder.cancel();
              mode.current = "command";
              void answer("no");
            }}
          />
        )}

        {phase === "final" && view?.reply && (
          <section
            aria-label="Result"
            className={`rounded-3xl p-6 ring-1 sm:p-8 ${view.outcome === "done" ? "bg-signal/10 ring-signal/40" : view.outcome === "blocked" ? "bg-coral/10 ring-coral/50" : "ring-line"}`}
          >
            <p className={`font-display text-3xl font-bold ${view.outcome === "done" ? "text-signal" : view.outcome === "blocked" ? "text-coral" : "text-paper"}`}>
              {view.reply.text}
            </p>
            {result?.qr && (
              <div className="mt-5 flex items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL from PayPal */}
                <img src={result.qr} alt="QR code to pay this invoice" className="size-36 rounded-xl bg-white p-2" />
                {result.payUrl && (
                  <a href={result.payUrl} target="_blank" rel="noreferrer" className="text-lg text-signal underline underline-offset-4">
                    Open the PayPal invoice
                  </a>
                )}
              </div>
            )}
          </section>
        )}

        {error && (
          <p role="alert" className="rounded-2xl bg-coral/10 px-5 py-3 text-coral ring-1 ring-coral/40">
            {error}
          </p>
        )}
        {!linked && (
          <p className="rounded-2xl bg-amber/10 px-5 py-3 text-amber ring-1 ring-amber/30">
            Link your PayPal before sending money. <a href="/link" className="underline underline-offset-4">Link PayPal</a>
          </p>
        )}

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={toggleMic}
            disabled={micBusy}
            aria-pressed={recorder.recording}
            aria-label={recorder.recording ? "Stop listening" : phase === "confirm" ? "Answer by voice" : "Speak a payment"}
            className="relative flex size-24 shrink-0 items-center justify-center rounded-full bg-signal text-ink transition hover:brightness-110 disabled:opacity-60"
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-signal/30 transition-transform duration-75"
              style={{ transform: `scale(${1 + recorder.level * 0.7})` }}
            />
            {micBusy ? (
              <span className="relative size-8 animate-spin rounded-full border-4 border-ink/30 border-t-ink" />
            ) : recorder.recording ? (
              <span className="relative size-7 rounded-md bg-ink" />
            ) : (
              <svg aria-hidden viewBox="0 0 24 24" className="relative size-10" fill="currentColor">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
              </svg>
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-mist" aria-live="polite">
              {recorder.recording
                ? "Listening… I'll stop when you pause."
                : phase === "transcribing"
                  ? "Got it, writing that down…"
                  : phase === "thinking" || phase === "answering"
                    ? "Working on it…"
                    : phase === "confirm"
                      ? "Tap the mic to answer by voice"
                      : "Tap the mic and speak, or type below"}
            </p>
            <form onSubmit={submitTyped} className="flex gap-2">
              <label className="sr-only" htmlFor="typed">
                {phase === "confirm" ? "Type yes or no" : "Type a payment"}
              </label>
              <input
                id="typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={phase === "confirm" ? "Type yes or no" : phase === "question" ? "Type your answer" : phase === "hold" ? "Type cancel to stop it" : receipt ? "Split with John and Maria" : "Or type it here"}
                className="min-w-0 flex-1 rounded-full bg-panel px-5 py-3 text-paper ring-1 ring-line placeholder:text-mist/70 focus:ring-signal focus:outline-none"
              />
              <label className={`cursor-pointer rounded-full px-4 py-3 ring-1 transition ${receipt ? "text-signal ring-signal" : "text-mist ring-line hover:ring-mist"}`}>
                <span className="sr-only">Attach a receipt photo</span>
                <span aria-hidden>{receipt ? "Receipt ✓" : "Receipt"}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setReceipt(await fileToDataUrl(f));
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="submit" disabled={micBusy} className="rounded-full bg-paper px-5 py-3 font-bold text-ink disabled:opacity-50">
                Send
              </button>
            </form>
            <p className="flex items-center gap-2 pl-1 text-sm text-mist">
              <label htmlFor="lang">Speaking</label>
              <select
                id="lang"
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value);
                  localStorage.setItem("sip-lang", e.target.value);
                }}
                className="rounded-md bg-transparent py-0.5 text-paper ring-1 ring-line"
              >
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id} className="bg-panel">
                    {l.label}
                  </option>
                ))}
              </select>
            </p>
          </div>
        </div>
        {recorder.error && <p className="text-sm text-coral">{recorder.error}</p>}
      </div>

      {/* The agent */}
      <aside className="flex flex-col gap-6" aria-label="Agent">
        <Stepper steps={steps} doneLabel={doneLabel} />
        <GuardianPanel guardian={view?.guardian ?? null} voice={view?.voice ?? null} />
      </aside>
    </div>
  );
}
