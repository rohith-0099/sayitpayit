"""Replay/synthetic-speech score with AASIST-L (clovaai/aasist, MIT). See aasist/README.md."""

import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent / "aasist"
NB_SAMP = 64_600  # ~4 s at 16 kHz, the model's training input length
THRESHOLD = float(os.environ.get("SPOOF_THRESHOLD", "0.5"))


@lru_cache(maxsize=1)
def _model():
    from .aasist.AASIST import Model

    conf = json.loads((HERE / "AASIST-L.conf").read_text())
    model = Model(conf["model_config"])
    model.load_state_dict(torch.load(HERE / "weights" / "AASIST-L.pth", map_location="cpu", weights_only=True))
    return model.eval()


def load() -> None:
    _model()


def _windows(wav: np.ndarray, max_windows: int = 3) -> np.ndarray:
    """Tile short clips (as AASIST's own `pad` does); split long ones into up to 3 windows."""
    if len(wav) < NB_SAMP:
        reps = NB_SAMP // max(len(wav), 1) + 1
        return np.tile(wav, reps)[:NB_SAMP][None, :]
    n = min(max_windows, len(wav) // NB_SAMP)
    starts = np.linspace(0, len(wav) - NB_SAMP, n).astype(int)
    return np.stack([wav[s : s + NB_SAMP] for s in starts])


@torch.inference_mode()
def spoof_score(wav: np.ndarray) -> float:
    """0 = sounds like live human speech, 1 = sounds synthetic/replayed (per AASIST-L)."""
    _, out = _model()(torch.from_numpy(_windows(wav)).float())
    bona_fide = torch.softmax(out, dim=1)[:, 1].mean().item()  # label 1 = bonafide in AASIST
    return float(1.0 - bona_fide)
