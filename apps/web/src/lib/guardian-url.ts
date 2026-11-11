/** Is a Guardian service configured? Empty GUARDIAN_URL = lite mode (e.g. the free hosted demo). */
export function guardianConfigured(): boolean {
  return !!(process.env.GUARDIAN_URL ?? "").trim();
}

/**
 * Base URL of the Guardian service. Accepts a full URL or a bare `host:port`.
 * Callers check guardianConfigured() first; the localhost default is only for local scripts.
 */
export function guardianBase(): string {
  const raw = (process.env.GUARDIAN_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost:8000";
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
}
