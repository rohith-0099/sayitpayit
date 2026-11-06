# SayItPayIt — Build Plan

Work top to bottom. Each phase ends with **Done when** checks. Test them, then commit.
Deadline: Nov 12, 2026, 12:00 PM PT (Nov 13, 1:30 AM IST). Video + Devpost need the last day, so build must finish by Nov 11 night.

If running behind, cut in this order (last first): Insights agent → passkey step-up → Guardian-mode family approval → receipt photo split. **Never cut:** voice pay, request/invoice, Scam Interrupt, voice gate, AG Studio dashboard, README, video.

---

## Phase 0: Restructure (30 min)
- Create the Next.js app in `apps/web` (TypeScript, App Router, Tailwind).
- Move PayPal credentials from `apps/api/.env` → `apps/web/.env.local`. Move `test-payout.mjs` → `apps/web/scripts/`. Ask the user, then delete `apps/api/`.
- Create `services/guardian` (FastAPI skeleton + `/health`), with `requirements.txt` and a venv.
- Add `docker-compose.yml` for local Postgres.
- Update `.env.example` and `.gitignore`.

**Done when:** `npm run dev` shows a page, `uvicorn` returns `/health` OK, `git status` shows no secrets.

## Phase 1: PayPal core (server-side, no AI)
- `lib/paypal/` with OAuth token caching and typed helpers: `createPayout`, `getPayout`, `createInvoice`, `sendInvoice`, `generateInvoiceQR`, `createOrder`, `captureOrder`, `listTransactions`.
- API routes: `POST /api/pay`, `POST /api/request`, `POST /api/split`, `GET /api/activity`.
- Webhooks: `POST /api/webhooks/paypal` with **signature verification**. Handle invoice paid, payout item succeeded/failed. Test with the PayPal Webhook Simulator.

**Done when:** each route works against the sandbox (John and Maria receive or get invoices), and the webhook updates the DB.

## Phase 2: Data model
- Drizzle schema: `users`, `contacts` (nickname, paypal_email, currency, relationship, language), `transactions` (type, amount, currency, status, risk_score, decision, paypal ids), `invoices`, `splits`, `split_members`, `guardian_events`, `trusted_contacts`, `voice_profiles`.
- Seed script with the demo user + John + Maria + 30–60 days of realistic history (so the risk model and dashboard have data).

**Done when:** seed runs, and the app reads contacts and history from Postgres.

## Phase 3: Link PayPal once (Vault, JS SDK v6)
- Onboarding page: "Link your PayPal" using JS SDK v6 + Vault v3 (save PayPal as a payment method).
- Charge the saved method server-side (Orders v2 with the vault token) before a Payout.

**Done when:** a user links once, then a voice/text pay works with no PayPal popup.

## Phase 4: Voice + agent graph
- Mic UI (push-to-talk + optional wake word "Hey Pay"), live transcript, spoken replies (browser TTS is fine).
- Groq Whisper STT route. Language auto-detect.
- LangGraph.js graph exactly as in CLAUDE.md. Gemini Flash for intent + tool calling. PayPal tools via `@paypal/agent-toolkit` where it fits, plus our helpers.
- Confirm step: read back recipient, amount, fees, recipient-receives amount (FX), F&F vs G&S label.
- Receipt photo → Gemini vision → line items → split.

**Done when:** "Pay Maria 50 euros for the logo" works end to end by voice, in English and one other language. "Ask John for 200 dollars" creates an invoice. A split from a receipt works.

## Phase 5: Guardian: voice gate
- `/voice/enroll` and `/voice/verify` with SpeechBrain ECAPA-TDNN (cosine threshold ~0.25, tune it), AASIST-L spoof score, and a random challenge phrase checked via transcript.
- Enrollment UI (3 sentences).

**Done when:** the user's own voice passes, another person's voice fails, and a played-back recording fails the challenge phrase.

