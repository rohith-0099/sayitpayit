/**
 * Base URL of the Guardian service. Accepts a full URL, or the bare `host:port` that Render's
 * private network gives (render.yaml wires GUARDIAN_URL from the Guardian service's hostport).
 */
export function guardianBase(): string {
  const raw = (process.env.GUARDIAN_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost:8000";
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
}
