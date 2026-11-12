// Pure: which open invoice does the user mean? (unit tested)
import { normalizeName } from "./contacts-match";

export interface PickableInvoice {
  tx: { contactId: string | null; counterpartyEmail: string; counterpartyName: string | null; amount: string; currency: string };
  nickname: string | null;
}

/**
 * Pick the invoice the user means. Pure filter over the open invoices:
 * by person (contact id, email or name), then by amount/currency when they said one.
 * A stated amount must match: we never offer a different invoice than the one they described.
 */
export function pickInvoices<T extends PickableInvoice>(
  open: T[],
  who: { contactId?: string | null; email?: string | null; name?: string | null },
  amount: number | null,
  currency: string | null,
): T[] {
  const name = who.name ? normalizeName(who.name) : "";
  let rows = open.filter(({ tx, nickname }) => {
    if (who.contactId && tx.contactId === who.contactId) return true;
    if (who.email && tx.counterpartyEmail.toLowerCase() === who.email.toLowerCase()) return true;
    if (!who.contactId && !who.email && name) {
      return [nickname, tx.counterpartyName].some((n) => n && normalizeName(n).split(/\s+/).includes(name));
    }
    return !who.contactId && !who.email && !name; // no person given: all open invoices
  });
  if (amount !== null) rows = rows.filter(({ tx }) => Math.abs(Number(tx.amount) - amount) < 0.005 && (!currency || tx.currency === currency));
  return rows;
}

