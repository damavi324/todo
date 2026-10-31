import { useState, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTaskStore } from '../store/useTaskStore'
import {
  signIn,
  signOut,
  isSignedIn,
  getSignedInEmail,
  isGoogleAuthReady,
  initGoogleAuth,
  importUpcomingEvents,
} from '../lib/googleCalendar'
import { requestVoiceReminderPermissions, syncReminders, spokenText } from '../lib/notifications'
import VoiceReminder from '../plugins/VoiceReminder'
import { X, Calendar, Volume2, LogOut, LogIn, RefreshCw } from 'lucide-react'

export default function Settings({ onClose }) {
  const { settings, updateSettings } = useTaskStore()
  const [gcalSignedIn, setGcalSignedIn] = useState(isSignedIn())
  const [accountEmail, setAccountEmail] = useState(getSignedInEmail())
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [permStatus, setPermStatus] = useState(null)
  const isNative = Capacitor.isNativePlatform()
  const authConfigured = isGoogleAuthReady()

  useEffect(() => {
    VoiceReminder.checkPermissions()
      .then(setPermStatus)
      .catch(() => {})
    if (authConfigured) {
      initGoogleAuth().catch(() => {})
    }
  }, [authConfigured])

  // Reminder settings are held by the native alarm code, so push every change to it.
  const changeReminderSetting = (changes) => {
    updateSettings(changes)
    syncReminders().catch(console.error)
  }

  const handleVoiceToggle = async (enabled) => {
    updateSettings({ voiceRemindersEnabled: enabled })
    if (enabled) {
      const perms = await requestVoiceReminderPermissions()
      setPermStatus(perms)
      if (isNative && perms.exactAlarms !== 'granted') {
        await VoiceReminder.openExactAlarmSettings().catch(() => {})
      }
    }
    await syncReminders()
  }

  const handleRequestPermissions = async () => {
    const perms = await requestVoiceReminderPermissions()
    setPermStatus(perms)
    if (isNative && perms.exactAlarms !== 'granted') {
      await VoiceReminder.openExactAlarmSettings().catch(() => {})
    }
  }

  const handleSignIn = async () => {
    setAuthError('')
    setBusy(true)
    try {
      const { email } = await signIn()
      updateSettings({ googleCalendarEnabled: true })
      setGcalSignedIn(true)
      setAccountEmail(email || getSignedInEmail())
    } catch (e) {
      if (e?.code !== 'USER_CANCELLED') {
        setAuthError(e?.message || 'Sign-in failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await signOut()
      updateSettings({ googleCalendarEnabled: false })
      setGcalSignedIn(false)
      setAccountEmail('')
      setSyncMsg('')
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    setSyncMsg('')
    setBusy(true)
    try {
      const r = await importUpcomingEvents(settings.googleCalendarId || 'primary')
      await syncReminders()
      setSyncMsg(
        r.imported + r.updated + r.removed === 0
          ? 'Already up to date.'
          : `Imported ${r.imported}, updated ${r.updated}, removed ${r.removed}.`
      )
    } catch (e) {
      setSyncMsg(e?.message || 'Import failed')
      if (e?.code === 'AUTH_EXPIRED') {
        setGcalSignedIn(false)
        updateSettings({ googleCalendarEnabled: false })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 border-b border-gray-100">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
          <X size={20} className="text-gray-600" />
        </button>
        <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Notifications">
          <Row label="Voice reminders">
            <button
              type="button"
              role="switch"
              aria-checked={settings.voiceRemindersEnabled !== false}
              onClick={() => handleVoiceToggle(!(settings.voiceRemindersEnabled !== false))}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                settings.voiceRemindersEnabled !== false ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  settings.voiceRemindersEnabled !== false ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </Row>
          <Row label="Call me">
            <input
              value={settings.userName || ''}
              onChange={(e) => changeReminderSetting({ userName: e.target.value })}
              placeholder="Your name"
              maxLength={30}
              className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none w-40"
            />
          </Row>
          <p className="text-xs text-gray-400 px-5 pb-3 flex gap-2">
            <Volume2 size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              When a task is due the phone says “{spokenText('buy groceries', (settings.userName || '').trim())}”
              {isNative ? ' It works even if the app is closed, and plays at media volume.' : ' Only while this tab is open.'}
            </span>
          </p>
          {(isNative || permStatus) && (
            <div className="px-5 pb-3 space-y-2">
              {permStatus && (
                <p className="text-xs text-gray-500">
                  Notifications: {permStatus.notifications}
                  {isNative ? ` · Exact alarms: ${permStatus.exactAlarms}` : ''}
                </p>
              )}
              <button
                type="button"
                onClick={handleRequestPermissions}
                className="w-full bg-gray-100 text-gray-800 text-sm font-medium py-2.5 rounded-xl"
              >
                Grant reminder permissions
              </button>
            </div>
          )}
          <Row label="Notification Style">
            <select
              value={settings.notificationStyle}
              onChange={(e) => changeReminderSetting({ notificationStyle: e.target.value })}
              className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none">
              <option value="sticky">Sticky (stays until done)</option>
              <option value="normal">Normal (can be swiped away)</option>
            </select>
          </Row>
          {settings.notificationStyle === 'sticky' && (
            <Row label="Re-alert every">
              <select
                value={settings.notificationRepeatMinutes}
                onChange={(e) => changeReminderSetting({ notificationRepeatMinutes: Number(e.target.value) })}
                className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none">
                <option value={0}>Never</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </Row>
          )}
          <p className="text-xs text-gray-400 px-5 pb-3">
            A sticky reminder stays in your notifications until the task is done. If you swipe it away or
            clear all notifications it comes straight back. Use <strong>Mark Done</strong> on the notification,
            or complete the task in the app, to remove it.
          </p>
        </Section>

        <Section title="Google Calendar">
          {!gcalSignedIn ? (
            <div className="px-5 pb-4 space-y-3">
              <p className="text-xs text-gray-500">
                Sign in with Google to create Calendar events from tasks and import upcoming events.
                Uses Google&apos;s account picker on your phone — no Client ID pasted in the app.
              </p>
              {!authConfigured && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5">
                  Developer setup needed: add <code className="font-mono">VITE_GOOGLE_WEB_CLIENT_ID</code> to{' '}
                  <code className="font-mono">.env.local</code>, create matching Android OAuth client
                  (package <code className="font-mono">com.todo.voice</code> + SHA-1), then rebuild.
                </p>
              )}
              {authError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5 whitespace-pre-line break-words select-text">{authError}</p>
              )}
              <button
                onClick={handleSignIn}
                disabled={!authConfigured || busy}
                className="w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <LogIn size={16} />
                {busy ? 'Signing in…' : 'Sign in with Google'}
              </button>
            </div>
          ) : (
            <div className="px-5 pb-4 space-y-3">
              <div className="flex flex-col gap-1 text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Calendar size={16} />
                  <span>Connected to Google Calendar</span>
                </div>
                {accountEmail && (
                  <span className="text-xs text-green-800/80 pl-6">{accountEmail}</span>
                )}
              </div>
              <Row label="Calendar">
                <input
                  value={settings.googleCalendarId}
                  onChange={(e) => updateSettings({ googleCalendarId: e.target.value })}
                  placeholder="primary"
                  className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none w-40"
                />
              </Row>
              <button
                type="button"
                onClick={handleImport}
                disabled={busy}
                className="w-full bg-gray-100 text-gray-800 text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <RefreshCw size={16} />
                Sync calendar now
              </button>
              <p className="text-xs text-gray-400">
                The next two weeks of calendar events are imported automatically whenever you open the app.
              </p>
              {syncMsg && <p className="text-xs text-gray-500">{syncMsg}</p>}
              <button
                onClick={handleSignOut}
                disabled={busy}
                className="w-full border border-red-200 text-red-500 text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <LogOut size={16} />
                Sign out of Google
              </button>
              <p className="text-xs text-gray-400">
                You can also revoke access anytime at myaccount.google.com → Security → Third-party access.
              </p>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mt-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider px-5 mb-2">{title}</p>
      <div className="bg-white border-y border-gray-100">{children}</div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      {children}
    </div>
  )
}
