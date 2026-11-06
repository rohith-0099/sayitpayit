"""Generate our multilingual scam-vs-normal payment-command dataset with Gemini.

Output: services/guardian/data/scam_commands.jsonl (published with the repo).
Each row: {"text", "label": "scam"|"normal", "category", "language", "hard_negative", "split", "source"}

Usage:  GEMINI_API_KEY=... .venv/bin/python training/generate_scam_data.py [--per-call 40]
Resumable: batches already in the output file are skipped. Deterministic train/val/test split by text hash.
"""

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parents[1] / "data" / "scam_commands.jsonl"
MODELS = os.environ.get("GEMINI_MODELS", "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash").split(",")

LANGUAGES = {
    "en": "English", "es": "Spanish", "hi": "Hindi (Devanagari script)", "ml": "Malayalam (Malayalam script)",
    "ta": "Tamil (Tamil script)", "de": "German", "fr": "French", "pt": "Portuguese",
}

SCAM_CATEGORIES = {
    "authority": "someone posing as the tax office, police, court, bank or government demands payment",
    "gift_cards": "paying with gift cards / store cards / reading card codes to someone",
    "secrecy": "the user was told not to tell family or the bank",
    "urgency_threat": "extreme urgency or threats (arrest, account closed, utilities cut) pushing an immediate payment",
    "family_emergency": "a 'grandchild' or relative in trouble (jail, hospital, stranded abroad) asks for money via a stranger",
    "romance": "an online partner the user never met asks for money (visa, ticket, medical bill, customs)",
    "tech_refund": "tech support / refund overpayment scams asking to send money back or 'protect' funds",
    "investment_crypto": "guaranteed-return investments, crypto, 'safe account' transfers",
    "prize_fee": "a prize, lottery or inheritance that requires a fee first",
    "remote_instruction": "the user is repeating instructions from someone on the phone right now",
}

NORMAL_HINTS = (
    "everyday payments, requests and bill splits between friends, family, freelancers and landlords: rent, dinner, "
    "groceries, birthday gifts, tutoring, a logo design, concert tickets, utilities shares, paying back a loan, "
    "sending money to family abroad. Vary amounts, currencies and names."
)
HARD_NEGATIVE_HINTS = (
    "LEGITIMATE commands that share surface words with scams but are normal: 'urgent' rent due today, buying a "
    "gift for mom, paying the real electricity bill, sending a grandchild birthday money the user arranged "
    "themselves, a known contractor, splitting a bank fee, paying a friend back for a card they bought. "
    "Nothing coercive, secret or from a stranger."
)

SCHEMA = {
    "type": "OBJECT",
    "properties": {"items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
        "text": {"type": "STRING"}, "category": {"type": "STRING"}}, "required": ["text", "category"]}}},
    "required": ["items"],
}

STYLE = (
    "Write them as things a person SAYS OUT LOUD to a voice payment assistant (first person, spoken, natural), "
    "1-2 sentences each, some short, some rambling. Mix speakers: young, middle-aged and elderly; calm and stressed. "
    "Some should look like imperfect speech-to-text (missing punctuation, filler words). Use realistic names and "
    "amounts in local currencies. Do not number them. Do not include explanations."
)


def batches():
    """(batch_id, language, label, prompt) for every call we need."""
    for lang, lang_name in LANGUAGES.items():
        for part in range(2):
            cats = list(SCAM_CATEGORIES.items())
            random.Random(f"{lang}{part}").shuffle(cats)
            cat_lines = "\n".join(f'- "{k}": {v}' for k, v in cats)
            yield (f"scam-{lang}-{part}", lang, "scam",
                   f"Generate {{n}} DIFFERENT payment commands in {lang_name} where the user is being SCAMMED. "
                   f"Spread them across these categories and set category to the key:\n{cat_lines}\n{STYLE}")
            yield (f"normal-{lang}-{part}", lang, "normal",
                   f"Generate {{n}} DIFFERENT ordinary payment commands in {lang_name}: {NORMAL_HINTS} "
                   f'Set category to "normal". {STYLE}')
        yield (f"hardneg-{lang}", lang, "normal",
               f"Generate {{n}} DIFFERENT payment commands in {lang_name}: {HARD_NEGATIVE_HINTS} "
               f'Set category to "hard_negative". {STYLE}')


def call_gemini(prompt: str, key: str) -> list[dict]:
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 1.0, "responseMimeType": "application/json", "responseSchema": SCHEMA}}
    last = ""
    for attempt in range(6):
        for model in MODELS:
            try:
                r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model.strip()}:generateContent",
                               headers={"x-goog-api-key": key}, json=body, timeout=90)
            except httpx.HTTPError as e:
                last = f"{model}: {e}"
                continue
            if r.status_code == 200:
                try:
                    text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
                    return json.loads(text)["items"]
                except (KeyError, IndexError, json.JSONDecodeError) as e:
                    last = f"{model}: bad response {e}"
                    continue
            last = f"{model}: HTTP {r.status_code} {r.text[:120]}"
        time.sleep(min(60, 5 * 2**attempt))  # free-tier backoff
    raise RuntimeError(f"Gemini failed: {last}")


def norm(t: str) -> str:
    return re.sub(r"\W+", " ", t.lower()).strip()


def split_for(text: str) -> str:
    h = int(hashlib.sha256(norm(text).encode()).hexdigest(), 16) % 100
    return "test" if h < 15 else "val" if h < 25 else "train"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-call", type=int, default=40)
    args = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY") or sys.exit("Set GEMINI_API_KEY")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = [json.loads(l) for l in OUT.read_text().splitlines()] if OUT.exists() else []
    done = {r["batch"] for r in rows}
    seen = {norm(r["text"]) for r in rows}

    todo = [b for b in batches() if b[0] not in done]
    print(f"{len(rows)} rows already; {len(todo)} batches to go")
    for i, (bid, lang, label, prompt) in enumerate(todo, 1):
        items = call_gemini(prompt.replace("{n}", str(args.per_call)), key)
        added = 0
        with OUT.open("a") as f:
            for it in items:
                text = str(it.get("text", "")).strip()
                cat = str(it.get("category", "")).strip()
                if len(text) < 8 or norm(text) in seen:
                    continue
                if label == "scam" and cat not in SCAM_CATEGORIES:
                    cat = "other_scam"
                if label == "normal":
                    cat = "hard_negative" if bid.startswith("hardneg") else "normal"
                seen.add(norm(text))
                row = {"text": text, "label": label, "category": cat, "language": lang,
                       "hard_negative": cat == "hard_negative", "split": split_for(text),
                       "source": "gemini (generated for SayItPayIt)", "batch": bid}
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                added += 1
        print(f"[{i}/{len(todo)}] {bid}: +{added}")
        time.sleep(2)

    rows = [json.loads(l) for l in OUT.read_text().splitlines()]
    by = {}
    for r in rows:
        by.setdefault((r["label"], r["split"]), 0)
        by[(r["label"], r["split"])] += 1
    print("total", len(rows), dict(sorted(by.items())))


if __name__ == "__main__":
    main()
