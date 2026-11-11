import { z } from "zod";
import { handle } from "@/lib/api";
import { currentEvent, runAgent, sse } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({ answer: z.string().trim().max(300), voiceCheckId: z.string().uuid().nullish() });

/** Where the conversation is now (polled while waiting for the family's decision). */
export async function GET(_req: Request, ctx: RouteContext<"/api/agent/[threadId]">) {
  return handle(async () => {
    const { threadId } = await ctx.params;
    const user = await getCurrentUser();
    return currentEvent(user.id, threadId);
  });
}

/** Answer whatever the agent is waiting on (read-back yes/no, a Guardian question, or "cancel" on hold). */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[threadId]">) {
  return handle(async () => {
    const { threadId } = await ctx.params;
    const { answer, voiceCheckId } = Body.parse(await req.json());
    const user = await getCurrentUser();
    // Validate ownership/state before opening the stream so errors come back as JSON.
    const events = runAgent({ userId: user.id, threadId, answer, voiceCheckId });
    const first = await events.next();
    async function* replay() {
      if (!first.done) yield first.value;
      yield* events;
    }
    return sse(replay());
  });
}
