// Deterministic safety net around the LLM's intent. Pure (no I/O), unit tested.
//
// The rule: a command that talks about cancelling/closing/voiding something can NEVER become a
// payment, whatever the LLM returned. "Close the 50 euro invoice we gave Maria" once came back as
// "pay Maria €50"; this makes that impossible.

/** Verbs that undo or remove something, in the languages we support. */
const UNDO =
  /\b(cancel+(?:l?ed|ing)?|close[sd]?|void(?:ed)?|delete[sd]?|remove[sd]?|revoke[sd]?|withdraw(?:n)?|retract|scrap|undo|take back|call off|get rid of)\b|\b(cancela(?:r|lo|la)?|anula(?:r|lo|la)?|borra(?:r|lo|la)?|elimina(?:r|lo|la)?|cierra(?:r|lo|la)?|cerrar|retira(?:r)?|storniere?n?|storno|lösche?n?|schließe?n?|annule[rz]?|supprime[rz]?|ferme[rz]?)\b|(रद्द|कैंसल|हटा|റദ്ദാക്ക|ക്യാൻസൽ|ഒഴിവാക്ക|നീക്ക)/iu;

/** Words for the thing being undone: an invoice / request / bill. */
const INVOICE =
  /\b(invoices?|requests?|bills?|payment requests?|money requests?|factura|facturas|cobro|cobros|solicitud|solicitudes|petici[oó]n|rechnung(?:en)?|anfrage|forderung|facture|demande)\b|(इनवॉइस|बिल|ഇൻവോയ്സ്|ബിൽ|അഭ്യർത്ഥന)/iu;

export const mentionsUndo = (text: string) => UNDO.test(text);
export const mentionsInvoice = (text: string) => INVOICE.test(text);

type Kind = "pay" | "request" | "split" | "cancel_invoice" | "add_contact" | "set_guardian" | "unknown";

/**
 * Correct the LLM's intent kind with hard rules. Returns the kind to use, and why it changed.
 *  - undo word + invoice word → cancel_invoice (never pay/request/split)
 *  - undo word + a money-moving kind → unknown (ask the user to rephrase; never move money)
 */
export function guardKind(kind: Kind, text: string): { kind: Kind; overridden: boolean } {
  const undo = mentionsUndo(text);
  if (!undo) return { kind, overridden: false };
  if (mentionsInvoice(text)) return { kind: "cancel_invoice", overridden: kind !== "cancel_invoice" };
  if (kind === "pay" || kind === "request" || kind === "split") return { kind: "unknown", overridden: true };
  return { kind, overridden: false };
}
