// FX for display and home-currency totals. Live rates come from Frankfurter (free, no key,
// ECB reference rates); the static table is the offline fallback and what the seed uses.
// These are indicative rates for showing "Maria receives about €46.30", not PayPal's rate.

/** Approximate USD value of 1 unit of each currency (ECB rates, Nov 2026). */
export const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.12,
  GBP: 1.27,
  MXN: 0.054,
  JPY: 0.0063,
  INR: 0.012,
  CAD: 0.73,
  AUD: 0.66,
  BRL: 0.18,
};

export function fallbackRate(from: string, to: string): number {
  const f = FALLBACK_USD_RATES[from.toUpperCase()];
  const t = FALLBACK_USD_RATES[to.toUpperCase()];
  if (!f || !t) throw new Error(`No fallback FX rate for ${from}->${to}`);
  return f / t;
}

const cache = new Map<string, { rate: number; at: number }>();
const TTL = 6 * 60 * 60 * 1000;

/** Rate to convert 1 `from` into `to`. Never throws for supported currencies. */
export async function getRate(from: string, to: string): Promise<{ rate: number; live: boolean }> {
  from = from.toUpperCase();
  to = to.toUpperCase();
  if (from === to) return { rate: 1, live: true };
  const key = `${from}${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { rate: hit.rate, live: true };
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(`FX ${r.status}`);
    const rate = (await r.json()).rates?.[to];
    if (typeof rate !== "number") throw new Error("FX missing rate");
    cache.set(key, { rate, at: Date.now() });
    return { rate, live: true };
  } catch {
    return { rate: fallbackRate(from, to), live: false };
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
