"""Download every pretrained model Guardian needs, with retries (used by the Docker build).

Hugging Face downloads occasionally fail mid-transfer on build machines; one flaky request shouldn't
fail the whole deploy.
"""

import sys
import time

from huggingface_hub import snapshot_download

REPOS = [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",  # base for our scam classifier
    "speechbrain/spkrec-ecapa-voxceleb",  # Voice ID
    "hexgrad/Kokoro-82M",  # agent voice
]

for repo in REPOS:
    for attempt in range(1, 7):
        try:
            path = snapshot_download(repo)
            print(f"ok   {repo} -> {path}")
            break
        except Exception as e:  # network errors vary by transport
            wait = min(60, 5 * 2 ** (attempt - 1))
            print(f"try {attempt} failed for {repo}: {type(e).__name__}: {str(e)[:160]}; retrying in {wait}s", flush=True)
            time.sleep(wait)
    else:
        sys.exit(f"could not download {repo}")
