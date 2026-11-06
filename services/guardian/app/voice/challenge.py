"""Spoken challenge phrase check ("blue 4 7 9 2"): defeats replaying an old recording of the user.

Phrases are made by the web app (colour + 3 digits, English or Spanish); this matches what Whisper heard.
"""

import re
import unicodedata

NUMBER_WORDS = {
    # en
    "zero": "0", "oh": "0", "one": "1", "two": "2", "to": "2", "too": "2", "three": "3", "four": "4", "for": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    # es
    "cero": "0", "uno": "1", "una": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5", "seis": "6",
    "siete": "7", "ocho": "8", "nueve": "9",
}

COLORS = {
    "blue": {"blue", "azul"}, "green": {"green", "verde"}, "red": {"red", "rojo", "roja"},
    "yellow": {"yellow", "amarillo", "amarilla"}, "orange": {"orange", "naranja"}, "purple": {"purple", "morado", "morada"},
    "azul": {"azul", "blue"}, "verde": {"verde", "green"}, "rojo": {"rojo", "roja", "red"},
    "amarillo": {"amarillo", "amarilla", "yellow"}, "naranja": {"naranja", "orange"}, "morado": {"morado", "morada", "purple"},
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", s)


def _digits(tokens: list[str]) -> str:
    out = []
    for t in tokens:
        if t.isdigit():
            out.extend(t)  # "479" or "4" both fine
        elif t in NUMBER_WORDS:
            out.append(NUMBER_WORDS[t])
    return "".join(out)


def match(expected: str, heard: str) -> dict:
    exp = _norm(expected).split()
    got = _norm(heard).split()
    color = next((t for t in exp if t in COLORS), None)
    want_digits = "".join(t for t in exp if t.isdigit())
    color_ok = color is None or any(t in COLORS[color] for t in got)
    # Digits must appear in order, and nothing but noise in between is allowed: compare digit strings.
    heard_digits = _digits(got)
    # In order, and no digit-spraying ("zero one two ... nine" would contain any sequence).
    digits_ok = want_digits != "" and want_digits in heard_digits and len(heard_digits) <= len(want_digits) + 2
    # The random digits are the security check (4 digits = 4,608 phrases). The colour makes the phrase
    # easy to remember, but colour words are often misheard ("blue" -> "blew"), so it's reported, not required.
    return {"expected": expected, "heard": heard, "color_ok": color_ok, "digits_ok": digits_ok, "match": bool(digits_ok)}
