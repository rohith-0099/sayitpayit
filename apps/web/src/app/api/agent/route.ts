import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handle } from "@/lib/api";
import { runAgent, sse } from "@/lib/agent/run";
import { getCurrentUser } from "@/lib/users";

const Body = z.object({
  text: z.string().trim().max(1000).default(""),
  source: z.enum(["voice", "text"]).default("text"),
  language: z.string().max(8).nullish(),
  /** From /api/stt when the user is enrolled; the server looks the result up (never trusted from the client). */
  voiceCheckId: z.string().uuid().nullish(),
  /** Browser time zone (IANA), so Guardian's "unusual hour" uses the user's clock. */
  timeZone: z.string().max(64).nullish(),
  /** Voice on (not muted): pre-generate the spoken reply. */
  speak: z.boolean().default(false),
  /** data:image/...;base64,... receipt photo */
  image: z
    .string()
    .max(8_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|heic);base64,/)
    .nullish(),
}).refine((b) => b.text || b.image, { message: "Say or type a command, or attach a receipt" });

/** Start a conversation. Streams step updates (SSE) until it needs a yes/no or finishes. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = Body.parse(await req.json());
    const user = await getCurrentUser();
    const image = body.image
      ? { mimeType: body.image.slice(5, body.image.indexOf(";")), base64: body.image.slice(body.image.indexOf(",") + 1) }
      : null;
    return sse(
      runAgent({
        userId: user.id,
        threadId: randomUUID(),
        speak: body.speak,
        input: { text: body.text || "Split this receipt", source: body.source, language: body.language ?? null, image, voiceCheckId: body.voiceCheckId ?? null, timeZone: body.timeZone ?? null },
      }),
    );
  });
}
