// Currencies PayPal accepts for Payouts, Orders and Invoicing (developer.paypal.com/api/rest/reference/currency-codes).
// Pure, unit tested. INR, for example, only works between Indian accounts, so a cross-border
// payment in rupees fails with 400 CURRENCY_NOT_SUPPORTED. We check BEFORE charging anyone.
export const PAYPAL_CURRENCIES = new Set([
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD",
  "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF", "THB", "USD",
]);

export const isPayPalCurrency = (code: string) => PAYPAL_CURRENCIES.has(code.toUpperCase());

/** "INR" → "Indian rupees" (plural English name, for messages). */
export function currencyName(code: string, plural = true): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "name" }).formatToParts(plural ? 2 : 1);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}
