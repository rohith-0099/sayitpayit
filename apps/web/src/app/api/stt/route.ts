import { transcribe } from "@/lib/ai/groq";
import { getAgent } from "@/lib/agent/graph";
import { transcribeWithGemini } from "@/lib/ai/gemini-stt";
import type { Transcript } from "@/lib/ai/groq";
import { geminiFirst, secondOpinion } from "@/lib/ai/stt-route";
import { ApiError, handle } from "@/lib/api";
import { getCurrentUser, listContacts } from "@/lib/users";
import { recordVoiceCheck } from "@/lib/voice";

const MAX_BYTES = 10 * 1024 * 1024; // commands are a few seconds

/**
 * POST multipart {audio, language?, kind?: "command"|"answer", threadId?}
 *  → {text, language, voice: {checkId, ...} | null}
 * Whisper transcribes clear English/Spanish; Gemini handles code-mixed speech (see stt-route.ts); if the user enrolled a voiceprint, Guardian checks the SAME recording
 * (speaker + spoof, and for answers the conversation's challenge phrase, looked up server-side).
 */
export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) throw new ApiError(400, "No audio received. Tap the mic and speak.");
    if (audio.size > MAX_BYTES) throw new ApiError(413, "That recording is too long.");
    const kind = form.get("kind") === "answer" ? "answer" : "command";
    const threadId = String(form.get("threadId") ?? "") || undefined;
    const lang = String(form.get("language") ?? "");

    const user = await getCurrentUser();
    const contacts = await listContacts(user.id);
    let expectedPhrase: string | undefined;
    if (kind === "answer" && threadId) {
      const snap = await (await getAgent()).getState({ configurable: { thread_id: threadId } });
      if (snap.values?.userId === user.id) expectedPhrase = snap.values.challenge ?? undefined;
    }

    // Contact names in the prompt help Whisper spell them. The challenge phrase is deliberately NOT
    // included: Whisper can echo its prompt on unclear audio, which would let noise "pass" the challenge.
    const prompt = `SayItPayIt payment. Contacts: ${contacts.map((c) => c.nickname).join(", ")}.`;
    const hint = /^[a-z]{2}$/.test(lang) ? lang : undefined;
    const names = contacts.map((c) => c.nickname);
    const gemini = () => transcribeWithGemini(audio, { contacts: names, hint });

    // Clear single-language English/Spanish: Whisper (fast). Code-mixed (Hinglish, Manglish...),
    // an Indian language picked, or a shaky Whisper result: Gemini Flash listens again.
    let t: Transcript;
    let reason: string | null = geminiFirst(hint) ? `picked ${hint}` : null;
    let unclear = false;
    if (!reason) {
      t = await transcribe(audio, { prompt, language: hint });
      reason = secondOpinion(t, hint);
    }
    if (reason) {
      try {
        const g = await gemini();
        unclear = !g.clear;
        t = g;
      } catch (e) {
        // Gemini busy: fall back to Whisper (as English on "Any language", which beats a wrong-language guess).
        console.warn("[stt] Gemini transcription failed, using Whisper", e instanceof Error ? e.message : e);
        t = await transcribe(audio, { prompt, language: hint ?? "en" });
        if (!hint) t.language = "en";
      }
    }
    console.log(`[stt] ${t!.engine}${reason ? ` (${reason})` : ""}: ${t!.text}`);
    // Never guess: an unclear transcript asks the user to repeat or type instead of running.
    if (unclear && kind === "command") throw new ApiError(422, "I couldn't make that out clearly. Please say it again, or type it.", { code: "STT_UNCLEAR" });

    const check = await recordVoiceCheck(user, audio, t!.text, { kind, threadId, expectedPhrase });
    return {
      text: t!.text,
      language: t!.language,
      engine: t!.engine,
      voice: check && {
        checkId: check.id,
        status: check.status,
        speakerMatch: check.speakerMatch,
        speakerScore: check.speakerScore,
        spoofSuspect: check.spoofSuspect,
        phraseMatch: check.phraseMatch,
      },
    };
  });
}
