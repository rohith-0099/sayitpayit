import "server-only";
import { guardianBase, guardianConfigured } from "./guardian-url";

/** Is the Guardian ML service reachable? (2 s budget; used for the lite-mode banner.) */
export async function guardianOnline(): Promise<boolean> {
  if (!guardianConfigured()) return false;
  try {
    const r = await fetch(`${guardianBase()}/health`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
