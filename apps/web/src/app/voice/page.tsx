import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/users";
import { getVoiceProfile } from "@/lib/voice";
import { VoiceEnroll } from "./VoiceEnroll";

export const metadata = { title: "Voice ID · SayItPayIt" };

export default function VoicePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <Link href="/" className="text-sm text-mist hover:text-paper">
        Back to SayItPayIt
      </Link>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-4xl font-bold tracking-tight">Set up Voice ID</h1>
        <p className="text-lg text-mist">
          Read three short sentences. Guardian learns how you sound, so a stranger, or a recording of you, can&apos;t send your money.
        </p>
      </header>
      <Suspense fallback={<p className="text-mist">Loading…</p>}>
        <Status />
      </Suspense>
      <p className="text-sm text-mist/80">
        Your voiceprint is a list of numbers, not a recording. Guardian keeps no audio, and you can delete the voiceprint at any time.
      </p>
    </main>
  );
}

async function Status() {
  await connection();
  const user = await getCurrentUser();
  const profile = await getVoiceProfile(user.id);
  return <VoiceEnroll enrolled={!!profile} enrolledAt={profile?.enrolledAt?.toISOString() ?? null} />;
}
