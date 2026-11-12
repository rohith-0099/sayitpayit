// Shared by the server page (first render) and the client list (reloads). Not a client module.

export interface ActivityRow {
  id: string;
  type: string;
  status: string;
  amount: string;
  currency: string;
  note: string | null;
  name: string;
}
export interface OwedRow {
  id: string;
  amount: string;
  currency: string;
  homeAmount: string | null;
  name: string;
  label: string | null;
}

type ApiTx = { id: string; type: string; status: string; amount: string; currency: string; note: string | null; counterpartyName: string | null; counterpartyEmail: string; homeAmount: string | null };

/** Same shape the server renders first. Kept in one place so both stay identical. */
export function toRows(
  txs: (ApiTx & { contact?: { nickname: string } | null })[],
  owed: (ApiTx & { nickname?: string | null; splitTitle?: string | null })[],
): { activity: ActivityRow[]; owed: OwedRow[] } {
  return {
    activity: txs.map((t) => ({ id: t.id, type: t.type, status: t.status, amount: t.amount, currency: t.currency, note: t.note, name: t.contact?.nickname ?? t.counterpartyName ?? t.counterpartyEmail })),
    owed: owed.map((t) => ({ id: t.id, amount: t.amount, currency: t.currency, homeAmount: t.homeAmount, name: t.nickname ?? t.counterpartyName ?? t.counterpartyEmail, label: t.splitTitle ?? t.note })),
  };
}

