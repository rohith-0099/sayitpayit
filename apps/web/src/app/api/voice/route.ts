import { ApiError, handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/users";
import { enroll, getVoiceProfile, removeVoiceProfile } from "@/lib/voice";

/** GET → enrolled? */
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    const p = await getVoiceProfile(user.id);
    return { enrolled: !!p, samples: p?.samples ?? 0, enrolledAt: p?.enrolledAt ?? null };
  });
}

/** POST multipart samples[] (3 recordings) → store the voiceprint. */
export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const samples = form.getAll("samples").filter((s): s is File => s instanceof File && s.size > 0);
    if (samples.length < 3) throw new ApiError(400, "Record all three sentences first.");
    const user = await getCurrentUser();
    try {
      return { enrolled: true, ...(await enroll(user, samples.slice(0, 5))) };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 422) throw new ApiError(422, (e as Error).message);
      throw e;
    }
  });
}

/** DELETE → remove the voiceprint. */
export async function DELETE() {
  return handle(async () => {
    const user = await getCurrentUser();
    await removeVoiceProfile(user.id);
    return { enrolled: false };
  });
}
