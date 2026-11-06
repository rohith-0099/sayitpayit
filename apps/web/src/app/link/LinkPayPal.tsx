"use client";

import { loadCoreSdkScript, type SavePaymentSession } from "@paypal/paypal-js/sdk-v6";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Phase = "loading" | "ready" | "ineligible" | "linking" | "error";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body as T;
}

/** "Link your PayPal" with JS SDK v6 save-payment (Vault v3, no purchase). */
export function LinkPayPal() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<SavePaymentSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fail = (e: unknown) => {
      if (cancelled) return;
      console.error(e);
      setError(e instanceof Error ? e.message : "Something went wrong talking to PayPal.");
      setPhase("error");
    };

    (async () => {
      const paypal = await loadCoreSdkScript({ environment: "sandbox" });
      if (!paypal) throw new Error("PayPal SDK failed to load");
      const { clientToken } = await api<{ clientToken: string }>("/api/paypal/client-token");
      const sdk = await paypal.createInstance({ clientToken, components: ["paypal-payments"], pageType: "checkout" });
      const methods = await sdk.findEligibleMethods({ currencyCode: "USD", paymentFlow: "VAULT_WITHOUT_PAYMENT" });
      if (cancelled) return;
      if (!methods.isEligible("paypal")) return setPhase("ineligible");

      session.current = sdk.createPayPalSavePaymentSession({
        async onApprove(data) {
          setPhase("linking");
          try {
            await api("/api/paypal/link", {
              method: "POST",
              body: JSON.stringify({ action: "complete", vaultSetupToken: data.vaultSetupToken }),
            });
            router.refresh(); // server component re-renders as "linked"
          } catch (e) {
            fail(e);
          }
        },
        onCancel() {
          setPhase("ready");
        },
        onError(e) {
          fail(e);
        },
      });

      // Redirect presentation (e.g. some mobile browsers) comes back to this page.
      if (session.current.hasReturned?.()) {
        setPhase("linking");
        await session.current.resume?.();
        return;
      }
      setPhase("ready");
    })().catch(fail);

    return () => {
      cancelled = true;
    };
  }, [router]);

  const start = () => {
    if (!session.current) return;
    setError(null);
    // Don't await before start(): the popup needs the click's transient activation.
    const setupToken = api<{ vaultSetupToken: string }>("/api/paypal/link", {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    }).then(({ vaultSetupToken }) => ({ vaultSetupToken, setupToken: vaultSetupToken })); // guide uses setupToken, types vaultSetupToken
    session.current.start({ presentationMode: "auto" }, setupToken).catch((e) => {
      console.error(e);
      setError(e instanceof Error ? e.message : "Couldn't open PayPal.");
      setPhase("error");
    });
  };

  return (
    <div className="flex flex-col items-start gap-4">
      {phase === "loading" && <p className="text-sm text-mist">Connecting to PayPal…</p>}
      {phase === "ineligible" && (
        <p className="text-sm text-amber">
          PayPal saving isn&apos;t available for this session. Check that Vault is enabled for the sandbox app.
        </p>
      )}
      {phase === "linking" && <p className="text-sm text-signal">Saving your PayPal…</p>}
      <div className={phase === "ready" || phase === "error" ? "w-72" : "hidden"}>
        <paypal-button type="pay" class="paypal-gold" onClick={start} />
      </div>
      {error && <p className="max-w-md text-sm text-coral">{error}</p>}
    </div>
  );
}
