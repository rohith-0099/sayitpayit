// Classify a spoken/typed answer to "Shall I send it?". Pure word lists first (instant,
// works offline); anything unclear is treated as NOT a yes. A payment only goes out on a clear yes.

const YES = [
  "yes", "yeah", "yep", "yup", "sure", "confirm", "confirmed", "go ahead", "send it", "do it", "ok", "okay", "correct", "please do",
  "sí", "si", "claro", "confirmo", "dale", "adelante", "envíalo", "envialo", "de acuerdo", "vale",
  "ja", "jawohl", "genau", "oui", "d'accord", "sim", "haan", "हाँ", "हां", "ജി", "അതെ", "ശരി", "ആം", "はい",
];
const NO = [
  "no", "nope", "cancel", "stop", "don't", "dont", "do not", "wait", "hold on", "never mind", "nevermind",
  "cancela", "cancelar", "espera", "nein", "abbrechen", "non", "annuler", "não", "nahin", "नहीं", "വേണ്ട", "ഇല്ല", "いいえ",
];

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[.,!?¡¿"']/g, " ").replace(/\s+/g, " ").trim();
const has = (text: string, phrase: string) => new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`, "u").test(text);

export type Answer = "yes" | "no" | "unclear";

export function classifyAnswer(raw: string): Answer {
  const t = norm(raw);
  if (!t) return "unclear";
  const no = NO.some((w) => has(t, norm(w)));
  const yes = YES.some((w) => has(t, norm(w)));
  if (no) return "no"; // "no, don't send" / "yes... no wait" → never a yes
  if (yes) return "yes";
  return "unclear";
}
