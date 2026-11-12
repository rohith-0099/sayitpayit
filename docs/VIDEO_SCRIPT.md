# SayItPayIt — demo video script (target 2:50)

Five scenes, matching CLAUDE.md. The pay, request, split and Scam Interrupt commands were tested end to end on the
build (Nov 11–12). The cancel and add-contact lines were added on Nov 12 after live testing and were tested typed;
rehearse them once by voice before recording.
**SAY** = you speak into the app (real voice, real mic). **VO** = narration (record separately or use an AI
voiceover; allowed). Screen notes say what must be visible. Keep VO calm and short: about 150 words per minute.

The agent now speaks **one short sentence** per step (details stay on screen), with amounts as words
("fifty euros", "two dollars fifty"), so its lines below are what you'll actually hear. Total VO is ~340 words, leaving room for the app's own voice. Cut every wait in the edit (transcription,
loading); speed up the dashboard agent (it takes ~90 s live) to ~6 s.

---

## Before you record (checklist)

- [ ] `cd apps/web && npm run demo:reset` (clean history; keeps your PayPal link and Voice ID; demo user on Asia/Kolkata time).
- [ ] Guardian running (`uvicorn ... --port 8000`) so the header shows **Voice ID on** and no lite-mode banner.
      Record **locally**: the agent's voice is Kokoro (fast, unlimited). The hosted lite mode uses Gemini TTS, which the
      free tier caps at ~10 lines per model per day, so don't rehearse on the hosted site right before recording.
- [ ] Agent voice **on**: the toggle next to the "Speaking" picker reads **Voice on** (it remembers the last setting).
- [ ] No contact called **Priya** yet (only if you use the optional add-contact beat in Scene 3).
- [ ] Voice ID recorded **with your voice** at `/voice`.
- [ ] Webhooks reach the app (Render URL, or your tunnel + `npm run webhook:setup`) so John's payment flips to Done.
- [ ] Browser at 1920×1080, zoom 100%, a clean profile (no extensions/bookmarks bar). Speaking picker on **Any language**.
- [ ] Phone (or a narrow second browser window) ready to open Elena's approval link.
- [ ] A clear photo of a real restaurant receipt (total visible) saved on the desktop for the split.
- [ ] Sandbox John logged in on a second browser profile for paying his invoice.
- [ ] A second person (or a pre-recorded clip of another voice) for the cloned-voice test.
- [ ] **Verify the 13% statistic's source before using it** (see Scene 1). If you can't, use the softer line.

---

## Scene 1 — The problem (0:00–0:20)

| Time | Screen | Audio |
|---|---|---|
| 0:00 | Black, then a phone screen with a scam call ("Tax Office" calling). | **VO:** "Sending money abroad is confusing. Fees hide in exchange rates, and every app looks different." |
| 0:08 | Text on screen: *"1 in 8 payment-app users has sent money to a scammer."* (only if sourced) | **VO:** "And scammers know it: they call, they rush you, and the money is gone before anyone notices." |
| 0:15 | Cut to the SayItPayIt home screen, transcript area empty. Title card overlay: **SayItPayIt**. | **VO:** "SayItPayIt: pay anyone, anywhere, just by saying it, and the scam stops before the money leaves." |

> If the 13% figure can't be sourced, replace the 0:08 text with: *"Payment scams cost people billions every year."* and keep the same VO.

---

## Scene 2 — Pay by voice, in two languages (0:20–1:00)

