import "server-only";

/** Read a required server env var, failing loudly with a helpful message. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example to apps/web/.env.local and fill it in.`);
  return v;
}

/** Hard rule: sandbox only. There is deliberately no switch to the live API. */
export const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";

export const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
