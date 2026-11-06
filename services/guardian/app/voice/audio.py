"""Decode browser audio (WebM/Opus, WAV, ...) to 16 kHz mono float32 with PyAV (bundled FFmpeg)."""

import io

import av
import numpy as np

SR = 16_000


class AudioError(ValueError):
    pass


def load_audio(data: bytes) -> np.ndarray:
    try:
        with av.open(io.BytesIO(data)) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise AudioError("no audio stream")
            resampler = av.AudioResampler(format="flt", layout="mono", rate=SR)
            chunks = []
            for frame in container.decode(stream):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            for out in resampler.resample(None):  # flush
                chunks.append(out.to_ndarray().reshape(-1))
    except AudioError:
        raise
    except Exception as e:  # corrupt/unsupported input
        raise AudioError(f"could not decode audio: {e}") from e
    if not chunks:
        raise AudioError("empty audio")
    return np.concatenate(chunks).astype(np.float32)


def trim_silence(wav: np.ndarray, frame_ms: int = 30, rel_db: float = -35.0) -> np.ndarray:
    """Cut leading/trailing frames quieter than `rel_db` below the loudest frame."""
    n = int(SR * frame_ms / 1000)
    if len(wav) < n * 3:
        return wav
    frames = wav[: len(wav) // n * n].reshape(-1, n)
    rms = np.sqrt((frames**2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms / rms.max())
    voiced = np.where(db > rel_db)[0]
    if len(voiced) == 0:
        return wav[:0]
    return wav[voiced[0] * n : (voiced[-1] + 1) * n]


def speech_seconds(wav: np.ndarray) -> float:
    return len(trim_silence(wav)) / SR
