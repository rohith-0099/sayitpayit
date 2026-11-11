import { guardianOnline } from "@/lib/guardian-status";

/**
 * Lite mode: the Guardian ML service (Voice ID, scam-language model, natural voice) isn't reachable.
 * On the hosted demo (LITE_MODE=1) that's by design: it needs more memory than free hosting gives,
 * so it runs locally (docker compose --profile full up). Payments still pass Guardian's rules and your yes.
 */
export async function LiteModeBanner() {
  const hosted = process.env.LITE_MODE === "1";
  if (!hosted && (await guardianOnline())) return null;
  return (
    <p role="status" className="rounded-2xl bg-amber/10 px-5 py-3 text-sm text-amber ring-1 ring-amber/30">
      {hosted ? (
        <>
          Lite mode. Full voice Guardian (Voice ID, our scam-language model, the natural voice) runs locally: see the demo video and the{" "}
          <a href="https://github.com/rohith-0099/sayitpayit#run-it-locally" className="underline underline-offset-4">README</a>. Every payment here is still checked by
          Guardian&apos;s rules and waits for your yes.
        </>
      ) : (
        <>Lite mode: Guardian&apos;s AI service is offline, so Voice ID, the scam-language model and the natural voice are paused. Every payment is still checked by Guardian&apos;s rules and waits for your yes.</>
      )}
    </p>
  );
}
