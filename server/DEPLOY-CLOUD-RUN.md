# Run CallPilot on Google Cloud Run

The call server's home: the Firebase project **todo-88bb6**, the same one the app syncs with. It is on
the Blaze plan, so there's nothing new to sign up for. At personal use (a few calls a day) Cloud Run stays
inside its monthly free allowance. Unlike Render's free plan, it wakes in a few seconds instead of a minute.

Run only one call server at a time: whichever starts last points Twilio at itself. Once Cloud Run works,
suspend the Render service (Render → the service → Settings → Suspend).

## One-time setup (about 15 minutes, in the browser)

Open https://console.cloud.google.com/run?project=todo-88bb6 and make sure **todo-88bb6** is the
selected project at the top.

1. **Deploy container → Service**, then choose **Continuously deploy from a repository (source or
   function)** → **Set up with Cloud Build**.
   - Enable the APIs it asks for.
   - Connect GitHub and pick `damavi324/todo`.
   - Branch: `^main$` (or the branch you deploy from).
   - Build type: **Dockerfile**, source location: `/server/Dockerfile`.
2. **Service settings**
   - Service name: `callpilot` · Region: `us-central1`
   - Authentication: **Allow public access**. Twilio and the app must reach it; your passcode protects it.
   - Billing: **Instance-based**, so the server can finish the summary after a call ends.
   - Scaling: minimum instances **0**, maximum instances **1**.
3. **Containers → Edit container**
   - Memory 512 MiB, CPU 1, request timeout **3600** seconds (calls are long WebSocket connections).
   - **Variables & Secrets**: add the same values your Render service has (Render → the service →
     Environment): `APP_PASSCODE`, `OWNER_NAME`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
     `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`,
     `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, plus `TWILIO_CALLER_ID` if you set one.
4. **Create**. The first build takes about 5 minutes. Copy the service URL (`https://callpilot-….run.app`).
5. **In the app**: Settings → Calling → paste that URL and your passcode → **Connect**. Because settings
   sync, your phone and the web both switch over.
6. Make one test call, then suspend the Render service.

The server works out its own public address on Cloud Run and points the Twilio TwiML App at itself every
time it starts. Set `PUBLIC_HOST` only if you add a custom domain.

## What it costs

Cloud Run bills only while a request is running, and the free allowance (about 2 million requests and
plenty of compute time a month) covers a personal assistant. Twilio, Deepgram and Anthropic charge per
call exactly as they do on Render.

Set a guard: Billing → **Budgets & alerts** → Create budget → $5/month, with alerts at 50/90/100%. An alert
emails you; it doesn't stop anything.

## Updates

Every push to the branch rebuilds and redeploys automatically.

Don't run `npm run go` on your PC at the same time: each server points Twilio at itself when it starts.
