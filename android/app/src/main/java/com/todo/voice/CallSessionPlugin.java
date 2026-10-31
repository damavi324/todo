package com.todo.voice;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.List;

/**
 * Bridges the call screen to Android: foreground service while a call runs, call audio routing
 * (earpiece or speaker), and heads-up alerts when Pilot needs an answer.
 */
@CapacitorPlugin(name = "CallSession")
public class CallSessionPlugin extends Plugin {
    private static WeakReference<CallSessionPlugin> instance = new WeakReference<>(null);
    private boolean audioModeSet = false;

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        CallSessionService.ensureChannels(getContext());
    }

    /** Called by the service when "Hang up" is tapped on the notification. */
    static void emitHangup() {
        CallSessionPlugin plugin = instance.get();
        if (plugin != null) {
            plugin.notifyListeners("hangup", new JSObject(), true);
            plugin.resetAudio();
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String mode = call.getString("mode", "monitor");
        if ("audio".equals(mode) && !hasMic()) mode = "monitor";
        Intent intent = new Intent(getContext(), CallSessionService.class)
            .setAction(CallSessionService.ACTION_START)
            .putExtra(CallSessionService.EXTRA_MODE, mode)
            .putExtra(CallSessionService.EXTRA_TITLE, call.getString("title", "Call in progress"))
            .putExtra(CallSessionService.EXTRA_TEXT, call.getString("text", "Tap to open"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            if ("audio".equals(mode)) enterCallAudio();
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not keep the call running in the background: " + e.getMessage());
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (!CallSessionService.isRunning()) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), CallSessionService.class).setAction(CallSessionService.ACTION_UPDATE);
        if (call.hasOption("title")) intent.putExtra(CallSessionService.EXTRA_TITLE, call.getString("title"));
        if (call.hasOption("text")) intent.putExtra(CallSessionService.EXTRA_TEXT, call.getString("text"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception ignored) {
            // Notification text is cosmetic; never fail the call over it.
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (CallSessionService.isRunning()) {
            Intent intent = new Intent(getContext(), CallSessionService.class).setAction(CallSessionService.ACTION_STOP);
            try {
                getContext().startService(intent);
            } catch (Exception ignored) {
                getContext().stopService(new Intent(getContext(), CallSessionService.class));
            }
        }
        NotificationManagerCompat.from(getContext()).cancel(CallSessionService.ALERT_ID);
        resetAudio();
        call.resolve();
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (on) {
                AudioDeviceInfo speaker = findDevice(am, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
                if (speaker != null) am.setCommunicationDevice(speaker);
            } else {
                am.clearCommunicationDevice();
            }
        } else {
            am.setSpeakerphoneOn(on);
        }
        JSObject result = new JSObject();
        result.put("on", on);
        call.resolve(result);
    }

    @PluginMethod
    public void alert(PluginCall call) {
        CallSessionService.ensureChannels(getContext());
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.resolve();
            return;
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), CallSessionService.CHANNEL_ALERT)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(call.getString("title", "Pilot needs your answer"))
            .setContentText(call.getString("text", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(call.getString("text", "")))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(CallSessionService.openAppIntent(getContext()));
        try {
            NotificationManagerCompat.from(getContext()).notify(CallSessionService.ALERT_ID, b.build());
        } catch (SecurityException ignored) {
            // Notifications are blocked; the in-app question card still shows.
        }
        call.resolve();
    }

    @PluginMethod
    public void clearAlert(PluginCall call) {
        NotificationManagerCompat.from(getContext()).cancel(CallSessionService.ALERT_ID);
        call.resolve();
    }

    private void enterCallAudio() {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        audioModeSet = true;
    }

    void resetAudio() {
        if (!audioModeSet) return;
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
        else am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        audioModeSet = false;
    }

    private static AudioDeviceInfo findDevice(AudioManager am, int type) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null;
        List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
        for (AudioDeviceInfo d : devices) {
            if (d.getType() == type) return d;
        }
        return null;
    }

    private boolean hasMic() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }
}
