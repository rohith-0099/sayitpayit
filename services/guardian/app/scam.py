"""Scam-language model: our fine-tuned multilingual MiniLM (training/scam_classifier.py).

Returns P(scam) from the model, plus readable signals (which scam tactics the command mentions) so
Guardian can explain itself. The signals are cues for the explanation; the probability is the model's.
"""

import os
import re
from functools import lru_cache
from pathlib import Path

import torch

MODEL_DIR = Path(os.environ.get("SCAM_MODEL_DIR", Path(__file__).resolve().parents[1] / "models" / "scam-classifier"))

# Multilingual cues for explanations (en, es, pt, fr, de, hi, ml, ta).
CUES: list[tuple[str, str, re.Pattern]] = [
    ("gift_cards", "Asks for gift cards", re.compile(r"gift ?cards?|itunes|google play|steam|tarjetas? de regalo|cart(ões|ao) (de )?presente|cartes? cadeaux?|geschenkkarte|गिफ्ट कार्ड|ഗിഫ്റ്റ് കാർഡ്|கிஃப்ட் கார்டு", re.I)),
    ("authority", "Someone claims to be the tax office, police, court or bank", re.compile(r"\b(irs|tax office|police|sheriff|court|customs|social security|hacienda|polic[ií]a|juzgado|receita|imp[oô]ts|gendarmerie|finanzamt|polizei)\b|पुलिस|आयकर|പോലീസ്|ആദായ നികുതി|போலீஸ்|வருமான வரி", re.I)),
    ("secrecy", "Told to keep it secret", re.compile(r"don'?t tell|do not tell|keep (it|this) (a )?secret|confidential|no (le|se lo) digas|no se lo cuentes|n[aã]o cont[ea]|ne (le )?dis (rien|pas)|nichts sagen|niemandem|किसी को मत|ആരോടും പറയരുത്|யாரிடமும் சொல்ல", re.I)),
    ("urgency", "Pressure to pay right now", re.compile(r"\b(urgent(ly)?|right now|immediately|today or|before (noon|tonight)|urgente|ya mismo|ahora mismo|imediatamente|tout de suite|sofort)\b|तुरंत|ഉടനെ|உடனே", re.I)),
    ("crypto_wire", "Crypto, wire or 'safe account' transfer", re.compile(r"\b(bitcoin|crypto|usdt|western union|moneygram|wire|safe account|cuenta segura|conta segura)\b|क्रिप्टो|ക്രിപ്റ്റോ|கிரிப்டோ", re.I)),
    ("stranger_on_phone", "Following instructions from someone on the phone", re.compile(r"(on the (phone|line)|the (man|agent|caller|officer) (said|says|told)|me (dijo|dice)|al tel[eé]fono|au t[eé]l[eé]phone|am telefon)", re.I)),
    ("prize", "A prize or inheritance that needs a fee", re.compile(r"\b(prize|lottery|won|inheritance|premio|loter[ií]a|herencia|pr[eê]mio|gagn[eé]|gewinn)\b|लॉटरी|ലോട്ടറി|லாட்டரி", re.I)),
]


@lru_cache(maxsize=1)
def _model():
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    if not (MODEL_DIR / "config.json").exists():
        raise FileNotFoundError(f"Scam model not found at {MODEL_DIR}. Run training/scam_classifier.py first.")
    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR).eval()
    return tok, model


def available() -> bool:
    return (MODEL_DIR / "config.json").exists()


def load() -> None:
    _model()


def signals(text: str) -> list[dict]:
    return [{"id": cid, "label": label} for cid, label, rx in CUES if rx.search(text)]


@torch.inference_mode()
def classify(text: str) -> dict:
    tok, model = _model()
    enc = tok([text], truncation=True, max_length=96, return_tensors="pt")
    p = float(torch.softmax(model(**enc).logits, dim=-1)[0, 1])
    return {"probability": round(p, 4), "label": "scam" if p >= 0.5 else "normal", "signals": signals(text), "model": "SayItPayIt scam classifier (fine-tuned multilingual MiniLM-L12)"}
