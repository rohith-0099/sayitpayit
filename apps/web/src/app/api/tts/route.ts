import { z } from "zod";
import { speech } from "@/lib/ai/tts";
import { handle } from "@/lib/api";

const Body = z.object({ text: z.string().trim().min(1).max(600), lang: z.string().regex(/^[a-z]{2}$/).default("en") });

/**
 * POST {text, lang} → audio for one short line.
 *  - audio/wav: cached or Kokoro (whole clip)
 *  - audio/pcm;rate=24000: Gemini, streamed as raw 16-bit little-endian mono PCM while it's generated
 *  - 503: no engine available; the browser uses its own voice
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { text, lang } = Body.parse(await req.json());
    const out = await speech(text, lang);
    if (out?.kind === "wav") {
      return new Response(new Uint8Array(out.wav), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-TTS-Engine": out.engine } });
    }
    if (out?.kind === "live" && (await out.live.first)) {
      return new Response(out.live.stream(), {
        headers: { "Content-Type": `audio/pcm;rate=${out.live.sampleRate}`, "Cache-Control": "no-store, no-transform", "X-TTS-Engine": out.live.engine },
      });
    }
    return Response.json({ error: "No TTS engine available" }, { status: 503 });
  });
}
