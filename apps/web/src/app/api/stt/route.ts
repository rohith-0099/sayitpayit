import { transcribe } from "@/lib/ai/groq";
import { ApiError, handle } from "@/lib/api";
import { getCurrentUser, listContacts } from "@/lib/users";

const MAX_BYTES = 10 * 1024 * 1024; // ~10 min of opus; commands are a few seconds

/** POST multipart {audio} → {text, language}. Whisper auto-detects the language. */
export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) throw new ApiError(400, "No audio received. Hold the mic and speak.");
    if (audio.size > MAX_BYTES) throw new ApiError(413, "That recording is too long.");
    const user = await getCurrentUser();
    const contacts = await listContacts(user.id);
    // Names in the prompt help Whisper spell "Maria", "Kenji"... without forcing a language.
    const prompt = `SayItPayIt payment. Contacts: ${contacts.map((c) => c.nickname).join(", ")}.`;
    // Optional hint from the language picker. Auto-detect is fine for English/Spanish but
    // unreliable for e.g. Malayalam, where the hint makes the difference.
    const lang = String(form.get("language") ?? "");
    return transcribe(audio, { prompt, language: /^[a-z]{2}$/.test(lang) ? lang : undefined });
  });
}
