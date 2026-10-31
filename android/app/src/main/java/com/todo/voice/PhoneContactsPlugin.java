package com.todo.voice;

import android.Manifest;
import android.database.Cursor;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.HashSet;
import java.util.Set;

/**
 * Reads the phone's contacts (name and phone numbers only), so a call can be placed to someone already
 * in the phone without typing their number. Nothing is changed or copied anywhere.
 */
@CapacitorPlugin(
    name = "PhoneContacts",
    permissions = { @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class PhoneContactsPlugin extends Plugin {

    /** Every phone number in the phone's contacts: { contacts: [{ id, name, phone, label }] }, sorted by name. */
    @PluginMethod
    public void list(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contacts permission has not been granted");
            return;
        }
        String[] projection = {
            Phone.CONTACT_ID,
            Phone.DISPLAY_NAME_PRIMARY,
            Phone.NUMBER,
            Phone.NORMALIZED_NUMBER,
            Phone.TYPE,
            Phone.LABEL
        };
        JSArray contacts = new JSArray();
        // The same number is often stored twice (e.g. once per synced account): list it once.
        Set<String> seen = new HashSet<>();
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(Phone.CONTENT_URI, projection, null, null, Phone.DISPLAY_NAME_PRIMARY + " COLLATE NOCASE ASC")
        ) {
            while (c != null && c.moveToNext()) {
                String name = c.getString(1);
                String number = c.getString(2);
                if (TextUtils.isEmpty(name) || TextUtils.isEmpty(number)) continue;
                String normalized = c.getString(3);
                String key = c.getLong(0) + "|" + (TextUtils.isEmpty(normalized) ? number.replaceAll("\\D", "") : normalized);
                if (!seen.add(key)) continue;
                CharSequence label = Phone.getTypeLabel(getContext().getResources(), c.getInt(4), c.getString(5));
                JSObject item = new JSObject();
                item.put("id", "phone:" + c.getLong(0) + ":" + contacts.length());
                item.put("name", name);
                item.put("phone", TextUtils.isEmpty(normalized) ? number : normalized);
                item.put("label", label != null ? label.toString() : "");
                contacts.put(item);
            }
        } catch (Exception e) {
            call.reject("Could not read the phone's contacts: " + e.getMessage());
            return;
        }
        call.resolve(new JSObject().put("contacts", contacts));
    }
}
