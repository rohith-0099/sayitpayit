/** Liveness for the web app, plus a reachability check of the Guardian service. */
import { guardianBase } from "@/lib/guardian-url";
export async function GET() {
  const guardianUrl = guardianBase();
  let guardian: "ok" | "down" = "down";
  try {
    const r = await fetch(`${guardianUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) guardian = "ok";
  } catch {
    // Guardian unreachable; report it rather than failing the web health check.
  }
  return Response.json({ status: "ok", service: "web", guardian });
}
