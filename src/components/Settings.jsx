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
  calendarActive,
} from '../lib/googleCalendar'
import { GOOGLE_PROJECT_NUMBER, webClientMatchesAppProject } from '../config/googleAuth'
import { requestVoiceReminderPermissions, syncReminders, spokenText, announce } from '../lib/notifications'
import { voiceOptions, PITCHES } from '../lib/voices'
import VoiceReminder from '../plugins/VoiceReminder'
import DeviceCalendar from '../plugins/DeviceCalendar'
import { isCloudConfigured } from '../lib/firebase'
import { useSyncStore } from '../lib/cloudSync'
import { LogOut, LogIn, RefreshCw, Play, Check } from 'lucide-react'
import { Button, IconButton, Note, Sheet, Switch, fieldClass } from './ui'
import CallingSettings from './CallingSettings'

export default function Settings({ onClose }) {
  const { settings, updateSettings } = useTaskStore()
  const sync = useSyncStore()
  const [gcalSignedIn, setGcalSignedIn] = useState(isSignedIn())
  const [accountEmail, setAccountEmail] = useState(getSignedInEmail())
  const [authError, setAuthError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [permStatus, setPermStatus] = useState(null)
  const [voices, setVoices] = useState([])
  const [phoneCalendars, setPhoneCalendars] = useState([])
  const [phoneMsg, setPhoneMsg] = useState('')
  const isNative = Capacitor.isNativePlatform()
  const authConfigured = isGoogleAuthReady()
  const readsPhone = isNative && settings.phoneCalendarEnabled

  useEffect(() => {
    VoiceReminder.checkPermissions()
      .then(setPermStatus)
      .catch(() => {})
    VoiceReminder.getVoices()
      .then((r) => setVoices(voiceOptions(r.voices || [])))
      .catch(() => {})
    if (authConfigured) {
      initGoogleAuth().catch(() => {})
    }
  }, [authConfigured])

  useEffect(() => {
    if (!readsPhone) return
    DeviceCalendar.listCalendars()
      .then((r) => setPhoneCalendars(r.calendars || []))
      .catch((e) => setPhoneMsg(e?.message || 'Could not read the phone calendar'))
  }, [readsPhone])

  const runImport = async (setMsg) => {
    setMsg('')
    setBusy(true)
    try {
      const r = await importUpcomingEvents()
      await syncReminders()
      setMsg(
        r.imported + r.updated + r.removed === 0
          ? 'Already up to date.'
          : `Imported ${r.imported}, updated ${r.updated}, removed ${r.removed}.`
      )
    } catch (e) {
      setMsg(e?.message || 'Import failed')
      if (e?.code === 'AUTH_EXPIRED') {
        setGcalSignedIn(false)
        updateSettings({ googleCalendarEnabled: false })
      }
    } finally {
      setBusy(false)
    }
  }

  const handlePhoneToggle = async (enabled) => {
    setPhoneMsg('')
    if (enabled) {
      const perms = await DeviceCalendar.requestPermissions().catch(() => null)
      if (perms?.calendar !== 'granted') {
        setPhoneMsg('Calendar permission was not granted. Allow it for this app in the phone settings, then try again.')
        return
      }
    }
    updateSettings({ phoneCalendarEnabled: enabled })
    // Switching off falls back to importing from Google, which only works while signed in.
    if (enabled || calendarActive()) await runImport(setPhoneMsg)
  }

  const togglePhoneCalendar = async (id) => {
    const hidden = settings.phoneCalendarHiddenIds || []
    updateSettings({
      phoneCalendarHiddenIds: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id],
    })
    await runImport(setPhoneMsg)
  }

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
      const { email, syncError } = await signIn()
      updateSettings({ googleCalendarEnabled: true })
      setGcalSignedIn(true)
      setAccountEmail(email || getSignedInEmail())
      if (syncError) setAuthError(syncError)
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

  const handleImport = () => runImport(setSyncMsg)

  const initial = (accountEmail || sync.email || '?').trim().charAt(0).toUpperCase()

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="px-4 md:px-6 py-5 space-y-7">
        <Section title="Profile">
          {!gcalSignedIn ? (
            <div className="p-4 space-y-3">
              <p className="text-sm text-ink-2">
                Sign in with Google to keep your tasks the same on your phone and the web, and to connect Google Calendar.
                {isCloudConfigured() && ' Everything still works offline and catches up when you reconnect.'}
              </p>
              {!authConfigured && (
                <Note tone="warn">
                  Developer setup needed: add <code className="font-mono">VITE_GOOGLE_WEB_CLIENT_ID</code> to{' '}
                  <code className="font-mono">.env.local</code> and create the matching Android OAuth client
                  (package <code className="font-mono">com.todo.voice</code> + SHA-1).
                </Note>
              )}
              {authConfigured && !webClientMatchesAppProject() && (
                <Note tone="warn">
                  <code className="font-mono">VITE_GOOGLE_WEB_CLIENT_ID</code> is from a different Google Cloud project than
                  this app ({GOOGLE_PROJECT_NUMBER}, todo-88bb6), so Google will likely refuse sign-in. Use the todo-88bb6 Web
                  client, or remove it from <code className="font-mono">.env.local</code>, and rebuild.
                </Note>
              )}
              {authError && <Note tone="danger" className="whitespace-pre-line break-words select-text">{authError}</Note>}
              <Button variant="primary" onClick={handleSignIn} disabled={!authConfigured || busy} className="w-full">
                <LogIn size={16} />
                {busy ? 'Signing in…' : 'Sign in with Google'}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <span className="w-9 h-9 rounded-full bg-accent/10 text-accent font-semibold flex items-center justify-center flex-shrink-0">
                  {initial}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{accountEmail || sync.email || 'Google account'}</p>
                  {isCloudConfigured() && sync.status !== 'signed-out' && (
                    <p className="text-xs text-ink-3 flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${SYNC_DOT[sync.status] || 'bg-line'}`} />
                      {sync.status === 'error' ? sync.error || 'Sync problem' : SYNC_LABEL[sync.status]}
                    </p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={busy}>
                  <LogOut size={15} />Sign out
                </Button>
              </div>
              {isCloudConfigured() && sync.status === 'signed-out' && (
                <div className="px-4 pb-4 space-y-2">
                  {authError && <Note tone="danger" className="whitespace-pre-line break-words select-text">{authError}</Note>}
                  <Button variant="primary" size="sm" onClick={handleSignIn} disabled={busy} className="w-full">
                    Turn on sync
                  </Button>
                </div>
              )}
            </>
          )}
          <div className="p-4 space-y-3">
            <label className="block">
              <span className="block text-sm text-ink">Name</span>
              <span className="block text-xs text-ink-3 mt-0.5 mb-2">
                Reminders greet you by it (“{spokenText('buy groceries', (settings.userName || '').trim())}”), and the
                assistant calls on your behalf with it.
              </span>
              <input
                value={settings.userName || ''}
                onChange={(e) => changeReminderSetting({ userName: e.target.value })}
                placeholder="Your name"
                maxLength={80}
                className={`${fieldClass} w-full`}
              />
            </label>
            <label className="block">
              <span className="block text-sm text-ink">About you</span>
              <span className="block text-xs text-ink-3 mt-0.5 mb-2">
                Facts the assistant may share on any call. Anything for one call goes in that call.
              </span>
              <textarea
                value={settings.callerAbout ?? ''}
                onChange={(e) => updateSettings({ callerAbout: e.target.value })}
                rows={4}
                maxLength={4000}
                placeholder="e.g. I go by Mk. I live in Dallas. Weekday mornings usually work. My insurance is Aetna."
                className="w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface resize-y"
              />
            </label>
          </div>
        </Section>

        <Section title="Reminders">
          <Row label="Speak reminders aloud" hint={isNative ? 'Works even when the app is closed.' : 'Only while this tab is open.'}>
            <Switch
              label="Speak reminders aloud"
              checked={settings.voiceRemindersEnabled !== false}
              onChange={handleVoiceToggle}
            />
          </Row>
          <Row label="Voice">
            <select
              value={voices.some((v) => v.id === settings.voiceName) ? settings.voiceName : ''}
              onChange={(e) => changeReminderSetting({ voiceName: e.target.value })}
              className={`${fieldClass} w-44`}
            >
              <option value="">Automatic</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Row>
          <Row label="Pitch">
            <div className="flex items-center gap-2">
              <select
                value={settings.voicePitch}
                onChange={(e) => changeReminderSetting({ voicePitch: Number(e.target.value) })}
                className={`${fieldClass} w-32`}
              >
                {PITCHES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <IconButton label="Preview the voice" onClick={() => announce('buy groceries').catch(console.error)}>
                <Play size={16} />
              </IconButton>
            </div>
          </Row>
          <Row label="Until done" hint="Keeps the notification up until you mark the task done.">
            <Switch
              label="Keep notifications until done"
              checked={settings.notificationStyle === 'sticky'}
              onChange={(on) => changeReminderSetting({ notificationStyle: on ? 'sticky' : 'normal' })}
            />
          </Row>
          {settings.notificationStyle === 'sticky' && (
            <Row label="Remind again every">
              <select
                value={settings.notificationRepeatMinutes}
                onChange={(e) => changeReminderSetting({ notificationRepeatMinutes: Number(e.target.value) })}
                className={`${fieldClass} w-32`}
              >
                <option value={0}>Never</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </Row>
          )}
          {(isNative || permStatus) && (
            <Row
              label="Permissions"
              hint={permStatus ? `Notifications ${permStatus.notifications}${isNative ? ` · exact alarms ${permStatus.exactAlarms}` : ''}` : undefined}
            >
              <Button size="sm" onClick={handleRequestPermissions}>Grant</Button>
            </Row>
          )}
        </Section>

        <Section title="Calendar">
          {isNative && (
            <>
              <Row label="This phone's calendar" hint="Show the next two weeks of events from every account on this phone.">
                <Switch
                  label="Show events from this phone"
                  checked={!!settings.phoneCalendarEnabled}
                  disabled={busy}
                  onChange={handlePhoneToggle}
                />
              </Row>
              {readsPhone && phoneCalendars.length > 0 && (
                <div className="px-4 py-2">
                  {phoneCalendars.map((c) => {
                    const shown = !(settings.phoneCalendarHiddenIds || []).includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="checkbox"
                        aria-checked={shown}
                        disabled={busy}
                        onClick={() => togglePhoneCalendar(c.id)}
                        className="w-full flex items-center gap-3 py-2 text-left"
                      >
                        <span className={`w-[18px] h-[18px] rounded-[5px] border-[1.5px] flex-shrink-0 flex items-center justify-center ${
                          shown ? 'bg-accent border-accent text-accent-ink' : 'border-ink-3'
                        }`}>
                          {shown && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm text-ink truncate">{c.name || 'Calendar'}</span>
                          {c.account && c.account !== c.name && (
                            <span className="block text-xs text-ink-3 truncate">{c.account}</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              {phoneMsg && <p className="text-xs text-ink-2 px-4 py-3">{phoneMsg}</p>}
            </>
          )}
          {gcalSignedIn ? (
            <>
              <Row label="Add tasks to Google Calendar" hint="Tasks with a date become calendar events.">
                <Switch
                  label="Add tasks to Google Calendar"
                  checked={!!settings.googleCalendarEnabled}
                  onChange={(on) => updateSettings({ googleCalendarEnabled: on })}
                />
              </Row>
              <Row label="Calendar ID" hint="Usually “primary”.">
                <input
                  value={settings.googleCalendarId}
                  onChange={(e) => updateSettings({ googleCalendarId: e.target.value })}
                  placeholder="primary"
                  className={`${fieldClass} w-40`}
                />
              </Row>
            </>
          ) : (
            <p className="text-sm text-ink-3 px-4 py-3.5">Sign in above to connect Google Calendar.</p>
          )}
          {(gcalSignedIn || readsPhone) && (
            <Row label="Import upcoming events" hint={syncMsg || 'Happens automatically when you open the app.'}>
              <Button size="sm" onClick={readsPhone ? () => runImport(setPhoneMsg) : handleImport} disabled={busy}>
                <RefreshCw size={14} />Sync now
              </Button>
            </Row>
          )}
        </Section>

        <Section title="Calling">
          <CallingSettings />
        </Section>
      </div>
    </Sheet>
  )
}

const SYNC_LABEL = {
  connecting: 'Connecting…',
  synced: 'Synced across your devices',
  pending: 'Saving changes…',
  offline: 'Offline. Changes will sync when you reconnect.',
  error: 'Sync problem',
}
const SYNC_DOT = {
  synced: 'bg-success',
  pending: 'bg-warn',
  connecting: 'bg-warn',
  offline: 'bg-ink-3',
  error: 'bg-danger',
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="px-1 mb-2 text-[13px] font-semibold text-ink-2">{title}</h3>
      <div className="bg-surface rounded-xl border border-line divide-y divide-line">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 min-h-[56px]">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-3 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}
