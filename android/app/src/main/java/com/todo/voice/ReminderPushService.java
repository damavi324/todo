package com.todo.voice;

import android.content.Context;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONObject;

/**
 * Receives reminders pushed when a task changes on another device (the web, another phone), and sets or
 * clears the alarm right away, even when the app is closed. The next time the app opens it re-syncs every
 * reminder anyway, so a missed push only delays an alarm until then.
 */
public class ReminderPushService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        try {
            if ("reminder".equals(type)) {
                JSONObject r = new JSONObject()
                    .put("id", Integer.parseInt(data.get("id")))
                    .put("taskId", data.get("taskId"))
                    .put("at", Long.parseLong(data.get("at")))
                    .put("title", data.get("title"))
                    .put("body", data.containsKey("body") ? data.get("body") : "")
                    .put("once", "true".equals(data.get("once")))
                    .put("quiet", "true".equals(data.get("quiet")));
                VoiceReminderHelper.upsert(this, r);
            } else if ("remove".equals(type)) {
                VoiceReminderHelper.remove(this, Integer.parseInt(data.get("id")));
            }
        } catch (Exception ignored) {
            // A malformed push is skipped; the app's own sync will catch up.
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // The app registers this device under the signed-in account the next time it opens.
        getSharedPreferences(VoiceReminderHelper.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(VoiceReminderHelper.KEY_PUSH_TOKEN, token)
            .apply();
    }
}
