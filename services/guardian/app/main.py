"""Guardian: voice security, fraud risk and scam-language service for SayItPayIt. CPU only."""

import json
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Annotated

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import scam, tts

from .voice import challenge, speaker, spoof
from .voice.audio import SR, AudioError, load_audio, speech_seconds, trim_silence

VERSION = "0.2.0"
MIN_SPEECH_SEC = 0.8
MAX_UPLOAD = 5 * 1024 * 1024
models_ready = {"speaker": False, "spoof": False, "tts": False, "scam": False}


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load once at startup so the first verification is fast (ECAPA downloads on first run).
    if os.environ.get("RENDER") and not os.environ.get("GUARDIAN_API_KEY"):
        raise RuntimeError("Set GUARDIAN_API_KEY when hosting Guardian: its URL is public.")
    if os.environ.get("GUARDIAN_SKIP_MODEL_LOAD") != "1":
        speaker.load()
        models_ready["speaker"] = True
        spoof.load()
        models_ready["spoof"] = True
        if scam.available():
            scam.load()
            models_ready["scam"] = True

        # Kokoro's English pipeline takes a while the first time (downloads models); warm it in the
        # background so /health and the voice gate are available immediately.
        def _warm_tts():
            tts.warm("en")
            tts.warm("es")  # the demo's second language
            models_ready["tts"] = True

        threading.Thread(target=_warm_tts, daemon=True).start()
    yield


app = FastAPI(title="SayItPayIt Guardian", version=VERSION, description="Voice gate, risk model and scam classifier. CPU only.", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])


def require_key(x_guardian_key: Annotated[str | None, Header()] = None) -> None:
    """Shared secret between the web app and Guardian (set GUARDIAN_API_KEY on both)."""
    expected = os.environ.get("GUARDIAN_API_KEY")
    if expected and x_guardian_key != expected:
        raise HTTPException(401, "bad or missing X-Guardian-Key")


async def _read_audio(f: UploadFile) -> np.ndarray:
    data = await f.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "audio too large")
    try:
        return load_audio(data)
    except AudioError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "guardian", "version": VERSION, "models": models_ready}


@app.post("/voice/enroll", dependencies=[Depends(require_key)])
async def enroll(samples: Annotated[list[UploadFile], File(description="3 short recordings of the user")]) -> dict:
    """Average ECAPA embeddings of 3+ samples into a voiceprint. Stateless: the caller stores it."""
    if len(samples) < 3:
        raise HTTPException(400, "need at least 3 samples")
    embs, quality = [], []
    for f in samples[:5]:
        wav = await _read_audio(f)
        speech = speech_seconds(wav)
        quality.append({"duration": round(len(wav) / SR, 2), "speech_sec": round(speech, 2)})
        if speech < MIN_SPEECH_SEC:
            raise HTTPException(422, f"sample {len(quality)} has too little speech ({speech:.1f}s); read the whole sentence")
        embs.append(speaker.embed(trim_silence(wav)))
    sims = [speaker.cosine(a, b) for i, a in enumerate(embs) for b in embs[i + 1 :]]
    voiceprint = np.mean(embs, axis=0)
    voiceprint /= np.linalg.norm(voiceprint) + 1e-9
    return {
        "embedding": [round(float(x), 6) for x in voiceprint],
        "model": speaker.MODEL_ID,
        "samples": len(embs),
        "consistency": round(min(sims), 3),
        "quality": quality,
    }


@app.post("/voice/verify", dependencies=[Depends(require_key)])
async def verify(
    audio: Annotated[UploadFile, File()],
    embedding: Annotated[str, Form(description="JSON array: the enrolled voiceprint")],
    expected_phrase: Annotated[str | None, Form()] = None,
    transcript: Annotated[str | None, Form()] = None,
) -> dict:
    """Speaker match (ECAPA) + spoof score (AASIST-L) + optional challenge-phrase match."""
    t0 = time.perf_counter()
    try:
        enrolled = np.asarray(json.loads(embedding), dtype=np.float32)
        assert enrolled.ndim == 1 and enrolled.size >= 64
    except Exception as e:
        raise HTTPException(400, "embedding must be a JSON array of floats") from e

    wav = await _read_audio(audio)
    speech = trim_silence(wav)
    if len(speech) / SR < MIN_SPEECH_SEC:
        return {"ok": False, "reason": "too_short", "speech_sec": round(len(speech) / SR, 2)}

    score = speaker.cosine(speaker.embed(speech), enrolled)
    t1 = time.perf_counter()
    sp = spoof.spoof_score(speech)
    t2 = time.perf_counter()
    phrase = challenge.match(expected_phrase, transcript or "") if expected_phrase else None

    return {
        "ok": True,
        "speech_sec": round(len(speech) / SR, 2),
        "speaker": {"score": round(score, 3), "threshold": speaker.THRESHOLD, "reject_below": speaker.REJECT, "match": score >= speaker.THRESHOLD, "verdict": speaker.verdict(score)},
        "spoof": {"score": round(sp, 3), "threshold": spoof.THRESHOLD, "suspect": sp >= spoof.THRESHOLD, "model": "AASIST-L"},
        "phrase": phrase,
        "ms": {"speaker": round((t1 - t0) * 1000), "spoof": round((t2 - t1) * 1000)},
    }


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    lang: str = Field(default="en", pattern=r"^[a-z]{2}$")
    speed: float = Field(default=1.0, ge=0.7, le=1.3)


@app.post("/tts", dependencies=[Depends(require_key)], responses={200: {"content": {"audio/wav": {}}}})
def text_to_speech(req: TtsRequest) -> Response:
    """Kokoro TTS. 422 for languages Kokoro doesn't speak (the web app falls back to Gemini TTS)."""
    if req.lang not in tts.SUPPORTED:
        raise HTTPException(422, f"Kokoro doesn't support '{req.lang}'")
    wav = tts.synthesize(req.text.strip(), req.lang, req.speed)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "public, max-age=86400"})


class ScamRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@app.post("/scam/classify", dependencies=[Depends(require_key)])
def scam_classify(req: ScamRequest) -> dict:
    """Command text → P(scam) from our fine-tuned multilingual classifier + readable signals."""
    if not scam.available():
        raise HTTPException(503, "scam model not trained yet (run training/scam_classifier.py)")
    t0 = time.perf_counter()
    out = scam.classify(req.text)
    out["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return out
