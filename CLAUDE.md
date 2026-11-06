# SayItPayIt — Project Brain for Claude Code

Read this file fully before doing anything. Then read `docs/PLAN.md` and work phase by phase.

## What we are building
**SayItPayIt** is a voice AI payment agent built on PayPal. Anyone can pay, request or split money with anyone in any country, in any language, just by saying it. A security layer called **Guardian** verifies the speaker's voice and stops scams before money leaves.

Pitch line: *"Pay anyone, anywhere, just by saying it, and the scam stops before the money leaves."*

Built for the **PayPal AI Hackathon 2026 (Devpost)**.
- **Deadline:** Nov 12, 2026, 12:00 PM PT (Nov 13, 1:30 AM IST). Aim to finish by Nov 12 evening IST.
- Judging criteria, equally weighted: Technological Implementation, Design, Potential Impact, Innovation, Presentation.
- Judges may not run the app. The <3 min YouTube demo video carries a lot of weight. Every feature must look great on screen.
- Target sponsor prize: **Best Use of AG Grid** (AG Studio). Also eligible: Render, APIMatic.

## Hard rules (never break)
1. **PayPal sandbox only.** Base URL `https://api-m.sandbox.paypal.com`. Never live keys.
2. **Never commit secrets.** Secrets live in `.env.local` / `.env` (gitignored). Keep `.env.example` updated with empty values. Run `git status` before every commit and confirm no env file is staged.
3. **No payment executes without explicit user confirmation.** The agent may prepare, never execute on its own. The LangGraph flow must make it impossible to skip Guardian and the confirm step.
4. **Respect open-source licenses.** Keep license files and credit every pretrained model, dataset and paper in `README.md` → "Credits". The hackathon rules require this, and missing it risks disqualification.
5. **Free tools only.** No paid APIs. The user has no budget.
6. Work in small steps. After each phase: run it, test it, fix it, then commit with a clear message. Don't move on with broken code.
7. Ask the user before deleting files, changing the stack, or doing anything irreversible.
8. Keep the public repo judge-friendly: clean structure, MIT license, a README that gets someone running in under 5 minutes.

## Tech stack (decided)
| Layer | Choice | Notes |
|---|---|---|
| Web app + agents | **Next.js (App Router, TypeScript)** in `apps/web` | UI + API routes + LangGraph.js agents + all PayPal calls |
| PayPal | REST APIs + **PayPal JS SDK v6** + **@paypal/agent-toolkit** | Payouts, Invoicing v2 (+QR), Orders v2, Vault v3, Webhooks |
| Orchestration | **LangGraph.js** | Fixed graph, see "Agent graph" |
| LLM | **Gemini Flash** via Google AI Studio (free tier) | Intent, tool calling, multilingual, receipt photos (vision), risk explanations |
| Speech-to-text | **Groq Whisper** (free tier) | Any language |
| Guardian service | **FastAPI (Python)** in `services/guardian` | Voice security + fraud ML + scam classifier. CPU only |
| Database | **Postgres** with Drizzle ORM | Local: Docker Postgres. Prod: Render Postgres |
| Dashboard | **AG Studio** (AG Grid) | Custom widgets, theming, Studio Agent Framework |
| Deploy | **Render** | Web service + Guardian service + Postgres + **Render Workflows** for background jobs |

Check current free-tier limits for Gemini and Groq before relying on them. Add retry/backoff and a clear error when rate-limited.

## Repo structure (target)
```
sayitpayit/
├── apps/
│   └── web/                 # Next.js full-stack (UI, API routes, agents, PayPal)
├── services/
│   └── guardian/            # FastAPI: voice gate, risk model, scam classifier
│       ├── app/
│       ├── training/        # scripts/notebooks to train our models
│       └── data/            # our synthetic datasets (published)
├── docs/                    # PLAN.md, architecture diagram, screenshots
├── .env.example
├── README.md
└── LICENSE (MIT)
```
Note: `apps/api/` currently holds a working `test-payout.mjs` and `.env`. In Phase 0, move the credentials into `apps/web/.env.local`, move the script to `apps/web/scripts/`, then remove `apps/api/` (ask the user first).

## PayPal sandbox setup (already done by user)
- App name: **SayItPayIt**, type Merchant, linked to the **US business** account below.
- Client ID + Secret: in the user's env file (never print them).
- First payout test already succeeded (201, John received $10).

| Role | Sandbox email | Country |
|---|---|---|
| App / merchant account | sb-ehhf553656050@business.example.com | US |
| Demo contact "John" | sb-avlzc53756906@personal.example.com | US |
| Demo contact "Maria" | sb-nipbf53756879@personal.example.com | DE (EUR) |

Ignore the default IN (India) sandbox accounts.

### Money flow (demo architecture)
1. User links PayPal **once** via Vault (JS SDK v6, one approval screen).
2. Voice command → Guardian → user confirms → app charges the vaulted PayPal (Orders v2, vault token) → app sends to recipient via **Payouts**.
3. Requests and splits → **Invoicing v2** (create, send, QR code) → webhook marks paid.

In production, holding funds between steps would need licensing. Mention this honestly in the README ("sandbox demo architecture").

"Friends & Family vs Goods & Services" is chosen by the AI and used for **fee display and labeling** in our app. Don't claim Payouts sets this on PayPal's side.

Cross-currency: if a EUR payout fails from the US business account, add a EUR balance to the sandbox business account, or convert and show the FX rate clearly.

