"""Text-to-speech with Kokoro-82M (hexgrad/Kokoro-82M, Apache-2.0): natural female voices on CPU."""

import io
import os
import threading
from collections import OrderedDict
from hashlib import sha256

import numpy as np
import soundfile as sf

SR = 24_000
# Female voice per language Kokoro supports. Default English voice: af_heart (Kokoro's top-rated
# voice; compared with af_bella it measured slightly warmer). Override with KOKORO_VOICE.
VOICES = {
    "en": ("a", os.environ.get("KOKORO_VOICE", "af_heart")),
    "es": ("e", "ef_dora"),
    "fr": ("f", "ff_siwis"),
    "hi": ("h", "hf_alpha"),
    "it": ("i", "if_sara"),
    "ja": ("j", "jf_alpha"),
    "pt": ("p", "pf_dora"),
    "zh": ("z", "zf_xiaobei"),
}
SUPPORTED = set(VOICES)

_pipelines: dict[str, object] = {}
_lock = threading.Lock()  # KPipeline isn't safe to call concurrently
_cache: "OrderedDict[str, bytes]" = OrderedDict()
CACHE_MAX = 256


def _pipeline(lang_code: str):
    if lang_code not in _pipelines:
        from kokoro import KPipeline

        _pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
    return _pipelines[lang_code]


def warm(lang: str = "en") -> None:
    with _lock:
        _pipeline(VOICES[lang][0])


def synthesize(text: str, lang: str, speed: float = 1.0) -> bytes:
    """WAV (24 kHz mono PCM16). Repeated phrases come from an in-memory LRU cache."""
    code, voice = VOICES[lang]
    key = sha256(f"{voice}|{speed}|{text}".encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    with _lock:
        chunks = [a.numpy() for _, _, a in _pipeline(code)(text, voice=voice, speed=speed)]
    audio = np.concatenate(chunks) if chunks else np.zeros(SR // 10, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, SR, format="WAV", subtype="PCM_16")
    wav = buf.getvalue()
    _cache[key] = wav
    if len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)
    return wav
