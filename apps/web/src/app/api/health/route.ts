/** Liveness for the web app, plus a reachability check of the Guardian service. */
export async function GET() {
  const guardianUrl = process.env.GUARDIAN_URL ?? "http://localhost:8000";
  let guardian: "ok" | "down" = "down";
  try {
    const r = await fetch(`${guardianUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) guardian = "ok";
  } catch {
    // Guardian unreachable; report it rather than failing the web health check.
  }
  return Response.json({ status: "ok", service: "web", guardian });
}
