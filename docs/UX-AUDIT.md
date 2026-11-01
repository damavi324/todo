# Phone UX audit — findings and fix plan

How this was tested: every screen walked at phone size (375×812, touch) in the browser against a stand-in
calling server, plus a line-by-line read of every overlay, menu and navigation path. (The Android emulator on
this PC has a 2020 WebView that can't draw the app, so Android-only behaviour — the back button, the keyboard,
the gesture bar — was checked against the Capacitor 8 source instead.)

✅ = reproduced on screen. 📖 = found in the code (Android-only, or timing).

**Status: all fixed** (everything below except "Not changed"). Re-tested at phone size: menus and panels close
on a tap outside, Escape, Back and swipe-down; the Back sequence (panel → list → Lists → Today, Upcoming →
Today, call plan → form, Calls → Today); Undo after delete; the contact list closing; Calls opening at the
top; Edit keeping your text; the tab-bar fix. The Android back event was fired at the app's real handler in the browser.
Still to try on a phone: the gesture-bar spacing and the keyboard hiding the tab bar, which only happen in the Android app.

## A. Navigation and the back button

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| A1 📖 | The Android back button isn't handled anywhere. | Back with the task editor, Settings, a menu or the voice panel open **closes the whole app** instead of the panel. Back from a list, Upcoming or Calls also quits. | One back handler for the app: close the top panel or menu first; then step back (call detail → calls, list → Lists, Upcoming/Calls → Today); on Today, send the app to the background instead of killing it. |
| A2 ✅ | On the Calls screen, the **Lists tab does nothing**. | Tap Calls, then Lists: you stay on Calls. | Lists also switches the app back to tasks. |
| A3 ✅ | Escape and Back don't close the long-press task menu or the voice panel. | Only tapping outside closes them. | They join the same back/Escape handling as the other panels. |
| A4 📖 | Two panels open at once both close on one Escape. | Each panel listened for Escape on its own. | One shared stack: Escape/Back closes only the top one. |
| A5 ✅ | No way back from a list on the phone except the tab bar. | Open Lists → Work: no back arrow. | A "‹ Lists" link above the list's title on phones (Back does the same). |
| A6 ✅ | The Calls screen has no Settings button on phones (every other tab does). | — | Add the gear to the Calls header. |

## B. Overlays and menus

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| B1 ✅ | Tapping outside the long-press menu to close it **opens the task editor**. | The menu is drawn over the page but its taps still reach the task row underneath. | Stop taps, presses and long-presses inside the menu from reaching the row. |
| B2 📖 | After a real long-press, the first tap outside the menu can be swallowed. | Same cause as B1 (the row's "ignore the click after a hold" check catches the menu's tap). | Fixed with B1. |
| B3 📖 | Dismissing the voice panel while it says "Working it out…" doesn't really cancel it. | A few seconds later the task editor pops up, or a reminder is saved, for something you closed. | Ignore results that arrive after the panel was closed. |
| B4 ✅ | The "Who to call" contact suggestions **stay open after you leave the field**. | Type "joh", tap elsewhere: the list keeps covering "What should happen". | Only show suggestions while the field has focus. |
| B5 📖 | On phones the suggestions open under the keyboard. | The field is mid-screen and the list drops below the keyboard. | On touch screens, scroll the field to the top when it's focused. |
| B6 ✅ | Toasts cover the **+ New task** button for 3–6 seconds. | E.g. "Reminder set: …" sits right on top of the + button. | On task screens, keep toasts clear of the buttons on the right. |
| B7 ✅ | The calendar error banner has no top padding and doubles the status-bar gap. | Text touches the top of the red box. | Show it as a banner under the status bar, over the header, until dismissed. |

## C. Layout on real phones (gesture bar, notch, keyboard)

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| C1 ✅ | A helper class that adds room for the gesture bar **wipes out the element's own padding**. | Lists title jammed against the top; the long-press menu, the voice panel and every panel footer (Save/Cancel) have no bottom padding. | Add the gesture-bar space on top of the normal padding instead of replacing it. |
| C2 📖 | The + and microphone buttons and the toasts ignore the gesture bar. | On phones with a navigation bar the + button overlaps the tab bar. | Raise them by the gesture-bar height. |
| C3 📖 | Panels without a footer (Settings) end under the gesture bar. | The last setting is partly hidden. | Bottom inset inside the panel body. |
| C4 📖 | With the keyboard open, the tab bar and the + and microphone buttons ride up on top of it. | They take about 200px of the little space left while typing. | Hide them while the keyboard is open. |
| C5 ✅ | Editing an existing contact, or a list, pops the keyboard up straight away. | Half the panel is covered when you only wanted to look or delete. | Only put the cursor in the field automatically for new items. |
| C6 📖 | Hands-free: when the assistant asks a question mid-call, the keyboard pops up. | It covers the Speak button while you're driving. | No automatic keyboard in hands-free mode. |

## D. Scrolling

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| D1 ✅ | Tapping 📞 on a contact fills in the call form **off-screen**. | You're scrolled down at Contacts; nothing seems to happen. | Scroll to the top whenever the Calls screen changes (new draft, plan, detail, summary). |
| D2 📖 | Opening a recent call shows its detail mid-page. | Same cause. | Same fix. |
| D3 📖 | Switching views keeps the old scroll position. | All tasks scrolled down → Upcoming opens part-way down. | Scroll to the top when the list or view changes. |

## E. Taps and touch targets

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| E1 📖 | The tick circle is 20px. | Tapping slightly off it opens the task instead of completing it. | 40px tap area around the same circle. |
| E2 📖 | The "+" to add a list is 24px. | Hard to hit. | Bigger on phones. |
| E3 📖 | Panels can't be swiped down to close (the usual Android bottom-sheet gesture). | — | Drag the top bar of a panel down to close it (phones only). |

## F. Accidental loss

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| F1 📖 | Deleting a task (editor or long-press menu) is instant with no way back. | One mis-tap and it's gone. | "Deleted · **Undo**" toast; Undo puts it back with its reminder and calendar event. |
| F2 📖 | Deleting a contact is instant. | — | Tap Delete twice to confirm (same as lists). |

## G. Calls

| # | Problem | How it shows up | Fix |
|---|---------|-----------------|-----|
| G1 ✅ | **Edit** on a call plan duplicates your text. | "Ask about dinner" comes back as "Ask about dinner / Calling: John Carter / Ask about dinner". | Keep the contact's background separate from what you typed; also clean it out of older calls when they're reused. |

## H. Smaller things

| # | Problem | Fix |
|---|---------|-----|
| H1 📖 | Typing your name in Settings re-schedules every reminder on each letter (laggy on a phone). | Save on each keystroke, re-schedule once you pause. |
| H2 📖 | The phone keyboard's Enter key is a generic "↵". | "Done"/"Send" labels on the quick-add, task title and answer fields. |
| H3 ✅ | The voice panel and the long-press menu aren't announced as dialogs (TalkBack). | Mark them as dialogs. |

## Not changed (noted)

- Phones whose Android System WebView is older than Chrome 107 (about 2022) show a blank screen. Real phones update
  WebView through the Play Store, so this is unlikely, but it's why the emulator here couldn't be used.
- The browser's own Back button on the web version still leaves the page; this round covers the Android app's back button and Escape.
