package com.todo.voice;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reminder state lives in SharedPreferences, keyed by notification id. An entry exists for as long
 * as its task is pending, so "entry exists" is what keeps a notification sticky and re-alerting.
 */
public final class VoiceReminderHelper {
    public static final String CHANNEL_ID = "voice_reminders";
    public static final String PREFS = "voice_reminders";
    public static final String KEY_ITEMS = "items";
    public static final String KEY_COMPLETED = "completed";

    public static final String ACTION_FIRE = "com.todo.voice.FIRE_REMINDER";
    public static final String ACTION_DISMISSED = "com.todo.voice.REMINDER_DISMISSED";
    public static final String ACTION_DONE = "com.todo.voice.REMINDER_DONE";
    public static final String ACTION_SNOOZE = "com.todo.voice.REMINDER_SNOOZE";

    public static final String EXTRA_ID = "reminder_id";
    public static final String EXTRA_TASK_ID = "task_id";

    private static final long SNOOZE_MS = 10 * 60 * 1000L;
    private static final long MINUTE_MS = 60 * 1000L;

    private VoiceReminderHelper() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Task reminders", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Reminders for tasks that are due");
        channel.enableVibration(true);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    public static boolean canScheduleExact(Context context) {
        AlarmManager am = context.getSystemService(AlarmManager.class);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return am.canScheduleExactAlarms();
        return true;
    }

    public static Intent exactAlarmSettingsIntent(Context context) {
        android.net.Uri pkg = android.net.Uri.parse("package:" + context.getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(pkg);
        }
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(pkg);
    }

    /** Make stored reminders match the app's pending tasks and current settings. */
    public static synchronized void sync(
        Context context,
        JSONArray reminders,
        boolean sticky,
        int repeatMinutes,
        boolean speak,
        String name
    ) throws JSONException {
        ensureChannel(context);
        JSONObject root = readRoot(context);
        long now = System.currentTimeMillis();
        Set<String> keep = new HashSet<>();

        for (int i = 0; i < reminders.length(); i++) {
            JSONObject r = reminders.getJSONObject(i);
            int id = r.getInt("id");
            String key = String.valueOf(id);
            long at = r.getLong("at");
            String title = r.optString("title", "Reminder");
            String body = r.optString("body", "");
            JSONObject existing = root.optJSONObject(key);

            if (at > now) {
                if (existing != null && existing.optBoolean("fired")) {
                    NotificationManagerCompat.from(context).cancel(id);
                }
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("taskId", r.optString("taskId", ""));
                item.put("at", at);
                item.put("fired", false);
                item.put("alerts", 0);
                applyDetails(item, title, body, sticky, repeatMinutes, speak, name);
                root.put(key, item);
                scheduleAlarm(context, id, at);
                keep.add(key);
            } else if (existing != null && existing.optLong("at") == at) {
                // Already fired (or snoozed) for this due time: keep it alive, refresh what changed.
                boolean wasSticky = existing.optBoolean("sticky");
                boolean changed =
                    wasSticky != sticky ||
                    existing.optInt("repeat") != repeatMinutes ||
                    !title.equals(existing.optString("title")) ||
                    !body.equals(existing.optString("body"));
                applyDetails(existing, title, body, sticky, repeatMinutes, speak, name);
                if (changed && existing.optBoolean("fired")) {
                    if (sticky || wasSticky) showNotification(context, existing, true);
                    if (sticky && repeatMinutes > 0) {
                        scheduleAlarm(context, id, now + repeatMinutes * MINUTE_MS);
                    } else {
                        cancelAlarm(context, id);
                    }
                }
                keep.add(key);
            }
            // Otherwise the due time had already passed when the task was saved: no reminder.
        }

        List<String> stale = new ArrayList<>();
        Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!keep.contains(key)) stale.add(key);
        }
        for (String key : stale) {
            int id = Integer.parseInt(key);
            cancelAlarm(context, id);
            NotificationManagerCompat.from(context).cancel(id);
            root.remove(key);
        }

        writeRoot(context, root);
    }

    private static void applyDetails(
        JSONObject item,
        String title,
        String body,
        boolean sticky,
        int repeatMinutes,
        boolean speak,
        String name
    ) throws JSONException {
        item.put("title", title);
        item.put("body", body);
        item.put("sticky", sticky);
        item.put("repeat", repeatMinutes);
        item.put("speak", speak);
        item.put("name", name != null ? name : "");
    }

    /** Alarm went off. Returns the reminder so the caller can speak it, or null if the task is no longer pending. */
    public static synchronized JSONObject onFire(Context context, int id) {
        try {
            JSONObject root = readRoot(context);
            JSONObject item = root.optJSONObject(String.valueOf(id));
            if (item == null) return null;
            item.put("fired", true);
            item.put("alerts", item.optInt("alerts") + 1);
            writeRoot(context, root);

            showNotification(context, item, false);
            int repeat = item.optInt("repeat");
            if (item.optBoolean("sticky") && repeat > 0) {
                scheduleAlarm(context, id, System.currentTimeMillis() + repeat * MINUTE_MS);
            }
            return item;
        } catch (JSONException e) {
            return null;
        }
    }

    /** User swiped the notification away. Sticky reminders come straight back, quietly. */
    public static synchronized void onDismissed(Context context, int id) {
        try {
            JSONObject item = readRoot(context).optJSONObject(String.valueOf(id));
            if (item != null && item.optBoolean("fired") && item.optBoolean("sticky")) {
                showNotification(context, item, true);
            }
        } catch (JSONException ignored) {}
    }

    public static synchronized void onDone(Context context, int id) {
        cancelAlarm(context, id);
        NotificationManagerCompat.from(context).cancel(id);
        try {
            JSONObject root = readRoot(context);
            JSONObject item = (JSONObject) root.remove(String.valueOf(id));
            writeRoot(context, root);
            if (item == null) return;

            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray completed = new JSONArray(prefs.getString(KEY_COMPLETED, "[]"));
            completed.put(item.optString("taskId", ""));
            prefs.edit().putString(KEY_COMPLETED, completed.toString()).apply();
        } catch (JSONException ignored) {}
        VoiceReminderPlugin.notifyTasksCompleted();
    }

    public static synchronized void onSnooze(Context context, int id) {
        NotificationManagerCompat.from(context).cancel(id);
        try {
            JSONObject root = readRoot(context);
            JSONObject item = root.optJSONObject(String.valueOf(id));
            if (item == null) return;
            item.put("fired", false);
            writeRoot(context, root);
            scheduleAlarm(context, id, System.currentTimeMillis() + SNOOZE_MS);
        } catch (JSONException ignored) {}
    }

    /** Alarms and notifications are lost on reboot; restore both. */
    public static synchronized void onBoot(Context context) {
        try {
            JSONObject root = readRoot(context);
            long now = System.currentTimeMillis();
            Iterator<String> keys = root.keys();
            while (keys.hasNext()) {
                JSONObject item = root.getJSONObject(keys.next());
                int id = item.getInt("id");
                if (item.optBoolean("fired")) {
                    if (!item.optBoolean("sticky")) continue;
                    showNotification(context, item, true);
                    int repeat = item.optInt("repeat");
                    if (repeat > 0) scheduleAlarm(context, id, now + repeat * MINUTE_MS);
                } else {
                    scheduleAlarm(context, id, Math.max(item.optLong("at"), now + 5000));
                }
            }
        } catch (JSONException ignored) {}
    }

    public static synchronized JSONArray consumeCompleted(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray completed = new JSONArray(prefs.getString(KEY_COMPLETED, "[]"));
            prefs.edit().remove(KEY_COMPLETED).apply();
            return completed;
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static PendingIntent receiverIntent(Context context, String action, int id) {
        Intent intent = new Intent(context, VoiceReminderReceiver.class).setAction(action).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void scheduleAlarm(Context context, int id, long atMillis) {
        AlarmManager am = context.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent pi = receiverIntent(context, ACTION_FIRE, id);
        if (canScheduleExact(context)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pi);
        }
    }

    private static void cancelAlarm(Context context, int id) {
        AlarmManager am = context.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(receiverIntent(context, ACTION_FIRE, id));
    }

    private static void showNotification(Context context, JSONObject item, boolean silent) {
        ensureChannel(context);
        int id = item.optInt("id");
        boolean sticky = item.optBoolean("sticky");
        String body = item.optString("body", "");
        if (body.isEmpty()) body = item.optInt("alerts") > 1 ? "Still pending" : "Due now";

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(EXTRA_TASK_ID, item.optString("taskId", ""));
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            id,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(item.optString("title", "Reminder"))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setWhen(item.optLong("at"))
            .setShowWhen(true)
            .setOngoing(sticky)
            .setAutoCancel(!sticky)
            .setSilent(silent)
            .setContentIntent(contentIntent)
            .setDeleteIntent(receiverIntent(context, ACTION_DISMISSED, id))
            .addAction(0, "Mark Done", receiverIntent(context, ACTION_DONE, id))
            .addAction(0, "Snooze 10m", receiverIntent(context, ACTION_SNOOZE, id));

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission not granted yet.
        }
    }

    private static JSONObject readRoot(Context context) throws JSONException {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return new JSONObject(prefs.getString(KEY_ITEMS, "{}"));
    }

    private static void writeRoot(Context context, JSONObject root) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ITEMS, root.toString()).apply();
    }
}
