import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { listTransactions } from "@/lib/paypal";
import { listActivity, listOutstanding, syncPendingPayouts } from "@/lib/payments/service";
import { getCurrentUser } from "@/lib/users";

/**
 * GET /api/activity                 → the user's transactions (newest first) + who still owes them
 * GET /api/activity?sync=1          → refresh in-flight payouts from PayPal first
 * GET /api/activity?source=paypal   → raw PayPal Transaction Search (last 30 days)
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    if (q.get("source") === "paypal") return { source: "paypal", transactions: await listTransactions() };
    const user = await getCurrentUser();
    const synced = q.get("sync") === "1" ? await syncPendingPayouts(user.id) : 0;
    const limit = Math.min(Number(q.get("limit")) || 50, 200);
    const [rows, outstanding] = await Promise.all([listActivity(user.id, limit), listOutstanding(user.id)]);
    return {
      source: "db",
      synced,
      transactions: rows.map((r) => ({ ...r.tx, contact: r.contact })),
      outstanding: outstanding.map((o) => ({ ...o.tx, nickname: o.nickname, splitTitle: o.splitTitle })),
    };
  });
}
