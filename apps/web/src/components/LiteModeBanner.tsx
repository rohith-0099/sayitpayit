import { guardianOnline } from "@/lib/guardian-status";

/**
 * Shown when the Guardian service (voice ID, scam model, Kokoro voice) is unreachable, e.g. a
 * sleeping free-tier host. Payments still go through Guardian's built-in rules and your yes.
 */
export async function LiteModeBanner() {
  if (await guardianOnline()) return null;
  return (
    <p role="status" className="rounded-2xl bg-amber/10 px-5 py-3 text-sm text-amber ring-1 ring-amber/30">
      Lite mode: Guardian&apos;s AI service is waking up or offline, so Voice ID, the scam-language model and the natural voice are paused.
      Every payment is still checked by Guardian&apos;s built-in rules and waits for your yes.
    </p>
  );
}
