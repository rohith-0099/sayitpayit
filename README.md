# SayItPayIt

**Pay anyone, anywhere, just by saying it, and the scam stops before the money leaves.**

A voice AI payment agent on PayPal. Say "Pay Maria 50 euros for the logo" in any language: the agent
understands it, Guardian checks your voice and the payment for scam signs, it reads back exactly what
Maria receives and what you pay, and nothing moves until you confirm.

Built for the PayPal AI Hackathon 2026. **PayPal sandbox only**: no real money moves.

> Full setup guide, architecture and demo video: coming in the final README (see `docs/PLAN.md` for status).

## Sandbox demo architecture

You link PayPal once (Vault). A confirmed payment charges your vaulted PayPal (Orders v2), then pays the
recipient with PayPal Payouts. Holding funds between those two steps is fine in a sandbox demo; doing it
in production would need money-transmission licensing. "Friends & Family" vs "Goods & Services" is our
label for fee display; Payouts doesn't set it on PayPal's side.

## Credits

Pretrained models, datasets, libraries and approaches this project uses, with their licenses:

| What | Used for | License |
|---|---|---|
| [PayPal REST APIs, JS SDK v6](https://developer.paypal.com/) (`@paypal/paypal-js`) | Payouts, Invoicing v2, Orders v2, Vault v3, webhooks | PayPal developer terms; SDK Apache-2.0 |
| [SpeechBrain ECAPA-TDNN](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) (`speechbrain/spkrec-ecapa-voxceleb`) | Speaker verification (Voice ID) | Apache-2.0 |
| [AASIST / AASIST-L](https://github.com/clovaai/aasist), Copyright (c) 2021-present NAVER Corp. Jung et al., ICASSP 2022 | Replay/synthetic-voice signal (code + weights vendored in `services/guardian/app/voice/aasist/` with LICENSE and NOTICE) | MIT |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad, with [misaki](https://github.com/hexgrad/misaki) G2P | The agent's spoken voice (`af_heart`, `ef_dora`, ...) | Apache-2.0 |
| [phonemizer-fork](https://pypi.org/project/phonemizer-fork/) and [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (via `espeakng-loader`) | Pronunciation fallback inside Kokoro (runtime dependencies installed from PyPI, not distributed in this repo) | GPL-3.0 |
| [spaCy](https://spacy.io/) `en_core_web_sm` | English text processing inside Kokoro | MIT |
| [Gemini](https://ai.google.dev/) (Google AI Studio, free tier) | Intent parsing in any language, receipt photos, translations, TTS fallback | Gemini API terms |
| [Groq](https://groq.com/) Whisper `whisper-large-v3-turbo` (OpenAI Whisper weights) | Speech-to-text | Groq terms; Whisper MIT |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | The agent's fixed, auditable flow (Guardian and Confirm can't be skipped) | MIT |
| [Frankfurter](https://frankfurter.dev/) (ECB reference rates) | Indicative FX for read-backs | Free, no key |
| [Noto Sans](https://fonts.google.com/noto), Bricolage Grotesque, Lexend (Google Fonts) | UI type in every script | SIL OFL 1.1 |
| [PaySim](https://www.kaggle.com/datasets/ealaxi/paysim1) (Lopez-Rojas et al.) | Training data for our risk model (Phase 6) | CC BY-SA 4.0 |
| [Fraud Detection Handbook](https://github.com/fraud-detection-handbook/fraud-detection-handbook) | Approach for per-user behaviour features (Phase 6) | Approach only |
| [NVIDIA Financial Fraud Detection Blueprint](https://build.nvidia.com/nvidia/financial-fraud-detection) | Approach for payee-graph features (Phase 6) | Approach only |
| [AG Studio / AG Grid](https://www.ag-grid.com/studio/) + PayPal boilerplate | Money dashboard (Phase 9) | Per AG Grid license |

## License

MIT, see [LICENSE](LICENSE). Third-party components keep their own licenses (above).
