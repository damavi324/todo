package com.todo.voice;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads the phone's own calendar store, the one the Samsung and Google calendar apps display.
 * It holds every account synced to the phone, so no sign-in is needed.
 */
@CapacitorPlugin(
    name = "DeviceCalendar",
    permissions = { @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR }) }
)
public class DeviceCalendarPlugin extends Plugin {
    private static final int STATUS_CANCELED = CalendarContract.Events.STATUS_CANCELED;
    private static final int DECLINED = CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED;

    @PluginMethod
    public void listCalendars(PluginCall call) {
        if (!allowed(call)) return;
        String[] projection = {
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME
        };
        JSArray calendars = new JSArray();
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(CalendarContract.Calendars.CONTENT_URI, projection, CalendarContract.Calendars.VISIBLE + " = 1", null, null)
        ) {
            while (c != null && c.moveToNext()) {
                JSObject item = new JSObject();
                item.put("id", String.valueOf(c.getLong(0)));
                item.put("name", c.getString(1));
                item.put("account", c.getString(2));
                calendars.put(item);
            }
        } catch (Exception e) {
            call.reject("Could not read the phone's calendars: " + e.getMessage());
            return;
        }
        call.resolve(new JSObject().put("calendars", calendars));
    }

    /** Events between `from` and `to` (epoch milliseconds), with each repeat of a recurring event listed on its own. */
    @PluginMethod
    public void getEvents(PluginCall call) {
        if (!allowed(call)) return;
        Long from = call.getLong("from");
        Long to = call.getLong("to");
        if (from == null || to == null) {
            call.reject("from and to are required");
            return;
        }
        Uri.Builder uri = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(uri, from);
        ContentUris.appendId(uri, to);
        String[] projection = {
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.DESCRIPTION,
            CalendarContract.Instances.CALENDAR_ID,
            CalendarContract.Instances.RRULE,
            CalendarContract.Instances.STATUS,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS
        };
        SimpleDateFormat utcDay = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        utcDay.setTimeZone(TimeZone.getTimeZone("UTC"));

        JSArray events = new JSArray();
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(uri.build(), projection, CalendarContract.Instances.VISIBLE + " = 1", null, CalendarContract.Instances.BEGIN + " ASC")
        ) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(7) == STATUS_CANCELED || c.getInt(8) == DECLINED) continue;
                long begin = c.getLong(1);
                boolean allDay = c.getInt(2) != 0;
                String rrule = c.getString(6);
                JSObject item = new JSObject();
                item.put("eventId", String.valueOf(c.getLong(0)));
                item.put("begin", begin);
                item.put("allDay", allDay);
                // All-day events start at midnight UTC, so their day is read in UTC rather than local time.
                if (allDay) item.put("date", utcDay.format(new Date(begin)));
                item.put("title", c.getString(3));
                item.put("description", c.getString(4));
                item.put("calendarId", String.valueOf(c.getLong(5)));
                item.put("recurring", rrule != null && !rrule.isEmpty());
                events.put(item);
            }
            addSyncIds(events);
        } catch (Exception e) {
            call.reject("Could not read the phone's calendar: " + e.getMessage());
            return;
        }
        call.resolve(new JSObject().put("events", events));
    }

    /**
     * Add each event's id on its server. For Google events this is the Google Calendar event id, which is
     * how the app recognises its own tasks coming back. Events without one are simply left without it.
     */
    private void addSyncIds(JSArray events) throws JSONException {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < events.length(); i++) ids.add(events.getJSONObject(i).getString("eventId"));
        if (ids.isEmpty()) return;

        Map<String, String> syncIds = new HashMap<>();
        String[] projection = { CalendarContract.Events._ID, CalendarContract.Events._SYNC_ID };
        String selection = CalendarContract.Events._ID + " IN (" + TextUtils.join(",", ids) + ")";
        try (Cursor c = getContext().getContentResolver().query(CalendarContract.Events.CONTENT_URI, projection, selection, null, null)) {
            while (c != null && c.moveToNext()) syncIds.put(String.valueOf(c.getLong(0)), c.getString(1));
        } catch (Exception ignored) {
            return;
        }
        for (int i = 0; i < events.length(); i++) {
            JSONObject item = events.getJSONObject(i);
            String syncId = syncIds.get(item.getString("eventId"));
            if (syncId != null && !syncId.isEmpty()) item.put("syncId", syncId);
        }
    }

    private boolean allowed(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) return true;
        call.reject("Calendar permission has not been granted");
        return false;
    }
}
