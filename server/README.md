# CallPilot

Make real phone calls from a web app, with two modes:

- **I'll talk**: you dial from the app (laptop or phone browser). Both sides are transcribed live and Claude shows you what to say next. You get a summary when you hang up.
- **AI makes the call**: you type a number and a goal. The AI agent ("Pilot") places the call, introduces itself as an AI assistant calling for you, handles the conversation and phone menus, **asks you questions in the app when it needs a decision**, and lets you **join the call** at any moment. You get a transcript and summary.

Stack: Twilio (phone line + browser calling), Deepgram (live transcription, voice agent, voice), Claude (suggestions, the agent's brain, summaries). Node 20.12+ with one dependency.

---

## 1. Accounts and keys (about 20 minutes)

### Twilio — console.twilio.com
1. Create an account and **upgrade it** (Billing → add $20). Trial accounts play a "trial account" message and can only call numbers you have verified.
2. **Buy a phone number** with Voice: Phone Numbers → Buy a number (~$1.15/month). This is `TWILIO_PHONE_NUMBER`.
3. **Create an API key**: Account → API keys & tokens → Create API key → Standard. Copy the SID (`SK...`) and Secret. These are `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET`.
4. **Create a TwiML App**: Voice → Manage → TwiML apps → Create. Name it CallPilot and leave the URL empty for now (step 3 fills it in automatically). Copy its SID (`AP...`) into `TWILIO_TWIML_APP_SID`.
5. Copy your **Account SID** and **Auth Token** from the console home page.
6. Optional: to show **your own cell number** as caller ID, verify it under Phone Numbers → Verified Caller IDs and set `TWILIO_CALLER_ID`.

### Deepgram — console.deepgram.com
Create an API key (new accounts get free credit). This one key covers transcription, the voice agent, and the agent's Claude brain (Deepgram bills it).

### Anthropic — console.anthropic.com
Create an API key for live suggestions and summaries.

### ngrok — ngrok.com
Twilio needs a public HTTPS address for your laptop. Install ngrok, run `ngrok config add-authtoken <token>`, and claim your **free static domain** in the ngrok dashboard (Domains) so the URL doesn't change between restarts.

## 2. Install and configure

```bash
cd callpilot
npm install
cp .env.example .env      # then fill in every value
```

Set `PUBLIC_HOST` to your ngrok domain (no `https://`) and pick an `APP_PASSCODE`.

## 3. Run

Terminal 1:
```bash
ngrok http --url=YOUR-DOMAIN.ngrok-free.app 5050
```
Terminal 2:
```bash
npm start
```
Terminal 3 (once):
```bash
npm run check -- --fix
```
The check verifies every key against the real services, confirms your number and caller ID, checks the agent model, tests the public URL, and points the TwiML App at your server. Fix anything it marks with ✘.

Open `https://YOUR-DOMAIN.ngrok-free.app` on your laptop or phone, enter the passcode, and allow microphone access. The top bar turns to **Ready to call**.

## 4. Rehearse (do this before the client call)

1. **I'll talk:** call your own cell from the app. Speak on both ends and watch the transcript and the "Say next" card.
2. **AI makes the call:** call your cell with a goal like "Book a table for 2 at 7pm Friday". Answer as the restaurant, offer a different time, and watch the agent's question pop up in the app. Answer it, then press **Join the call**.
3. Try saying "press 1 for reservations" to see it press keys, and hang up to see the summary.

## Demo checklist

- [ ] Account upgraded (no trial message)
- [ ] `npm run check` passes
- [ ] Laptop plugged in and set not to sleep; ngrok and `npm start` running
- [ ] Headset or earbuds for "I'll talk" mode (prevents echo into the transcript)
- [ ] Browser tab open and showing **Ready to call**
- [ ] One rehearsal call of each mode done today
- [ ] Demo calls go to a number you control or a friendly business

## How it works

```
Browser (Twilio Voice SDK)                Twilio                     This server                     AI
"I'll talk":  mic ── WebRTC ──>  TwiML App ──> /twilio/outgoing
                                  <Start><Stream both_tracks> ───> /streams/listen ──> Deepgram STT ×2 (you, them)
                                  <Dial callerId> ──> PSTN                             └─> Claude: "say next" + summary
"AI makes the call":  POST /api/sessions ──> Twilio REST create call
                                  <Connect><Stream> (2-way) ─────> /streams/agent  <──> Deepgram Voice Agent
                                                                    tools: ask_owner,         (Flux STT, Claude, Flux TTS,
                                                                    press_digits, finish_call  barge-in)
"Join the call":  REST update ──> <Dial><Client> your browser + transcription continues
```

- The agent always opens with a fixed line: *"Hi, this is Pilot, an AI assistant calling on behalf of Mk. This call is being transcribed."* It never claims to be human.
- Guardrails in the agent prompt: no payments, cancellations or sign-ups without your yes; no SSN, card or bank numbers; reads back details before hanging up; asks you when anything falls outside the brief.
- Call history and summaries are saved to `data/calls.json`.

## Costs (approximate, US)

| Item | Cost |
| --- | --- |
| Twilio outbound call | ~$0.014/min (+ ~$0.004/min for the browser leg) |
| Twilio phone number | ~$1.15/month |
| Deepgram live transcription (copilot, two sides) | ~$0.01–0.02/min |
| Deepgram voice agent incl. Claude Haiku | ~$0.08/min |
| Claude suggestions + summary | a few cents per call |


## Run it in the cloud (no PC needed)

The repo includes a `Dockerfile` and `render.yaml`.

1. Put this folder in a GitHub repo.
2. On [render.com](https://render.com): **New → Blueprint**, pick the repo. Render reads `render.yaml`.
3. Fill in the secrets it asks for (same values as your `.env`). The blueprint uses the **free** plan: it sleeps after ~15 idle minutes, and the phone app wakes it when you open it (30–60 s). Calls in progress keep it awake, and the app keeps its own copy of every call, so the server forgetting its history while asleep doesn't matter. For always-on with no wait, switch to **Starter** (~$7/month) in Render's settings.
4. Deploy. The server detects its Render address and points your Twilio TwiML App at itself on every start.
5. In the phone app: Settings → Calling → `https://<your-service>.onrender.com` + your passcode.

Railway and Fly.io work too (the Dockerfile is generic; the public host name is detected from their environment variables).

## Phone app

The ToDo Android app (repo `todo`) has a Calls tab and a smart voice button that use this server. See `CALLING.md` in that repo.

## Security

- **Passcode login** (browser cookie, or a bearer token for the phone app). 8 tries per 10 minutes per address. Changing `APP_PASSCODE` signs every device out.
- **Twilio webhook signatures** are verified (`X-Twilio-Signature`); unsigned requests to `/twilio/*` get 403. `TWILIO_VALIDATE=log` only logs, `off` disables (not recommended).
- **Media streams** are only accepted from the call that the session belongs to.
- **Secrets never leave the server** and are redacted from logs. Security headers and a content-security policy are sent on every page.

## Cost guards

| Setting | Default | What it does |
| --- | --- | --- |
| `MAX_CALLS_PER_DAY` | 60 | Refuses new calls past this many in 24 hours |
| `MAX_CALL_MINUTES` | 30 | Hard time limit on every call (AI and you-talk) |

Short calls are summarized with the fast Claude model; longer ones with the smart model. The voice assistant and live suggestions use the fast model.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Top bar says "Phone line not set up" | API key, secret or TwiML App SID wrong; run `npm run check` |
| Call fails right away with code 21210/21212 | Caller ID is not your Twilio number or a Verified Caller ID |
| You hear "trial account" | Upgrade the Twilio account |
| Call connects but no transcript | `PUBLIC_HOST` doesn't match the ngrok domain, or the server was restarted under a new ngrok URL; rerun `npm run check -- --fix` |
| Agent is silent | Check the server log for "Agent error"; confirm `AGENT_THINK_MODEL` with `npm run check` |
| Agent voice fails | Set `AGENT_VOICE=aura-2-thalia-en` (classic Deepgram voice) |
| Microphone blocked | Click the lock icon in the address bar and allow the microphone |

## Development

`npm test` runs a full simulation against mock Twilio, Deepgram and Claude servers (22 checks: auth, token, TwiML, transcription, suggestions, summaries, agent audio, barge-in, owner questions, keypad tones, hangup, join).

## Next steps

- Native mobile app with CallKit (same backend)
- Let the copilot take over a call you started
- Answer-machine detection and smarter hold handling
- Save outcomes straight into reminders and to-dos
