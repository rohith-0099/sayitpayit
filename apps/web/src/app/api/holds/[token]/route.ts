import { z } from "zod";
import { ApiError, handle } from "@/lib/api";
import { collect, runAgent } from "@/lib/agent/run";
import { decideHold, getHoldByToken } from "@/lib/holds";

const Body = z.object({ decision: z.enum(["approved", "denied"]) });

/**
 * The trusted family member approves or stops a held payment. The unguessable token in their link
 * is the authorisation. Approving does NOT pay: the user still confirms (and says the phrase).
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await ctx.params;
    const { decision } = Body.parse(await req.json());
    const found = await getHoldByToken(token);
    if (!found) throw new ApiError(404, "This approval link isn't valid.");
    const updated = await decideHold(token, decision);
    if (!updated) throw new ApiError(409, `This payment was already ${found.hold.status}.`);
    // Resume the waiting conversation on the server; the user's screen picks it up.
    await collect(runAgent({ userId: found.hold.userId, threadId: found.hold.threadId, familyDecision: decision }));
    return { status: updated.status };
  });
}