| Time | Screen | Audio |
|---|---|---|
| 0:20 | Home screen. Tap the mic. The step line on the right shows **Listening**. | **SAY:** "Pay Maria fifty euros for the logo." |
| 0:24 | Transcript appears huge. Steps tick: **Understood → Guardian check (Looks safe)**. Guardian panel: "Your voice matches". | **VO:** "It understands who and how much, checks it's really my voice…" |
| 0:29 | Read-back card: *Maria receives €50.00 · exchange rate · currency conversion fee · You pay ≈ $58 · Goods & Services*. The challenge phrase appears in big chips (e.g. **blue 4 7 9 2**). Agent says: *"To send Maria fifty euros, say: blue 4 7 9 2."* | **VO:** "…and tells me exactly what Maria gets and what I pay, fees included. To confirm, I say a fresh phrase, so a recording of me can't pay." |
| 0:38 | You read the phrase shown on screen. | **SAY:** "Blue, four, seven, nine, two." *(say whatever phrase is shown)* |
| 0:41 | Step **Confirm: Phrase and voice matched → Paid**. Result card: "Done. Maria is getting €50.00." **Recent** below updates on its own. | (app voice) *"Done, Maria is getting fifty euros."* |
| 0:44 | Tap the mic again. | **SAY:** "Págale a María treinta euros por el logo." |
| 0:48 | Read-back card fully in Spanish: *Maria recibe 30,00 € · Tú pagas …*; agent says the short line in Spanish (*"Para enviarle a María treinta euros, di: …"*). | **VO:** "Same flow in Spanish: it answers in the language I speak." |
| 0:54 | Say the Spanish phrase shown (e.g. **azul 5 3 1 8**). Result: "Listo. María va a recibir 30,00 €." | **SAY:** "Azul, cinco, tres, uno, ocho." *(whatever is shown)* |
| 0:58 | Optional 2-second cut: Maria's sandbox PayPal showing the euros received. | — |

---

## Scene 3 — Request, split, and cancel (1:00–1:40)

| Time | Screen | Audio |
|---|---|---|
| 1:00 | Tap the mic. | **SAY:** "Ask John for two hundred dollars for the website." |
| 1:03 | Read-back: *John pays you $200.00 · For: the website*. Agent: *"Ask John for two hundred dollars for the website?"* | **SAY:** "Yes." |
| 1:06 | Result card with PayPal's **QR code** and "Open the PayPal invoice". **Waiting on** below shows John $200 straight away. | **VO:** "Asking for money works the same way. John gets a PayPal invoice with a QR code." |
| 1:11 | Cut to John's browser: the PayPal invoice → pay with sandbox John. | — |
| 1:16 | Back on SayItPayIt: the request in **Recent** flips to **Done** (reload once if the webhook was slow). | **VO:** "When he pays, PayPal's signed webhook marks it paid." |
| 1:19 | Click **Receipt**, attach the receipt photo, type or say the command. | **SAY:** "Split this with John and Maria." |
| 1:23 | Read-back: *Total $59.00 · John owes $19.67 · Maria owes $19.66 · Your share $19.67*. Agent: *"Split fifty-nine dollars with John and Maria?"* Confirm. | **VO:** "Snap a receipt, and Gemini reads the total and splits it, one invoice each." |
| 1:30 | Result: "Sent 2 invoices." | — |
| 1:32 | Tap the mic. | **SAY:** "Actually, close the invoice we gave Maria." |
| 1:35 | Read-back: **Cancel Maria's invoice** · $19.66. Agent: *"Cancel Maria's invoice for nineteen dollars sixty-six?"* Say "yes". Result: "Cancelled… PayPal let them know." Maria's line in **Waiting on** disappears. | **VO:** "Changing your mind is just as easy, and 'close the invoice' can never turn into a payment." |

> Note: the agent does not *say* "John paid" out loud; the paid status shows on screen (Recent list and dashboard). Don't promise a spoken "John paid" in the VO.
>
> Cancel by name only works when that person has **one** unpaid invoice; with several, the agent lists them and asks for the amount. After `demo:reset` Maria has none until the split, so this line is safe.
>
> Optional 4-second beat if you have time (e.g. replace the John-pays cut with it): **SAY** "Add Priya, priya@example.com, she's family." → card *Add Priya · Family* → "yes" → *"Added Priya."*

---

## Scene 4 — Scam Interrupt (1:40–2:20) — the wow moment

Speak slowly, slightly anxious, like an older person on a phone call.

