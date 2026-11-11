import { guardianBase, guardianConfigured } from "@/lib/guardian-url";

/** Liveness for the web app (Render's health check) plus Guardian's state: ok | down | lite. */
export async function GET() {
  let guardian: "ok" | "down" | "lite" = "lite";
  if (guardianConfigured()) {
    guardian = "down";
    try {
      const r = await fetch(`${guardianBase()}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) guardian = "ok";
    } catch {
      // Guardian unreachable: report it, never fail the web health check.
    }
  }
  return Response.json({ status: "ok", service: "web", guardian });
}
