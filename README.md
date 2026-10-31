# ToDo

A voice-first reminders and to-do app: React + Vite, wrapped as an Android app with Capacitor.

- Say a task ("remind me to call mom tomorrow at 5") and it becomes a task with a date and time.
  Gemini does the parsing when `VITE_GEMINI_API_KEY` is set; otherwise a small built-in parser does.
- Reminders fire even when the app is closed (exact alarms), speak the task aloud, and can stay
  pinned until you tap **Mark Done**.
- Optional two-way Google Calendar sync: tasks with a date are pushed as events, and the next two
  weeks of events are imported as tasks.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `VITE_GOOGLE_WEB_CLIENT_ID` (and optionally `VITE_GEMINI_API_KEY`).
3. Web: `npm run dev`
4. Android debug APK: `npm run apk:debug` (Windows). The APK lands in `android/app/build/outputs/apk/debug/`.

The Android build uses `vite build --mode android`, which ships a self-removing service worker
instead of the PWA cache (files already come from the APK).

## Sync between devices (Firebase)

Sign in with Google in Settings and your tasks, lists and settings are the same on the phone and the web.
Each device keeps a full local copy, so everything works offline and catches up when it reconnects.
Without the Firebase values the app runs exactly as before, on one device.

One-time setup (free Spark plan is plenty for personal use):

1. In the [Firebase console](https://console.firebase.google.com), **Add project** and pick the
   *existing* Google Cloud project that holds your `VITE_GOOGLE_WEB_CLIENT_ID`. Using the same project
   lets Firebase accept the Google sign-in the app already does.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Build → Firestore Database → Create database** (production mode), then paste `firestore.rules`
   into the **Rules** tab and publish.
4. **Project settings → Your apps → Web app (`</>`)**, and copy `apiKey`, `authDomain`, `projectId`
   and `appId` into `.env.local` as the `VITE_FIREBASE_*` values from `.env.example`.
5. **Authentication → Settings → Authorized domains**: add the domain the web app is served from.
6. Rebuild the web app and the APK.

What syncs: tasks, lists, dismissed calendar events, and settings that belong to you (name, reminder
style, calling setup). The phone's voice, its calendar choice and each device's Google Calendar sign-in
stay on that device. If two devices change the same task while both are offline, the later change wins.

## Where things live

| Path | What it does |
| --- | --- |
| `src/store/useTaskStore.js` | Tasks, lists and settings (Zustand, saved to localStorage) |
| `src/lib/cloudSync.js` | Mirrors the store to Firestore and applies changes from other devices |
| `src/lib/notifications.js` | `syncReminders()`: the one place that makes scheduled reminders match the tasks |
| `src/lib/voiceTask.js` | Turns a spoken sentence into title, date, time and priority |
| `src/lib/googleCalendar.js` | Google sign-in, event push, and calendar import |
| `android/app/src/main/java/com/todo/voice/` | Native alarms, notifications, text-to-speech and speech capture |
