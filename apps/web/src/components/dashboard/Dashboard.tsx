"use client";

// The money dashboard: one AG Studio instance with SayItPayIt's data, theme, custom widgets and a
// Gemini-backed Studio AI agent. "Ask by voice" sends a spoken question to that agent, which
// builds or changes widgets live through Studio's own tools.
import { AgStudioAiModule, type AgAiHarness, type AgStudioApi, type AgStudioMode, type AgWidgetsConfig } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DashboardData } from "@/lib/dashboard-data";
import { transcribeAudio } from "@/components/agent/client";
import { useRecorder } from "@/components/agent/useRecorder";
import { buildAi } from "./ai";
import { initialReport, PAGE_TITLES } from "./initial-report";
import { buildStudioData } from "./studio-data";
import { sayItPayItTheme } from "./theme";
import { CUSTOM_WIDGETS } from "./widgets";

const noSub = () => () => {};

export function Dashboard(props: { data: DashboardData; licenseKey?: string }) {
  const inBrowser = useSyncExternalStore(noSub, () => true, () => false);
  return inBrowser ? <Studio {...props} /> : <p className="p-10 text-mist">Loading your dashboard…</p>;
}

function Studio({ data, licenseKey }: { data: DashboardData; licenseKey?: string }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  // Filled in by Studio when it creates the AI harness; read when the user asks something.
  const [holder] = useState<{ harness: AgAiHarness | null }>(() => ({ harness: null }));
  const [page, setPage] = useState("money");
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [asked, setAsked] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const studioData = useMemo(() => buildStudioData(data), [data]);
  // Built once; Studio reads `ai` when it is created. The callback runs later, inside Studio.
  const [ai] = useState(() =>
    buildAi((h) => {
      holder.harness = h;
    }),
  );
  const widgets = useMemo(
    () => (config: AgWidgetsConfig) =>
      createWidgets({
        additionalTypes: CUSTOM_WIDGETS as never,
        menu: [{ label: "SayItPayIt", widgetIds: CUSTOM_WIDGETS.map((w) => w.id) as never }, ...config.menu],
      } as never),
    [],
  );

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    setAsked(q);
    // Studio's AI panel (and with it the agent) lives in edit mode: open it so the agent's work shows.
    if (mode !== "edit") setMode("edit");
    for (let i = 0; i < 40 && !holder.harness?.agents[0]; i++) await new Promise((r) => setTimeout(r, 150));
    const harness = holder.harness;
    const agentId = harness?.agents[0]?.id;
    if (!harness || !agentId) return setStatus("The AI agent isn't ready yet. Try again in a moment.");
    setStatus("Studio's agent is working on it…");
    try {
      const session = await harness.createThread({ agentId, title: q.slice(0, 60) });
      let started = false;
      const done = () => {
        if (session.status === "running" || session.status === "awaiting_input") started = true;
        if (started && (session.status === "idle" || session.status === "error")) {
          setStatus(session.status === "error" ? "The agent couldn't finish that. Try rephrasing." : "Done. The agent's steps are in the AI panel on the right.");
          session.removeEventListener("changed", done);
        }
      };
      session.addEventListener("changed", done);
      session.sendMessage(q);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't reach the agent.");
    }
  };

  const recorder = useRecorder(async (blob) => {
    setStatus("Listening done, writing it down…");
    try {
      const t = await transcribeAudio(blob, "auto");
      await ask(t.text);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't hear that.");
    }
  });

  const goTo = (id: string) => {
    setPage(id);
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-6 py-4">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          SayItPayIt
        </Link>
        <nav className="flex gap-1" aria-label="Dashboard pages">
          {Object.entries(PAGE_TITLES).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => goTo(id)}
              aria-current={page === id ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm ${page === id ? "bg-signal/15 text-signal" : "text-mist hover:text-paper"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <form
          className="ml-auto flex min-w-0 flex-1 items-center gap-2 sm:max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(typed);
            setTyped("");
          }}
        >
          <button
            type="button"
            onClick={() => (recorder.recording ? recorder.stop() : void recorder.start())}
            aria-pressed={recorder.recording}
            className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-signal text-ink"
            aria-label={recorder.recording ? "Stop listening" : "Ask the dashboard by voice"}
          >
            <span aria-hidden className="absolute inset-0 rounded-full bg-signal/30" style={{ transform: `scale(${1 + recorder.level * 0.7})` }} />
            <svg aria-hidden viewBox="0 0 24 24" className="relative size-5" fill="currentColor">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
            </svg>
          </button>
          <label htmlFor="ask" className="sr-only">
            Ask about your money
          </label>
          <input
            id="ask"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ask: show what I sent Maria this month"
            className="min-w-0 flex-1 rounded-full bg-panel px-4 py-2.5 text-sm ring-1 ring-line placeholder:text-mist/70 focus:ring-signal focus:outline-none"
          />
        </form>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
          className={`rounded-full px-4 py-2 text-sm ring-1 ${mode === "edit" ? "bg-paper text-ink ring-paper" : "ring-line hover:ring-mist"}`}
        >
          {mode === "edit" ? "Done editing" : "Edit"}
        </button>
      </header>
      {(asked || status) && (
        <p className="border-b border-line px-6 py-2 text-sm" aria-live="polite">
          {asked && <span className="font-display text-base font-semibold">&ldquo;{asked}&rdquo;</span>}
          {status && <span className="ml-3 text-mist">{status}</span>}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={[AgStudioAiModule]}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={sayItPayItTheme}
            layout={{ widgetBorderEnabled: true }}
            data={studioData}
            widgets={widgets as never}
            ai={ai}
            initialState={initialReport}
            mode={mode}
            panels={{ edit: { right: ["ai", "edit", "data"], left: ["filters"] }, view: { right: ["filters"] } }}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi;
            }}
            onStateUpdated={(e) => {
              const id = (e.state as { selectedPageId?: string }).selectedPageId;
              if (id && id !== page) setPage(id);
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
