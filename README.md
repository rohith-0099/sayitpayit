# SayItPayIt

**Pay anyone, anywhere, just by saying it, and the scam stops before the money leaves.**

[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
![PayPal sandbox](https://img.shields.io/badge/PayPal-sandbox%20only-black)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)

<!-- Add a screenshot or demo GIF here, e.g. the read-back card or the Scam Interrupt:
![SayItPayIt read-back and Scam Interrupt](docs/screenshot.png) -->

Say *"Pay Maria 50 euros for the logo"* in English, Spanish or another language. SayItPayIt understands the command, and its **Guardian** layer checks your voice and the payment for scam signs. It reads back exactly what Maria receives and what you pay (exchange rate and fees included). Nothing moves until you confirm by saying a fresh random phrase in your own voice, so a recording of you can't pay.

Everything runs on the **PayPal sandbox**. No real money moves.

## Quick start

You need Docker, free keys from [Google AI Studio](https://aistudio.google.com/) (Gemini) and [Groq](https://console.groq.com/), and a PayPal **sandbox** app with Payouts, Invoicing, Transaction Search and Vault enabled ([developer.paypal.com](https://developer.paypal.com/)).

```bash
git clone https://github.com/rohith-0099/sayitpayit.git && cd sayitpayit
cp .env.example apps/web/.env.local       # add the PayPal sandbox, Gemini and Groq keys
docker compose --profile full up --build  # open http://localhost:3000
```

This starts Postgres, the Guardian ML service and the web app. The first build takes about 15 minutes, because it trains the scam classifier and downloads the voice models. Later starts are quick. Then link a sandbox PayPal at `/link` and set up Voice ID at `/voice`.

## What it does

- **Voice pay.** It reads back the exchange rate, PayPal's published fees and exactly what the recipient gets, and charges exactly what you heard.
- **Request and split.** "Ask John for 200 dollars for the website" creates a PayPal invoice with a QR code. You can snap a receipt and Gemini reads the total, then it sends one invoice per person.
- **Any language.** It replies in the language you spoke. Spanish is solid, and Malayalam, Tamil and Hindi work with the language picker.
- **Voice ID.** Speaker verification runs on every spoken command, and payments need a fresh random phrase said in your voice.
- **Scam Interrupt.** Scam-sounding payments get bank-style questions. Honest answers continue; scam answers put the payment **on hold** for a trusted family member, who approves or stops it from a link.
- **Money dashboard.** Custom AG Studio widgets and a transaction grid with Guardian's risk score. Ask "show what I sent Maria this month" and the chart builds live.

## How it works

```mermaid
flowchart LR
  user([Voice or text]) --> stt[Groq Whisper<br/>speech-to-text]
  stt --> agent
  subgraph agent [LangGraph agent: fixed order, Guardian and Confirm can't be skipped]
    direction LR
    intent[Intent<br/>Gemini] --> resolve[Resolve contact] --> gate[Voice gate] --> check[Guardian check]
    check -->|scam signs| questions[Scam Interrupt<br/>Gemini questions]
    questions -->|unsafe| hold[Family hold<br/>approval link]
    questions -->|safe| readback
    hold -->|approved| readback
    check -->|ok| readback[Read-back<br/>FX + fees]
    readback --> confirm[Confirm<br/>yes / spoken phrase] --> execute[Execute]
  end
  gate & check -.-> guardian[Guardian service, FastAPI on CPU<br/>ECAPA voice ID · AASIST-L · our scam classifier · Kokoro TTS]
  execute --> paypal[PayPal sandbox<br/>Orders v2 + Vault v3 · Payouts · Invoicing v2]
  paypal -->|signed webhooks| db[(Postgres)]
  execute --> db
  db --> dash[AG Studio dashboard<br/>custom widgets + Gemini agent]
```

The agent is a fixed LangGraph.js graph, so Guardian and the confirmation step are part of the structure, not instructions in a prompt. **No payment can skip them.**

- `apps/web`: Next.js 16 (App Router, TypeScript): UI, API routes, the LangGraph.js agent, all PayPal calls.
- `services/guardian`: FastAPI (Python, CPU): `/voice/enroll`, `/voice/verify`, `/scam/classify`, `/tts`, `/health`.
- Postgres with Drizzle ORM; LangGraph checkpoints in Postgres, so a pending confirmation survives a restart.

<details>
<summary><b>How PayPal is used</b></summary>

- **Vault v3 + JS SDK v6**: link your PayPal once ("Save PayPal", no purchase). The payment token never reaches the browser.
- **Orders v2** with the vaulted token: charges you, with no popup, exactly the read-back total.
- **Payouts**: pays the recipient in their currency; if the payout fails after the charge, the charge is refunded automatically.
- **Invoicing v2**: requests and split shares, with PayPal's QR code.
- **Webhooks**: every event signature-verified with PayPal before it touches the database (invoice paid, payout item succeeded/failed), idempotent by event id.
- **Transaction Search** for activity.

Sandbox demo architecture: funds pass through the merchant account between the charge and the payout. Doing
this in production would need money-transmission licensing. "Friends & Family vs Goods & Services" is our
label for fee display; Payouts doesn't set it on PayPal's side.

</details>

<details>
<summary><b>How AI is used</b></summary>

- **Gemini** (free tier, `gemini-3.5-flash-lite` with fallbacks): intent from any language, receipt photos, translations, Scam Interrupt questions and verdicts, and AG Studio's agent loop (function calling through our adapter).
- **Groq Whisper** (`whisper-large-v3-turbo`): speech-to-text.
- **Our models**: a multilingual scam-command classifier we fine-tuned on a dataset we generated (1,600 commands, 8 languages, 10 scam tactics + hard negatives: `services/guardian/data/scam_commands.jsonl`, metrics in `docs/metrics/scam_classifier.json`), and Voice ID with SpeechBrain ECAPA.
- **LangGraph.js**: the agent is a fixed graph, so Guardian and the confirmation are structural, not prompts.

</details>

## Results

The multilingual scam-command classifier was fine-tuned from `paraphrase-multilingual-MiniLM-L12-v2` on a dataset we generated: 1,600 commands across 8 languages, covering 10 scam tactics plus hard negatives.

| Test set | Precision | Recall | F1 |
|---|---|---|---|
| 219 held-out commands, 8 languages | 0.954 | 1.000 | 0.976 |

The data is synthetic (Gemini-generated), so real-world accuracy will be lower. That's why the classifier is one Guardian signal among several, not the only check. The full metrics, including per-language scores, are in [`docs/metrics/scam_classifier.json`](docs/metrics/scam_classifier.json).

## Limitations

- Sandbox only, single demo user (no sign-up).
- The scam classifier is trained on synthetic (Gemini-generated) data: real-world accuracy will be lower than the reported test scores, so it is one Guardian signal, not the only one.
- AASIST-L (trained on ASVspoof 2019) misfires on real microphones, so it only raises a weak signal; the random spoken phrase is the real anti-replay check.
- Whisper's language auto-detect is reliable for English/Spanish; other languages need the picker.
- The family approval link is shown on screen in the demo; production would send it by SMS.
- Planned but cut for time: an XGBoost risk model on PaySim, passkey step-up, hands-free wake word.

## Development

You need Node 22+, Python 3.12 with [uv](https://docs.astral.sh/uv/), and Docker.

```bash
# 1. Database + web app
docker compose up -d
cd apps/web && cp ../../.env.example .env.local   # fill in the keys
npm install && npm run db:migrate && npm run db:seed && npm run dev   # http://localhost:3000

# 2. Guardian (optional: without it the app runs in lite mode)
cd services/guardian && uv venv --python 3.12 .venv
uv pip install --python .venv --index-url https://download.pytorch.org/whl/cpu torch torchaudio
uv pip install --python .venv -r requirements.txt
.venv/bin/python training/scam_classifier.py      # ~4 min on CPU, builds the scam model
.venv/bin/uvicorn app.main:app --port 8000

# 3. Open http://localhost:3000/link and link a sandbox PayPal, then /voice to set up Voice ID.
```

Without the Guardian service, the app runs in **lite mode**: Guardian's built-in rules, Gemini TTS or the browser voice, and a banner. `render.yaml` deploys this lite mode free on Render with a Neon Postgres. Every payment there still goes through Guardian and waits for your yes.

Tests: `npm test` (web), `.venv/bin/python -m pytest` (Guardian), `npm run test:guardian-flow` (Scam Interrupt end to end).

## Credits

Pretrained models, datasets, libraries and approaches this project uses, with their licenses:

| What | Used for | License |
|---|---|---|
| [PayPal REST APIs, JS SDK v6](https://developer.paypal.com/) (`@paypal/paypal-js`) | Payouts, Invoicing v2, Orders v2, Vault v3, webhooks | PayPal developer terms; SDK Apache-2.0 |
| [SpeechBrain ECAPA-TDNN](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) (`speechbrain/spkrec-ecapa-voxceleb`) | Speaker verification (Voice ID) | Apache-2.0 |
| [AASIST / AASIST-L](https://github.com/clovaai/aasist), Copyright (c) 2021-present NAVER Corp. Jung et al., ICASSP 2022 | Replay/synthetic-voice signal (code + weights vendored in `services/guardian/app/voice/aasist/` with LICENSE and NOTICE) | MIT |
| [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) (sentence-transformers) | Base model we fine-tuned into the scam-command classifier | Apache-2.0 |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad, with [misaki](https://github.com/hexgrad/misaki) G2P | The agent's spoken voice (`af_heart`, `ef_dora`, ...) | Apache-2.0 |
| [phonemizer-fork](https://pypi.org/project/phonemizer-fork/) and [eSpeak NG](https://github.com/espeak-ng/espeak-ng) (via `espeakng-loader`) | Pronunciation fallback inside Kokoro (runtime dependencies installed from PyPI, not distributed in this repo) | GPL-3.0 |
| [spaCy](https://spacy.io/) `en_core_web_sm` | English text processing inside Kokoro | MIT |
| [Gemini](https://ai.google.dev/) (Google AI Studio, free tier) | Intent parsing in any language, receipt photos, translations, TTS fallback | Gemini API terms |
| [Groq](https://groq.com/) Whisper `whisper-large-v3-turbo` (OpenAI Whisper weights) | Speech-to-text | Groq terms; Whisper MIT |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | The agent's fixed, auditable flow (Guardian and Confirm can't be skipped) | MIT |
| [Motion](https://motion.dev/) (`motion`, formerly Framer Motion) | UI animations: the agent flow, read-back card, Guardian gauge | MIT |
| [Frankfurter](https://frankfurter.dev/) (ECB reference rates) | Indicative FX for read-backs | Free, no key |
| [Noto Sans](https://fonts.google.com/noto), Bricolage Grotesque, Lexend (Google Fonts) | UI type in every script | SIL OFL 1.1 |
| [Fraud Detection Handbook](https://github.com/fraud-detection-handbook/fraud-detection-handbook) | Approach for Guardian's per-user behaviour signals (new payee, amount spike, unusual hour) | Approach only |
| [NVIDIA Financial Fraud Detection Blueprint](https://build.nvidia.com/nvidia/financial-fraud-detection) | Inspiration for payee-based signals (first payment to a payee) | Approach only |
| [AG Studio](https://www.ag-grid.com/studio/) 3.1 (`ag-studio`, `ag-studio-react`), AG Grid | Money dashboard, custom widgets, Studio AI agent (our Gemini adapter) | AG Studio: commercial (hackathon/trial); AG Grid community: MIT |
| [PayPal + AG Studio hackathon boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) | Reference for wiring Studio (theme, data sources, AI harness); our code is written from it, not copied | No license stated |

## License

MIT, see [LICENSE](LICENSE). Third-party components keep their own licenses (above).
