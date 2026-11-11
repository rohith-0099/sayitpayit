import { createAiHarness, type AgAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi } from "ag-studio";
import { geminiAdapter } from "./gemini-adapter";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "What I sent Maria", prompt: "Show what I sent Maria this month as a new chart on this page." },
  { label: "What Guardian stopped", prompt: "Which payments did Guardian question, hold or stop, and why?" },
  { label: "Who owes me", prompt: "Who still owes me money, and for how long?" },
  { label: "Money abroad", prompt: "Add a chart of the money I sent abroad by country." },
];

/** Builds Studio's AI harness on Gemini and hands it back so the page can send voice questions to it. */
export function buildAi(onHarness: (h: AgAiHarness) => void): AgAiHarnessSetup {
  return ({ api }) => {
    // The setup params type the api more loosely than createAiHarness expects (same object at runtime).
    const harness = createAiHarness(api as unknown as AgStudioApi, { adapter: geminiAdapter, promptStarters: PROMPT_STARTERS });
    onHarness(harness);
    return harness;
  };
}
