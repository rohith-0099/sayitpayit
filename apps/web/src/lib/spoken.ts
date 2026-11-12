// Text written for the ear, not the eye. Pure (no I/O), used on server and client, unit tested.
// TTS engines read "$0.50" as "zero point five zero dollars"; we say "fifty cents".

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
  if (!h) return rest;
  return `${ONES[h]} hundred${r ? ` ${rest}` : ""}`;
}

/** 1234 → "one thousand two hundred thirty-four". Whole numbers ≥ 0. */
export function numberWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n < 1000) return under1000(n);
  const out: string[] = [];
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= size) {
      out.push(`${under1000(Math.floor(n / size) % 1000)} ${name}`);
      n %= size;
    }
  }
  if (n) out.push(under1000(n));
  return out.join(" ");
}

/** [singular, plural, minor singular, minor plural]; minor null = no cents (JPY). */
const NAMES: Record<string, [string, string, string | null, string | null]> = {
  USD: ["dollar", "dollars", "cent", "cents"],
  EUR: ["euro", "euros", "cent", "cents"],
  GBP: ["pound", "pounds", "penny", "pence"],
  INR: ["rupee", "rupees", "paisa", "paise"],
  MXN: ["peso", "pesos", "centavo", "centavos"],
  JPY: ["yen", "yen", null, null],
  CAD: ["Canadian dollar", "Canadian dollars", "cent", "cents"],
  AUD: ["Australian dollar", "Australian dollars", "cent", "cents"],
  BRL: ["real", "reais", "centavo", "centavos"],
  CHF: ["Swiss franc", "Swiss francs", "centime", "centimes"],
};

function intlName(code: string, n: number): string {
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "name" }).formatToParts(n);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/**
 * Money as you'd say it: 0.5 USD → "fifty cents", 2.5 USD → "two dollars fifty",
 * 50 EUR → "fifty euros", 1 USD → "one dollar", 1250 INR → "one thousand two hundred fifty rupees".
 */
export function spokenMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const [one, many, minorOne, minorMany] = NAMES[code] ?? [intlName(code, 1), intlName(code, 2), "cent", "cents"];
  let whole = Math.floor(Math.abs(amount) + 1e-9);
  let cents = minorOne ? Math.round((Math.abs(amount) - whole) * 100) : 0;
  if (cents === 100) {
    whole += 1;
    cents = 0;
  }
  if (!minorOne) whole = Math.round(Math.abs(amount));
  const major = `${numberWords(whole)} ${whole === 1 ? one : many}`;
  if (!cents) return major;
  if (!whole) return `${numberWords(cents)} ${cents === 1 ? minorOne : minorMany}`;
  return `${major} ${numberWords(cents)}`;
}
