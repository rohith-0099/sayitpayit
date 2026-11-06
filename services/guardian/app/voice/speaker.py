"""Speaker verification with SpeechBrain ECAPA-TDNN (speechbrain/spkrec-ecapa-voxceleb, Apache-2.0)."""

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

MODEL_ID = "speechbrain/spkrec-ecapa-voxceleb"
SAVEDIR = Path(os.environ.get("GUARDIAN_MODELS_DIR", Path(__file__).resolve().parents[2] / "pretrained_models")) / "spkrec-ecapa-voxceleb"
# Cosine similarity on L2-normalised ECAPA embeddings, three zones (override via env):
#   >= THRESHOLD           match
#   [REJECT, THRESHOLD)    unsure  (short clips of the right person can land here)
#   <  REJECT              mismatch
# Calibrated 2026-11-06: same speaker 0.22-0.77 (short 2 s answers lowest), other speakers -0.04-0.14.
THRESHOLD = float(os.environ.get("SPEAKER_THRESHOLD", "0.25"))
REJECT = float(os.environ.get("SPEAKER_REJECT", "0.15"))


def verdict(score: float) -> str:
    return "match" if score >= THRESHOLD else "unsure" if score >= REJECT else "mismatch"


@lru_cache(maxsize=1)
def _model():
    from speechbrain.inference.speaker import EncoderClassifier

    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    return EncoderClassifier.from_hparams(source=MODEL_ID, savedir=str(SAVEDIR), run_opts={"device": "cpu"})


def load() -> None:
    _model()


@torch.inference_mode()
def embed(wav: np.ndarray) -> np.ndarray:
    e = _model().encode_batch(torch.from_numpy(wav).unsqueeze(0)).squeeze().numpy().astype(np.float32)
    return e / (np.linalg.norm(e) + 1e-9)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    return float(np.dot(a, b))
