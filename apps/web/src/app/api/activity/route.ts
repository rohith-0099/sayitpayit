import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { listTransactions } from "@/lib/paypal";
import { listActivity, syncPendingPayouts } from "@/lib/payments/service";

/**
 * GET /api/activity            → our transactions (newest first)
 * GET /api/activity?sync=1     → refresh in-flight payouts from PayPal first
 * GET /api/activity?source=paypal → raw PayPal Transaction Search (last 30 days)
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    if (q.get("source") === "paypal") return { source: "paypal", transactions: await listTransactions() };
    const synced = q.get("sync") === "1" ? await syncPendingPayouts() : 0;
    const limit = Math.min(Number(q.get("limit")) || 50, 200);
    return { source: "db", synced, transactions: await listActivity(limit) };
  });
}
