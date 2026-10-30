# Calls, Pilot and the smart voice button

The ToDo app now talks to your **CallPilot** server (the `callpilot` project) for three things:

1. **Calls tab** (sidebar → Calls)
   - **Pilot calls**: type or speak the goal and details, review the call plan, tap *Call now*. Watch the live transcript, answer Pilot's questions, or *Join the call*.
   - **I'll talk**: dial from the app; the AI transcribes both sides and suggests what to say.
   - Recent calls with their full log, **Redial with the same info/plan**, and a live **Logs** panel.
   - After a call: summary, key details, and **Add as tasks** for the follow-ups.
2. **One voice button** (the mic, on every screen). Talk naturally; Claude works out whether it's a task (title, date, time, priority, list), a call for Pilot, or both, e.g. "Remind me Friday at 9 to have Pilot call the dentist at 214 555 0100". A call for later is attached to the task; the task gets a **Call** button.
   If the calling server isn't set up or reachable, the button falls back to on-device speech and the old parser.
3. **Calls keep running with the screen locked.** A foreground service shows an ongoing call notification with **Hang up**, keeps the connection alive, routes audio to the earpiece (Speaker toggle in the call), and pops a heads-up alert when Pilot needs an answer.

## Connect the app

Settings → **Calling** → server address + passcode → **Connect**.
- Render (current host): the `https://….onrender.com` address from the blueprint deploy. Setup is in `server/DEPLOY-RENDER.md`. A free instance sleeps after about 15 minutes and the app waits up to a minute for it to wake.
- Google Cloud Run: kept for a later switch. See `server/DEPLOY-CLOUD-RUN.md`. Do not run it at the same time as Render.
- Your PC: the link `npm run go` prints. It changes on every restart, so re-enter it after restarting.

## Build the APK (Windows)

```powershell
npm.cmd install
npm.cmd run apk:debug
```
The APK is at `android\app\build\outputs\apk\debug\app-debug.apk`. Copy it to the phone and install (allow installs from that source once).

Requirements: Android Studio's SDK (API 36) and JDK 21, the same as before.

## New Android pieces

| File | What it does |
| --- | --- |
| `CallSessionPlugin.java` | JS bridge: start/stop the call service, speaker on/off, heads-up alerts |
| `CallSessionService.java` | Foreground service (microphone while you're on audio, data sync while Pilot talks), wake + Wi-Fi locks, Hang up action |
| `MainActivity.java` | Registers the plugin; keeps the WebView running during a call when the screen locks |
| `AndroidManifest.xml` | `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_DATA_SYNC`, the service |

No Firebase project is needed: calls always start from the app, and the service keeps the app connected while they run.

## Security

- The app stores a server token (derived from the passcode), never your Twilio, Deepgram or Anthropic keys. Those stay on the server.
- Changing the passcode on the server signs every device out; the app then shows the connect screen.
