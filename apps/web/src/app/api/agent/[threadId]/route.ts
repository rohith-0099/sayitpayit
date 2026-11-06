import { z } from "zod";
import { handle } from "@/lib/api";
import { runAgent, sse } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({ answer: z.string().trim().max(300) });

/** Answer the read-back ("yes" / "no" / spoken text). Streams the rest of the flow. */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[threadId]">) {
  return handle(async () => {
    const { threadId } = await ctx.params;
    const { answer } = Body.parse(await req.json());
    const user = await getCurrentUser();
    // Validate ownership/state before opening the stream so errors come back as JSON.
    const events = runAgent({ userId: user.id, threadId, answer });
    const first = await events.next();
    async function* replay() {
      if (!first.done) yield first.value;
      yield* events;
    }
    return sse(replay());
  });
}
