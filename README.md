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

## Where things live

| Path | What it does |
| --- | --- |
| `src/store/useTaskStore.js` | Tasks, lists and settings (Zustand, saved to localStorage) |
| `src/lib/notifications.js` | `syncReminders()`: the one place that makes scheduled reminders match the tasks |
| `src/lib/voiceTask.js` | Turns a spoken sentence into title, date, time and priority |
| `src/lib/googleCalendar.js` | Google sign-in, event push, and calendar import |
| `android/app/src/main/java/com/todo/voice/` | Native alarms, notifications, text-to-speech and speech capture |
