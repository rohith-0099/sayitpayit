"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnlinkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/paypal/link", { method: "DELETE" });
        router.refresh();
        setBusy(false);
      }}
      className="text-sm text-mist underline-offset-4 hover:text-paper/90 hover:underline disabled:opacity-50"
    >
      {busy ? "Unlinking…" : "Unlink PayPal"}
    </button>
  );
}