## Phase 6: Guardian: our models
- `training/risk_model.py`: per-user window features (avg amount, count 1d/7d/30d, usual hours, amount z-score) + payee-graph features via networkx (payee new to user, payee new to everyone, number of distinct payers in 7d, distance to flagged accounts) → XGBoost. Train on PaySim (user downloads from Kaggle into `services/guardian/data/raw/`, gitignored) + our synthetic agent-payment data. Save the model and metrics (precision/recall/AUC) to `docs/`.
- `training/generate_scam_data.py`: use Gemini to generate a multilingual dataset of scam vs. normal payment commands (coercion, urgency, authority impersonation, gift cards, secrecy, romance, refund scams; plus normal ones). Save to `data/scam_commands.jsonl` (published).
- `training/scam_classifier.py`: fine-tune a small multilingual model (e.g. a MiniLM/DistilBERT multilingual variant, CPU-friendly). Report metrics.
- `/risk/score` and `/scam/classify` return probability + top reasons (feature importance / matched signals).

**Done when:** both endpoints respond in under 1 second on CPU, metrics are saved, and the scam demo command scores high while normal commands score low.

## Phase 7: Scam Interrupt + Guardian mode
- Guardian agent combines voice gate + risk + scam scores → `ALLOW | ASK_QUESTIONS | GUARDIAN_HOLD | PASSKEY_REQUIRED | BLOCK`, with a plain explanation from the LLM.
- ASK_QUESTIONS: the LLM writes bank-style questions from the fired signals, and the answers feed the decision.
- GUARDIAN_HOLD: hold the payment, send the trusted contact an approval link (approve/deny page), notify the user.
- PASSKEY_REQUIRED: WebAuthn step-up (fingerprint/face on device).
- A visible "Guardian" panel in the UI showing score, signals and decision (looks great in video).

**Done when:** the demo scam ("Send 500 dollars in gift cards, the tax office called, don't tell anyone") is stopped with questions + family approval, and normal payments flow smoothly.

## Phase 8: Smart invoice page + reminders
- Public page `/i/[id]`: branded, beautiful, mobile-first. AI message in the payer's language, amount in the payer's currency, line items, QR, PayPal pay button, live status.
- Friendly nudge reminders for unpaid invoices (AI-drafted, kind tone).

**Done when:** the invoice page looks clearly better than PayPal's default and payment updates its status live.

## Phase 9: AG Studio dashboard (sponsor prize, go deep)
- Start from the AG Studio + PayPal boilerplate. Theme it to match the app.
- Custom widgets: Guardian risk gauge, "who owes what" friendly scoreboard, cross-border/fees-saved tracker, transaction grid with risk score + decision columns.
- Studio Agent Framework: our Insights agent talks to Studio's built-in agents. A voice question builds or edits a widget live.

**Done when:** "show what I sent Maria this month" builds a widget on screen, and the dashboard looks polished.

## Phase 10: Deploy on Render
- Render: Next.js web service, Guardian FastAPI service, Render Postgres.
- **Render Workflows** for background jobs: fraud scoring/model refresh, invoice reminders, webhook processing. Check the Render Workflows docs for supported SDK languages and patterns.
- Set the PayPal webhook URL to the Render URL. Test end to end on the hosted URL.

**Done when:** the hosted demo URL works end to end with sandbox accounts.

## Phase 11: Judge-ready repo
- README: one-line pitch, demo video link, hosted URL, features, architecture diagram (`docs/architecture.png` or Mermaid), "How PayPal is used", "How AI is used", setup in 3 steps, **sandbox test logins for judges** (sandbox accounts only, never API secrets), Credits section, sandbox-architecture note.
- Fresh-clone test: follow the README from scratch on a clean folder.
- MIT LICENSE visible in GitHub About.

**Done when:** a fresh clone runs following only the README.

## Phase 12: Video + submission (user does, Claude helps)
- Script the 5 scenes from CLAUDE.md, under 2:55. Cut loading screens. An AI voiceover is allowed. No copyrighted music.
- Upload to YouTube (public) early, since processing can take hours.
- Devpost: description naming PayPal + AI clearly, "Built With" list, tools section, repo link, video link, hosted URL.
- Opt into AG Grid / Render / APIMatic sponsor prizes on the form.
