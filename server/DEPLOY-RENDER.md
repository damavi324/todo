# Run CallPilot on Render (current host)

The Blueprint is `render.yaml` at the repo root. It builds `server/Dockerfile` from `feature/calling-ai-voice`, uses the free instance (512 MB, sleeps after about 15 idle minutes), and checks `/api/health`.

Google Cloud Run is unchanged. See `DEPLOY-CLOUD-RUN.md` when you want to switch. Run only one of them: the server that starts last points your Twilio TwiML App at itself.

## One-time setup (dashboard.render.com)

1. Sign in with GitHub and open **New → Blueprint**.
2. Pick `damavi324/todo` and branch **`feature/calling-ai-voice`**. The Blueprint file is not on `main`.
3. Render prompts for each secret. Paste the same values as `server/.env`:
   - `APP_PASSCODE`
   - `OWNER_NAME`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`
   - `DEEPGRAM_API_KEY`
   - `ANTHROPIC_API_KEY`
4. Apply. The first Docker build takes a few minutes. Copy the service URL (`https://callpilot-….onrender.com`).
5. Phone app: Settings → Calling → that URL + the passcode → Connect. The first tap after a sleep can take up to a minute.

Render sets `RENDER_EXTERNAL_HOSTNAME`, so the server knows its public address and updates the Twilio TwiML App on startup. Leave `PUBLIC_HOST` empty unless you add a custom domain.

Pushes to `feature/calling-ai-voice` that touch `server/**` redeploy automatically.
