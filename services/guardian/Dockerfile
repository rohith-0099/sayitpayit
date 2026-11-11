# Guardian service image: Render (render.yaml, 1 CPU / 2 GB) or locally via docker compose --profile full.
# Voice ID (ECAPA), AASIST-L, our scam classifier and Kokoro TTS, all CPU-only.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/home/user/.cache/huggingface
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# CPU torch first (much smaller than the CUDA build), then the rest.
COPY --chown=user requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio \
 && pip install -r requirements.txt

COPY --chown=user . .
USER user

# Bake the models into the image so a cold start doesn't download them:
#  - train our scam classifier from the published dataset (~4 min on CPU)
#  - fetch ECAPA (speaker), Kokoro (voice, en + es) once
RUN python training/scam_classifier.py --epochs 4 \
 && python -c "from app.voice import speaker; speaker.load()" \
 && python -c "from app import tts; tts.warm('en'); tts.warm('es')"

EXPOSE 7860
# Render sets $PORT; locally (docker compose) it's 7860. GUARDIAN_API_KEY is required when hosted.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
