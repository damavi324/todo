package com.todo.voice;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(
    name = "VoiceReminder",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class VoiceReminderPlugin extends Plugin {
    private static VoiceReminderPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
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
                call.getString("name", "")
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
