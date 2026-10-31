package com.todo.voice;

import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** How reminders sound. Shared by the alarm receiver and the in-app preview so both speak alike. */
final class Speech {
    private static final float RATE = 0.95f;

    private Speech() {}

    /** Set up the engine to speak with the chosen voice, or the best one for the phone's language if none is chosen. */
    static void configure(TextToSpeech tts, String voiceName, float pitch) {
        tts.setLanguage(Locale.getDefault());
        Voice current = tts.getVoice();
        Locale locale = current != null ? current.getLocale() : Locale.getDefault();
        Voice chosen = null;
        // With no choice made, use the most natural voice of the phone's own accent.
        Voice best = current;
        for (Voice v : offlineVoices(tts)) {
            if (v.getName().equals(voiceName)) chosen = v;
            if (v.getLocale().equals(locale) && (best == null || v.getQuality() > best.getQuality())) best = v;
        }
        try {
            if (chosen != null) tts.setVoice(chosen);
            else if (best != null) tts.setVoice(best);
        } catch (Exception ignored) {}
        tts.setSpeechRate(RATE);
        tts.setPitch(pitch > 0 ? pitch : 1f);
    }

    /** Installed voices in the phone's language that work without a connection, as reminders must. */
    static List<Voice> offlineVoices(TextToSpeech tts) {
        List<Voice> result = new ArrayList<>();
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null) return result;
            String language = Locale.getDefault().getLanguage();
            for (Voice v : all) {
                if (v.isNetworkConnectionRequired() || !v.getLocale().getLanguage().equals(language)) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                result.add(v);
            }
        } catch (Exception ignored) {}
        return result;
    }
}