| Time | Screen | Audio |
|---|---|---|
| 1:40 | Home screen. Tap the mic. | **SAY:** "Send five hundred dollars in gift cards to Maria. The tax office called. Don't tell anyone." |
| 1:46 | Steps: **Guardian check** turns amber: *Asking a few questions*. Gauge ≈ 69, "Needs a closer look". Signals: *Sounds like a known scam · Asks for gift cards · Claims to be the tax office · Told to keep it secret*. | **VO:** "Guardian recognises a scam pattern, so instead of paying, it asks what a careful bank would ask." |
| 1:52 | Question card (Gemini-written, wording varies), e.g. *"Did someone from the tax office call and tell you to keep this a secret?"* | **SAY:** "Yes, the officer is on the phone right now." |
| 1:57 | Second question, e.g. *"Were you asked to pay with gift cards?"* | **SAY:** "Yes, he said gift cards." |
| 2:01 | **Paused to keep you safe** card: *"Real government agencies never demand payment that way."* Agent: *"I've paused this payment and asked Elena to approve it."* | **VO:** "It pauses the payment and asks a trusted family member to check." |
| 2:06 | Phone screen: Elena's page — *"Hi Elena, Sam may be talking to a scammer"*, what Sam said, why it was paused, the questions and answers. Tap **Stop this payment**. | — |
| 2:11 | Laptop updates by itself: *"Elena stopped this payment. Nothing was sent, and your money is safe."* (spoken: *"Elena stopped this payment, and your money is safe."*) | **VO:** "Elena stops it. Nothing was sent." |
| 2:14 | Quick cut: a different person (or a recording of another voice) says "Pay Maria fifty euros for the logo." Result: **"I stopped this payment. The voice doesn't match yours."** | **VO:** "And a cloned or different voice can't pay at all." |

> Elena is the seeded trusted contact. If you changed it while rehearsing ("make Priya my trusted guardian"),
> run `npm run demo:reset` again or say "Add Elena Rivera, elena.rivera@example.com, she's my sister, and make her my guardian."
>
> Gemini writes the questions, so wording and count (2–3) vary between takes; answer "yes" naturally to scam questions. Rehearse once with `npm run test:guardian-flow` to warm everything up.

---

## Scene 5 — Dashboard and close (2:20–2:50)

| Time | Screen | Audio |
|---|---|---|
| 2:20 | Header → **Dashboard**. AG Studio "My money": Guardian shield gauge, Who owes what, Cross-border tracker, transaction grid with risk scores. | **VO:** "Everything lands in an AG Studio dashboard: Guardian's checks, who still owes me, money sent abroad and every fee." |
| 2:28 | Tap the dashboard mic. | **SAY:** "Show what I sent Maria this month." |
| 2:31 | AI panel opens; agent steps appear (*Placed new widget… Configured…*) and a new chart appears on the canvas. **Speed this section up** (~90 s live → ~6 s). | **VO:** "AG Studio's agent, running on Gemini, builds the chart live." |
| 2:38 | Architecture slide (README diagram): Voice → LangGraph agent → Guardian (voice ID, scam model) → PayPal (Vault, Orders, Payouts, Invoicing, webhooks) → AG Studio. | **VO:** "Built with PayPal's sandbox APIs, LangGraph, Gemini, Whisper, and our own Guardian models." |
| 2:45 | End card: **SayItPayIt** · "Pay anyone, anywhere, just by saying it." · GitHub URL · "Built with PayPal + AI". | **VO:** "SayItPayIt. Pay anyone, just by saying it, and stop the scam before the money leaves." |
| 2:50 | End. | — |

---

## Editing notes

- Upload to YouTube early (processing can take hours); keep it public, under 3:00.
- Captions: burn in the SAY lines (especially the Spanish one) so judges can follow without audio.
- No copyrighted music; a quiet royalty-free bed or none.
- If a take's numbers differ from the script (live exchange rate, random phrase), that's expected; never fake them.
- Show "PayPal sandbox" (header) at least once so it's clear no real money moves.
- Spare lines that also work live, if a judge-facing cut needs them: "Send 50 rupees to Maria" (PayPal can't send INR:
  nothing is charged and the card offers the same amount in dollars or euros as one-tap buttons), "Make Elena my trusted guardian".
