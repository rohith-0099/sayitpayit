import "server-only";

/** Is the Guardian ML service reachable? (2 s budget; used for the lite-mode banner.) */
export async function guardianOnline(): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.GUARDIAN_URL ?? "http://localhost:8000"}/health`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
