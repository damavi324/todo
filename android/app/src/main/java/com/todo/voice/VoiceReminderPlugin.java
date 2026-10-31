package com.todo.voice;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(
    name = "VoiceReminder",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class VoiceReminderPlugin extends Plugin {
    private static VoiceReminderPlugin instance;

    // Speech engine for previews. Created on first use and only touched on the UI thread.
    private TextToSpeech tts;
    private boolean ttsReady;
    private final List<Runnable> ttsWaiting = new ArrayList<>();

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        if (tts != null) tts.shutdown();
        tts = null;
        ttsReady = false;
    }

    /** Run `use` once the speech engine is ready, or reject the call if the phone has none. */
    private void withTts(PluginCall call, Runnable use) {
        getActivity().runOnUiThread(() -> {
            Runnable step = () -> {
                if (ttsReady) use.run();
                else call.reject("Text-to-speech is not available on this phone");
            };
            if (ttsReady) {
                step.run();
                return;
            }
            ttsWaiting.add(step);
            if (tts != null) return;
            tts = new TextToSpeech(getContext().getApplicationContext(), status -> {
                ttsReady = status == TextToSpeech.SUCCESS;
                List<Runnable> waiting = new ArrayList<>(ttsWaiting);
                ttsWaiting.clear();
                for (Runnable r : waiting) r.run();
                if (!ttsReady) tts = null;
            });
        });
    }

    @PluginMethod
    public void getVoices(PluginCall call) {
        withTts(call, () -> {
            JSArray voices = new JSArray();
            for (Voice v : Speech.offlineVoices(tts)) {
                voices.put(new JSObject().put("id", v.getName()).put("locale", v.getLocale().toLanguageTag()));
            }
            call.resolve(new JSObject().put("voices", voices));
        });
    }

    /** Speak a reminder now, the way it sounds when its alarm goes off. */
    @PluginMethod
    public void announce(PluginCall call) {
        String text = call.getString("text", "");
        withTts(call, () -> {
            Speech.configure(tts, call.getString("voice", ""), call.getFloat("pitch", 1f));
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString());
            call.resolve();
        });
    }

    /** Tell the running app that "Mark Done" was tapped on a notification. */
    static void notifyTasksCompleted() {
        VoiceReminderPlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("tasksCompleted", new JSObject());
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSArray reminders = call.getArray("reminders", new JSArray());
        try {
            VoiceReminderHelper.sync(
                getContext(),
                reminders,
                call.getBoolean("sticky", true),
                call.getInt("repeatMinutes", 0),
                call.getBoolean("speak", true),
                call.getString("name", ""),
                call.getString("voice", ""),
                call.getFloat("pitch", 1f)
            );
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid reminders: " + e.getMessage());
        }
    }

    @PluginMethod
    public void consumeCompleted(PluginCall call) {
        JSONArray completed = VoiceReminderHelper.consumeCompleted(getContext());
        JSArray taskIds = new JSArray();
        for (int i = 0; i < completed.length(); i++) {
            taskIds.put(completed.optString(i));
        }
        call.resolve(new JSObject().put("taskIds", taskIds));
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
            return;
        }
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Intent intent = VoiceReminderHelper.exactAlarmSettingsIntent(getContext());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private JSObject permissionStatus() {
        boolean notifications =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        JSObject status = new JSObject();
        status.put("notifications", notifications ? "granted" : "denied");
        status.put("exactAlarms", VoiceReminderHelper.canScheduleExact(getContext()) ? "granted" : "denied");
        return status;
    }
}
