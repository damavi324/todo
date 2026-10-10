package com.todo.voice;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONObject;

public class VoiceReminderReceiver extends BroadcastReceiver {
    // A broadcast receiver is killed after roughly 10 seconds, so stop waiting just before that.
    private static final long SPEAK_TIMEOUT_MS = 9000;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        Context app = context.getApplicationContext();
        String action = intent.getAction();
        int id = intent.getIntExtra(VoiceReminderHelper.EXTRA_ID, 0);

        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case "android.intent.action.QUICKBOOT_POWERON":
                VoiceReminderHelper.onBoot(app);
                return;
            case VoiceReminderHelper.ACTION_DISMISSED:
                VoiceReminderHelper.onDismissed(app, id);
                return;
            case VoiceReminderHelper.ACTION_DONE:
                VoiceReminderHelper.onDone(app, id);
                return;
            case VoiceReminderHelper.ACTION_SNOOZE:
                VoiceReminderHelper.onSnooze(app, id);
                return;
            case VoiceReminderHelper.ACTION_FIRE:
                JSONObject item = VoiceReminderHelper.onFire(app, id);
                if (item != null && item.optBoolean("speak", true)) {
                    speak(app, spokenText(item));
                }
                return;
            default:
        }
    }

    static String spokenText(JSONObject item) {
        String title = item.optString("title", "a task");
        String name = item.optString("name", "").trim();
        String hey = name.isEmpty() ? "" : "Hey " + name + ", ";
        if (item.optInt("alerts") > 1) {
            return hey + "reminding you again: " + title + " is still pending.";
        }
        return (hey.isEmpty() ? "You have a reminder: " : hey + "you have a reminder: ") + title + ".";
    }

    private void speak(Context app, String text) {
        final PendingResult pendingResult = goAsync();
        final Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] finished = { false };
        final Runnable finish = () -> {
            if (finished[0]) return;
            finished[0] = true;
            pendingResult.finish();
        };
        handler.postDelayed(finish, SPEAK_TIMEOUT_MS);

        final TextToSpeech[] holder = new TextToSpeech[1];
        holder[0] = new TextToSpeech(app, status -> {
            TextToSpeech tts = holder[0];
            if (status != TextToSpeech.SUCCESS || tts == null) {
                handler.post(finish);
                return;
            }

            tts.setLanguage(Locale.getDefault());
            useBestOfflineVoice(tts);
            tts.setSpeechRate(0.95f);

            final Runnable done = () -> {
                try {
                    tts.shutdown();
                } catch (Exception ignored) {}
                handler.removeCallbacks(finish);
                finish.run();
            };
            tts.setOnUtteranceProgressListener(
                new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        handler.post(done);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        handler.post(done);
                    }
                }
            );

            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString());
        });
    }

    /** Engines ship several voices per language; pick the most natural one that works offline. */
    private static void useBestOfflineVoice(TextToSpeech tts) {
        try {
            Voice current = tts.getVoice();
            Locale locale = current != null ? current.getLocale() : Locale.getDefault();
            Voice best = current;
            for (Voice v : tts.getVoices()) {
                if (v.isNetworkConnectionRequired() || !v.getLocale().equals(locale)) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                if (best == null || v.getQuality() > best.getQuality()) best = v;
            }
            if (best != null && best != current) tts.setVoice(best);
        } catch (Exception ignored) {}
    }
}