## Features (build all)
1. **Voice pay:** "Pay Maria 50 euros for the logo." The agent resolves the contact, reads back the amount, fees and what the recipient receives, then waits for confirmation.
2. **Voice request / invoice:** "Ask John for $200 for the website." Creates a PayPal invoice (Invoicing v2) with a QR code. The message is written in the recipient's language.
3. **Split:** by voice or receipt photo (Gemini vision reads the receipt). One invoice per person. Webhooks track who paid. Friendly reminders.
4. **Contacts:** nickname → PayPal email → currency → relationship (F&F / business).
5. **Smart invoice page:** our own beautiful, branded page on top of the PayPal invoice: AI-written friendly message in the payer's language, amount in the payer's currency, QR code, PayPal pay button, status. It must look much better than PayPal's default invoice.
6. **Guardian (security + anti-scam):**
   - **Voice gate:** voiceprint match (SpeechBrain ECAPA-TDNN), deepfake check (AASIST-L), random challenge phrase ("say: blue 4 7 9") checked via Whisper.
   - **Risk model (ours):** per-user behaviour features (Fraud Detection Handbook approach) + payee-graph features (approach inspired by NVIDIA's fraud blueprint, built with networkx) → **XGBoost trained by us** on PaySim + our synthetic agent-payment data.
   - **Scam-language model (ours):** our own multilingual dataset of scam vs. normal voice commands (generated with Gemini, saved in `services/guardian/data/`), used to fine-tune a small multilingual classifier.
   - **Scam Interrupt:** when signals fire, the agent asks bank-style questions written by the LLM from the fired signals (e.g. "Is someone on the phone telling you to make this payment?").
   - **Guardian mode:** high-risk payments go on hold and a trusted family contact gets an approval link.
   - **Step-up:** passkey (WebAuthn) for big amounts.
   - Decision output: `ALLOW | ASK_QUESTIONS | GUARDIAN_HOLD | PASSKEY_REQUIRED | BLOCK`, plus a plain-language explanation.
7. **Money dashboard (AG Studio):** themed to match the app. Custom widgets: Guardian risk gauge, "who owes what" split scoreboard (friendly, not a collections report), fees-saved / cross-border tracker, transaction grid with risk scores. An **Insights agent** talks to AG Studio's built-in agents via the Studio Agent Framework ("show what I sent Maria this month" builds a widget live).

## Agent graph (LangGraph.js)
```
voice/text input
  → Intent agent        (Gemini: parse intent + entities, any language)
  → Voice gate          (Guardian /voice/verify)
  → Guardian agent      (Guardian /risk/score + /scam/classify → decision + explanation)
  → [ASK_QUESTIONS / GUARDIAN_HOLD / PASSKEY_REQUIRED branches]
  → Confirm             (read back amount, fees, recipient amount; explicit yes)
  → Payment agent       (PayPal Agent Toolkit / REST tools)
  → Respond             (voice + UI)
```
Insights agent is a separate path for dashboard questions. The graph must be deterministic about order: Guardian and Confirm can never be skipped.

## Guardian service API (FastAPI)
- `POST /voice/enroll`: store the user's voice embedding (3 samples)
- `POST /voice/verify`: speaker match + spoof score + challenge-phrase match
- `POST /risk/score`: features → XGBoost probability + top reasons
- `POST /scam/classify`: command text → scam probability + signals
- `GET /health`

## Demo video scenes (build features to make these perfect)
1. Problem (0:00–0:20): cross-border payments are confusing, and 13% of payment-app users have sent money to a scammer.
2. Pay (0:20–1:00): voice in English, then one command in another language (e.g. Spanish/Malayalam). Read-back, confirm, Maria receives EUR.
3. Request + split (1:00–1:40): smart invoice with QR, John pays, webhook fires, the agent says "John paid".
4. **Scam Interrupt (1:40–2:20), the wow moment:** an elderly user says "Send $500 in gift cards, the tax office called." The agent blocks it, asks bank-style questions, and Guardian mode pings the family. Also show a cloned-voice attempt rejected.
5. Dashboard + close (2:20–2:55): AG Studio widgets built live by voice. Architecture slide. "Built with PayPal + AI."

## Credits (must appear in README)
SpeechBrain ECAPA-TDNN (Apache 2.0), AASIST / AASIST-L (Clova AI; check its license), PaySim dataset, Fraud Detection Handbook (approach), NVIDIA Financial Fraud Detection Blueprint (approach), PayPal Agent Toolkit, AG Studio boilerplate, LangGraph, Groq Whisper, Gemini.

## Useful links
- PayPal sandbox starter: https://github.com/paypaldev/getting-started-with-paypal-sandbox
- PayPal Agent Toolkit: https://github.com/paypal/agent-toolkit
- PayPal AI docs: https://docs.paypal.ai/
- PayPal JS SDK v6: https://developer.paypal.com/sdk/js/
- AG Studio + PayPal boilerplate: https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate
- AG Studio docs: https://www.ag-grid.com/studio/react/quick-start/ , custom widgets: https://www.ag-grid.com/studio/react/custom-widgets/ , agents: https://www.ag-grid.com/studio/react/ai-agents/
- Render Workflows: https://render.com/docs/workflows
- SpeechBrain ECAPA: https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb
- AASIST: https://github.com/clovaai/aasist
- Fraud Detection Handbook: https://github.com/fraud-detection-handbook/fraud-detection-handbook

Always check the latest docs for exact API shapes (JS SDK v6, Vault v3, Agent Toolkit, AG Studio, Render Workflows). They change, so don't guess.
