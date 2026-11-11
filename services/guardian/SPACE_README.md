---
title: SayItPayIt Guardian
emoji: 🛡️
colorFrom: indigo
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Voice ID, scam-language model and voice for SayItPayIt
---

# SayItPayIt Guardian

The ML service behind [SayItPayIt](https://github.com/rohith-0099/sayitpayit)'s Guardian: speaker verification
(SpeechBrain ECAPA-TDNN), a replay/synthetic-voice signal (AASIST-L), our multilingual scam-command classifier
and Kokoro-82M text-to-speech. CPU only. Endpoints: `GET /health`, `POST /voice/enroll`, `POST /voice/verify`,
`POST /scam/classify`, `POST /tts`. Calls require the `X-Guardian-Key` header.

See the main repo's README for credits and licenses.
