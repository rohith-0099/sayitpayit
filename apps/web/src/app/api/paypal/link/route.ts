import { z } from "zod";
import { handle } from "@/lib/api";
import { completeLink, linkStatus, startLink, unlink } from "@/lib/link";
import { getCurrentUser } from "@/lib/users";

/** GET → link status. */
export async function GET() {
  return handle(async () => linkStatus(await getCurrentUser()));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("complete"), vaultSetupToken: z.string().min(5).max(64).optional() }),
]);

/** POST {action:"start"} → {vaultSetupToken};  POST {action:"complete", vaultSetupToken} → status. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const user = await getCurrentUser();
    if (body.action === "start") {
      const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
      return startLink(user, `${proto}://${host}`);
    }
    return completeLink(user, body.vaultSetupToken);
  });
}

/** DELETE → unlink (deletes the payment token at PayPal). */
export async function DELETE() {
  return handle(async () => unlink(await getCurrentUser()));
}
