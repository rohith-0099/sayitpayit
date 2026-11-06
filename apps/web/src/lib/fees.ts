// Read-back quote: what the recipient gets, what the sender pays, and why.
// Rates from PayPal's US consumer fee page (last updated May 19, 2026):
//  - personal (Friends & Family) domestic: no fee
//  - personal international: 5%, min 0.99 USD, max 4.99 USD
//  - recipient receives a different currency (incl. Payouts): 4.00% conversion spread
//  - goods & services: no fee for the buyer (the seller pays PayPal's seller fee)
// "Friends & Family vs Goods & Services" is our label for fee display; Payouts doesn't set it on PayPal's side.
import { round2 } from "./fx";

export type Category = "friends_family" | "business";

export interface QuoteInput {
  /** What the recipient should receive, in their currency. */
  amount: number;
  currency: string;
  homeCurrency: string;
  /** 1 unit of `currency` in `homeCurrency`. */
  rate: number;
  category: Category;
  senderCountry: string;
  recipientCountry: string;
}

export interface Fee {
  id: "conversion" | "international";
  label: string;
  amount: number; // home currency
}

export interface Quote {
  recipientReceives: { amount: number; currency: string };
  rate: number;
  converted: boolean;
  /** Amount before fees, in home currency. */
  base: number;
  fees: Fee[];
  /** What the sender is charged, in home currency. */
  total: number;
  homeCurrency: string;
  category: Category;
  categoryLabel: string;
  notes: string[];
}

export const CONVERSION_SPREAD = 0.04;
export const INTL_PERSONAL = { rate: 0.05, min: 0.99, max: 4.99 }; // USD

export function quote(q: QuoteInput): Quote {
  const converted = q.currency.toUpperCase() !== q.homeCurrency.toUpperCase();
  const crossBorder = q.senderCountry.toUpperCase() !== q.recipientCountry.toUpperCase();
  const base = round2(q.amount * (converted ? q.rate : 1));
  const fees: Fee[] = [];
  const notes: string[] = [];

  if (converted) {
    fees.push({ id: "conversion", label: `Currency conversion (${CONVERSION_SPREAD * 100}%)`, amount: round2(base * CONVERSION_SPREAD) });
  }
  if (q.category === "friends_family" && crossBorder) {
    const f = Math.min(Math.max(base * INTL_PERSONAL.rate, INTL_PERSONAL.min), INTL_PERSONAL.max);
    fees.push({ id: "international", label: "International transfer (5%, max $4.99)", amount: round2(f) });
  }
  if (q.category === "business") notes.push("Goods & Services: no fee for you; the seller pays PayPal's seller fee, and you get Purchase Protection.");
  if (q.category === "friends_family" && !crossBorder && !converted) notes.push("Friends & Family in the same country: no fee.");

  return {
    recipientReceives: { amount: round2(q.amount), currency: q.currency.toUpperCase() },
    rate: q.rate,
    converted,
    base,
    fees,
    total: round2(base + fees.reduce((a, f) => a + f.amount, 0)),
    homeCurrency: q.homeCurrency.toUpperCase(),
    category: q.category,
    categoryLabel: q.category === "business" ? "Goods & Services" : "Friends & Family",
    notes,
  };
}
