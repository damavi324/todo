# Run CallPilot on Google Cloud Run (kept for later)

Render is the host to use for now. See `DEPLOY-RENDER.md`. This guide stays so the same server can move to Cloud Run later without a rewrite. Do not run both at once: whichever server starts last points Twilio at itself.

The server sleeps when idle and wakes in a few seconds when the phone app opens.
At personal use (a few calls a day) it stays inside Cloud Run's monthly free allowance.

## One-time setup (console.cloud.google.com)

1. **Project and billing**: create a project (e.g. `callpilot`) and link a billing account (card required; you're only charged above the free tier).
2. **Cloud Run → Deploy container → Service**, then choose **Continuously deploy from a repository** → **Set up with Cloud Build**.
   - Enable the APIs it asks for (Cloud Build, Artifact Registry).
   - Connect GitHub, pick `damavi324/todo`.
   - Branch: `^feature/calling-ai-voice$` (or `^main$` once merged).
   - Build type: **Dockerfile**, source location: `/server/Dockerfile`.
3. **Service settings**
   - Service name: `callpilot` · Region: `us-central1` (free-tier region)
   - Authentication: **Allow public access** (Twilio and the app must reach it; the app's passcode protects it)
   - Billing: **Instance-based** (lets the server finish summaries after a call)
   - Scaling: min instances **0**, max instances **1**
4. **Container, Variables & Secrets** (Edit container)
   - Memory 512 MiB, CPU 1, request timeout **3600** seconds
   - Variables: `APP_PASSCODE`, `OWNER_NAME`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` (same values as your `.env`)
5. **Create**. The first build takes ~5 minutes. Copy the URL (`https://callpilot-….run.app`).
6. **Phone app**: Settings → Calling → that URL + passcode → Connect.

The server works out its own public address on Cloud Run and points the Twilio TwiML App at itself on every start. (Set `PUBLIC_HOST` only if you add a custom domain.)

## Cost guard

Billing → **Budgets & alerts** → Create budget → $5/month, alerts at 50/90/100%.

## Updates

Every push to the branch rebuilds and redeploys automatically.

Don't run `npm run go` on your PC at the same time: each server points Twilio at itself when it starts.
