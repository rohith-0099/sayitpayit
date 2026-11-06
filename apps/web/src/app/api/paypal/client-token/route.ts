import { handle } from "@/lib/api";
import { getBrowserClientToken } from "@/lib/paypal";

/** Browser-safe client token for JS SDK v6, bound to the requesting host when it's public. */
export async function GET(req: Request) {
  return handle(async () => {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? undefined;
    const { clientToken, expiresIn } = await getBrowserClientToken(host ?? undefined);
    return Response.json({ clientToken, expiresIn }, { headers: { "Cache-Control": "no-store" } });
  });
}
