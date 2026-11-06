import { z } from "zod";
import { speech } from "@/lib/ai/tts";
import { handle } from "@/lib/api";

const Body = z.object({ text: z.string().trim().min(1).max(600), lang: z.string().regex(/^[a-z]{2}$/).default("en") });

/** POST {text, lang} → audio/wav (one sentence). 503 → the browser uses its own voice. */
export async function POST(req: Request) {
  return handle(async () => {
    const { text, lang } = Body.parse(await req.json());
    const out = await speech(text, lang);
    if (!out) return Response.json({ error: "No TTS engine available" }, { status: 503 });
    return new Response(new Uint8Array(out.wav), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-TTS-Engine": out.engine },
    });
  });
}
