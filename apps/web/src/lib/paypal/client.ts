import "server-only";
import { PAYPAL_BASE_URL, requireEnv } from "../env";

export class PayPalError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public debugId?: string,
  ) {
    const b = body as { name?: string; message?: string; details?: { issue?: string; description?: string }[] };
    const detail = b?.details?.[0];
    super(
      `PayPal ${status} ${b?.name ?? ""}: ${detail?.description ?? b?.message ?? "request failed"}` +
        (detail?.issue ? ` [${detail.issue}]` : "") +
        (debugId ? ` (debug_id ${debugId})` : ""),
    );
    this.name = "PayPalError";
  }
  get issue(): string | undefined {
    return (this.body as { details?: { issue?: string }[] })?.details?.[0]?.issue;
  }
}

let cached: { token: string; expiresAt: number } | null = null;

/** OAuth2 client-credentials token, cached until 60s before expiry. */
export async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;
  const auth = Buffer.from(`${requireEnv("PAYPAL_CLIENT_ID")}:${requireEnv("PAYPAL_SECRET")}`).toString("base64");
  const r = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new PayPalError(r.status, body, r.headers.get("paypal-debug-id") ?? undefined);
  const { access_token, expires_in } = body as { access_token: string; expires_in: number };
  cached = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

export interface PayPalRequest {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Pre-serialised JSON body, sent byte-for-byte (used for webhook verification). */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Sent as PayPal-Request-Id so retries never double-pay. */
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Authenticated JSON call to the PayPal sandbox.
 * Retries once on 401 (stale token) and up to 3 times on 429/5xx with backoff.
 * POSTs are only retried when an idempotency key is set.
 */
export async function paypalFetch<T = unknown>(path: string, req: PayPalRequest = {}): Promise<T> {
  const url = new URL(path, PAYPAL_BASE_URL);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const method = req.method ?? "GET";
  const retrySafe = method === "GET" || !!req.idempotencyKey;

  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(refreshed);
    const r = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(req.idempotencyKey ? { "PayPal-Request-Id": req.idempotencyKey } : {}),
        ...req.headers,
      },
      body: req.rawBody ?? (req.body === undefined ? undefined : JSON.stringify(req.body)),
    });

    if (r.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && retrySafe && attempt < 3) {
      const retryAfter = Number(r.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }

    const text = await r.text();
    const body = text ? safeJson(text) : undefined;
    if (!r.ok) throw new PayPalError(r.status, body, r.headers.get("paypal-debug-id") ?? undefined);
    return body as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface Money {
  currency_code: string;
  value: string;
}

/** PayPal wants amounts as strings; JPY etc. have no decimals. */
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);
export function money(amount: number, currency: string): Money {
  const c = currency.toUpperCase();
  return { currency_code: c, value: amount.toFixed(ZERO_DECIMAL.has(c) ? 0 : 2) };
}
