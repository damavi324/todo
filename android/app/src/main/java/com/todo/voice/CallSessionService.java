package com.todo.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service that keeps the app (and its WebView) running while a call is in progress,
 * including with the screen locked. Shows an ongoing notification with a Hang up button.
 *
 * mode "audio"   – this phone carries the call audio (microphone foreground service type)
 * mode "monitor" – Pilot is talking; we only need to stay connected for live updates
 */
public class CallSessionService extends Service {
    public static final String CHANNEL_ONGOING = "call_ongoing";
    public static final String CHANNEL_ALERT = "call_alerts";
    public static final int ONGOING_ID = 7301;
    public static final int ALERT_ID = 7302;

    public static final String ACTION_START = "com.todo.voice.CALL_START";
    public static final String ACTION_UPDATE = "com.todo.voice.CALL_UPDATE";
    public static final String ACTION_STOP = "com.todo.voice.CALL_STOP";
    public static final String ACTION_HANGUP = "com.todo.voice.CALL_HANGUP";

    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";

    private static volatile boolean running = false;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private String mode = "monitor";
    private String title = "Call in progress";
    private String text = "Tap to open";

    public static boolean isRunning() {
        return running;
    }

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ongoing = new NotificationChannel(CHANNEL_ONGOING, "Calls in progress", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("Shown while a call is going");
        ongoing.setShowBadge(false);
        nm.createNotificationChannel(ongoing);
        NotificationChannel alert = new NotificationChannel(CHANNEL_ALERT, "Pilot needs you", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("When Pilot needs an answer during a call");
        alert.enableVibration(true);
        alert.setVibrationPattern(new long[] { 0, 180, 120, 180 });
        nm.createNotificationChannel(alert);
    }

    static PendingIntent openAppIntent(Context context) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopEverything();
            return START_NOT_STICKY;
        }
        if (ACTION_HANGUP.equals(action)) {
            CallSessionPlugin.emitHangup();
            stopEverything();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            if (intent.hasExtra(EXTRA_MODE)) mode = intent.getStringExtra(EXTRA_MODE);
            if (intent.hasExtra(EXTRA_TITLE)) title = intent.getStringExtra(EXTRA_TITLE);
            if (intent.hasExtra(EXTRA_TEXT)) text = intent.getStringExtra(EXTRA_TEXT);
        }
        ensureChannels(this);
        Notification notification = buildOngoing();
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = "audio".equals(mode) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
        }
        try {
            ServiceCompat.startForeground(this, ONGOING_ID, notification, type);
        } catch (Exception e) {
            // Android refuses a microphone service without mic permission; fall back to staying connected.
            try {
                ServiceCompat.startForeground(this, ONGOING_ID, notification,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
            } catch (Exception ignored) {
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        acquireLocks();
        running = true;
        return START_NOT_STICKY;
    }

    private Notification buildOngoing() {
        Intent hangup = new Intent(this, CallSessionService.class).setAction(ACTION_HANGUP);
        PendingIntent hangupPi = PendingIntent.getService(this, 2, hangup, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ONGOING)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent(this))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hang up", hangupPi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "todo:call");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(2 * 60 * 60 * 1000L);
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    int lockMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                        ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                        : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(lockMode, "todo:call");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception ignored) {
            // Locks are best-effort; the foreground service alone keeps the call alive.
        }
    }

    private void stopEverything() {
        running = false;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
