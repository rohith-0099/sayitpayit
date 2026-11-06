import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import type { User, VoiceCheck } from "./db/schema";
import { enrollVoice, GuardianUnavailable, verifyVoice } from "./guardian-client";

const { voiceProfiles, voiceChecks } = schema;

export async function getVoiceProfile(userId: string) {
  const [p] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId));
  return p ?? null;
}

export async function enroll(user: User, samples: Blob[]) {
  const e = await enrollVoice(samples);
  await db
    .insert(voiceProfiles)
    .values({ userId: user.id, embedding: e.embedding, model: e.model, samples: e.samples })
    .onConflictDoUpdate({ target: voiceProfiles.userId, set: { embedding: e.embedding, model: e.model, samples: e.samples, enrolledAt: new Date() } });
  return { samples: e.samples, consistency: e.consistency, quality: e.quality };
}

export async function removeVoiceProfile(userId: string) {
  await db.delete(voiceProfiles).where(eq(voiceProfiles.userId, userId));
}

/**
 * Run Guardian on a recording and store the result. Returns null when the user hasn't enrolled
 * (nothing to compare against). Guardian being down is recorded as status "unavailable".
 */
export async function recordVoiceCheck(
  user: User,
  audio: Blob,
  transcript: string,
  opts: { kind: "command" | "answer"; threadId?: string; expectedPhrase?: string },
): Promise<VoiceCheck | null> {
  const profile = await getVoiceProfile(user.id);
  if (!profile) return null;
  let values: Partial<typeof voiceChecks.$inferInsert> = { status: "unavailable" };
  try {
    const v = await verifyVoice(audio, profile.embedding, { expectedPhrase: opts.expectedPhrase, transcript });
    values = v.ok
      ? {
          status: "ok",
          speakerScore: v.speaker.score,
          speakerMatch: v.speaker.match,
          speakerVerdict: v.speaker.verdict,
          spoofScore: v.spoof.score,
          spoofSuspect: v.spoof.suspect,
          phraseMatch: v.phrase ? v.phrase.match : null,
        }
      : { status: "too_short" };
  } catch (e) {
    if (!(e instanceof GuardianUnavailable)) throw e;
    console.error("[voice]", e.message);
  }
  const [row] = await db
    .insert(voiceChecks)
    .values({ userId: user.id, kind: opts.kind, threadId: opts.threadId, transcript, phraseExpected: opts.expectedPhrase, ...values, status: values.status! })
    .returning();
  return row;
}

/** Use a check exactly once: must be this user's, the right kind/thread, unused and recent. */
export async function consumeVoiceCheck(id: string | null | undefined, userId: string, opts: { kind: "command" | "answer"; threadId?: string; maxAgeSec?: number }) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .update(voiceChecks)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(voiceChecks.id, id),
        eq(voiceChecks.userId, userId),
        eq(voiceChecks.kind, opts.kind),
        isNull(voiceChecks.consumedAt),
        gt(voiceChecks.createdAt, sql`now() - make_interval(secs => ${opts.maxAgeSec ?? 300})`),
        ...(opts.threadId ? [eq(voiceChecks.threadId, opts.threadId)] : []),
      ),
    )
    .returning();
  return row ?? null;
}

const COLORS: Record<string, string[]> = {
  en: ["blue", "green", "red", "yellow", "orange", "purple"],
  es: ["azul", "verde", "rojo", "amarillo", "naranja", "morado"],
};

/**
 * Random phrase like "blue 4 7 9 2" (Spanish colours for Spanish speakers). The 4 digits are what
 * Guardian verifies (9·8·8·8 = 4,608 phrases); the colour just makes it easy to remember.
 * Digits never repeat back-to-back, and 0 is skipped ("oh"/"zero" is easy to mishear).
 */
export function makeChallenge(language: string): string {
  const colors = COLORS[language] ?? COLORS.en;
  const digits: number[] = [];
  while (digits.length < 4) {
    const d = randomInt(1, 10);
    if (d !== digits.at(-1)) digits.push(d);
  }
  return `${colors[randomInt(colors.length)]} ${digits.join(" ")}`;
}
