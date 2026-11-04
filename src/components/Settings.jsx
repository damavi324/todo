import { useState, useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { useTaskStore, DEFAULT_SKILLS } from '../store/useTaskStore'
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
import { useBack } from '../lib/backStack'
import {
  LogOut, LogIn, RefreshCw, Play, Check, Plus, Trash2, RotateCcw, ChevronRight,
  UserRound, Bell, CalendarDays, Phone, Sparkles, Gauge, SlidersHorizontal,
} from 'lucide-react'
import { Button, ErrorNote, IconButton, Section, Sheet, Switch, fieldClass } from './ui'
import CallingSettings from './CallingSettings'
import UsagePanel from './UsagePanel'

const PAGE_TITLES = {
  account: 'Account & sync',
  profile: 'Profile',
  reminders: 'Reminders',
  calendar: 'Calendar',
  calling: 'Calling',
  skills: 'Call skills',
  advanced: 'Advanced',
}

/** Settings opens on a short menu; each group of settings is its own page, and Back returns to the menu. */
export default function Settings({ onClose }) {
  const { settings, updateSettings } = useTaskStore()
  const sync = useSyncStore()
  const [page, setPage] = useState(null)
  const [usageOpen, setUsageOpen] = useState(false)
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
  const nameTimer = useRef(null)
  const top = useRef(null)
  // Back (and Escape) on a page returns to the menu instead of closing Settings.
  useBack(() => setPage(null), !!page)
  // Each page starts at its top, not wherever the last one was scrolled to.
  useEffect(() => { top.current?.parentElement?.scrollTo(0, 0) }, [page])
  // Closing Settings mid-typing still re-schedules with the new name.
  useEffect(() => () => {
    if (nameTimer.current) { clearTimeout(nameTimer.current); syncReminders().catch(console.error) }
  }, [])

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

  // The Calendar sign-in lapses after about an hour on the web, but sync stays signed in, so either counts.
  const syncSignedIn = isCloudConfigured() && !['off', 'signed-out'].includes(sync.status)
  const signedIn = gcalSignedIn || syncSignedIn
  const email = accountEmail || sync.email || ''
  const initial = (email || '?').trim().charAt(0).toUpperCase()
  const authProblem = !authConfigured ? 'missing' : !webClientMatchesAppProject() ? 'project' : ''
  const needsPermission = !!permStatus &&
    (permStatus.notifications !== 'granted' || (isNative && permStatus.exactAlarms !== 'granted'))

  const pages = {
    account: (
      <Section>
        {!signedIn ? (
          <div className="p-4 space-y-3">
            <p className="text-sm text-ink-2">
              Sign in with Google to keep your tasks the same on your phone and the web, and to connect Google Calendar.
              {isCloudConfigured() && ' Everything still works offline and catches up when you reconnect.'}
            </p>
            {authProblem && <AuthSetupNote problem={authProblem} />}
            {authError && <ErrorNote>{authError}</ErrorNote>}
            <Button variant="primary" onClick={handleSignIn} disabled={!authConfigured || busy} className="w-full">
              <LogIn size={16} />
              {busy ? 'Signing in…' : 'Sign in with Google'}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Avatar initial={initial} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{email || 'Google account'}</p>
                {isCloudConfigured() && sync.status !== 'signed-out' && <SyncStatus status={sync.status} />}
              </div>
              <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={busy}>
                <LogOut size={15} />Sign out
              </Button>
            </div>
            {sync.status === 'error' && sync.error && (
              <div className="px-4 py-3"><ErrorNote summary="Your changes aren’t syncing right now.">{sync.error}</ErrorNote></div>
            )}
            {isCloudConfigured() && sync.status === 'signed-out' && (
              <div className="px-4 py-3 space-y-2">
                <p className="text-xs text-ink-3">Sync is off on this device.</p>
                {authError && <ErrorNote>{authError}</ErrorNote>}
                <Button variant="primary" size="sm" onClick={handleSignIn} disabled={busy} className="w-full">
                  Turn on sync
                </Button>
              </div>
            )}
          </>
        )}
      </Section>
    ),

    profile: (
      <Section>
        <div className="p-4 space-y-4">
          <label className="block">
            <span className="block text-sm text-ink">Name</span>
            <span className="block text-xs text-ink-3 mt-0.5 mb-2">
              Reminders greet you by it (“{spokenText('buy groceries', (settings.userName || '').trim())}”), and the
              assistant calls on your behalf with it.
            </span>
            <input
              value={settings.userName || ''}
              onChange={(e) => {
                // Reminders are re-scheduled once typing pauses, not on every letter.
                updateSettings({ userName: e.target.value })
                clearTimeout(nameTimer.current)
                nameTimer.current = setTimeout(() => { nameTimer.current = null; syncReminders().catch(console.error) }, 800)
              }}
              placeholder="Your name"
              maxLength={80}
              className={`${fieldClass} w-full`}
            />
          </label>
          <label className="block">
            <span className="block text-sm text-ink">Assistant’s name</span>
            <span className="block text-xs text-ink-3 mt-0.5 mb-2">
              What your assistant calls itself on calls: “This is {(settings.assistantName || '').trim() || 'Pilot'}, an AI assistant for {(settings.userName || '').trim() || 'you'}.”
            </span>
            <input
              value={settings.assistantName ?? ''}
              onChange={(e) => updateSettings({ assistantName: e.target.value })}
              placeholder="Pilot"
              maxLength={40}
              autoCapitalize="words"
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
    ),

    reminders: (
      <>
        <Section>
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
              className={`${fieldClass} w-40`}
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
                className={`${fieldClass} w-28`}
              >
                {PITCHES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <IconButton label="Preview the voice" onClick={() => announce('buy groceries').catch(console.error)}>
                <Play size={16} />
              </IconButton>
            </div>
          </Row>
        </Section>
        <Section title="Notifications">
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
          {needsPermission && (
            <Row label="Permission needed" hint="Reminders may not show or ring on time.">
              <Button size="sm" onClick={handleRequestPermissions}>Allow</Button>
            </Row>
          )}
        </Section>
      </>
    ),

    calendar: (
      <>
        {isNative && (
          <Section title="This phone">
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
            {phoneMsg && <p className="text-xs text-ink-2 px-4 py-3 break-words">{phoneMsg}</p>}
          </Section>
        )}
        <Section title="Google Calendar">
          {gcalSignedIn ? (
            <Row label="Add tasks to Google Calendar" hint="Tasks with a date become calendar events.">
              <Switch
                label="Add tasks to Google Calendar"
                checked={!!settings.googleCalendarEnabled}
                onChange={(on) => updateSettings({ googleCalendarEnabled: on })}
              />
            </Row>
          ) : signedIn ? (
            <div className="px-4 py-3.5 space-y-2">
              <p className="text-sm text-ink-3">Not connected on this device. Its sign-in expires after a while.</p>
              {authError && <ErrorNote>{authError}</ErrorNote>}
              <Button size="sm" onClick={handleSignIn} disabled={busy || !authConfigured}>
                <LogIn size={14} />Connect Google Calendar
              </Button>
            </div>
          ) : (
            <div className="px-4 py-3.5 space-y-2">
              <p className="text-sm text-ink-3">Sign in with Google to connect your calendar.</p>
              <Button size="sm" onClick={() => setPage('account')}>Go to Account & sync</Button>
            </div>
          )}
          {(gcalSignedIn || readsPhone) && (
            <Row label="Import upcoming events" hint={syncMsg || 'Happens automatically when you open the app.'}>
              <Button size="sm" onClick={readsPhone ? () => runImport(setPhoneMsg) : handleImport} disabled={busy}>
                <RefreshCw size={14} />Sync now
              </Button>
            </Row>
          )}
        </Section>
      </>
    ),

    calling: <CallingSettings onOpenProfile={() => setPage('profile')} />,

    skills: (
      <Section>
        <CallSkills settings={settings} updateSettings={updateSettings} />
      </Section>
    ),

    advanced: (
      <>
        <Section title="Google Calendar">
          <Row label="Calendar ID" hint="Where tasks are added. Usually “primary”.">
            <input
              value={settings.googleCalendarId}
              onChange={(e) => updateSettings({ googleCalendarId: e.target.value })}
              placeholder="primary"
              className={`${fieldClass} w-32`}
            />
          </Row>
        </Section>
        {(isNative || permStatus) && (
          <Section title="Reminder permissions">
            <Row
              label="Permissions"
              hint={permStatus ? `Notifications ${permStatus.notifications}${isNative ? ` · exact alarms ${permStatus.exactAlarms}` : ''}` : undefined}
            >
              <Button size="sm" onClick={handleRequestPermissions}>Grant</Button>
            </Row>
          </Section>
        )}
        <Section title="Diagnostics">
          <Row label="App" hint={isNative ? 'Android app' : 'Web'} />
          <Row label="Sync" hint={!isCloudConfigured() ? 'Not set up in this build' : SYNC_LABEL[sync.status] || sync.status} />
          {sync.status === 'error' && sync.error && (
            <div className="px-4 py-3"><ErrorNote summary="Last sync error">{sync.error}</ErrorNote></div>
          )}
          <Row label="Google sign-in" hint={authProblem ? 'Needs setup' : gcalSignedIn ? 'Calendar connected on this device' : 'Ready'} />
          {authProblem && <div className="px-4 py-3"><AuthSetupNote problem={authProblem} /></div>}
          <Row label="Calling server" hint={settings.callpilotConnected ? settings.callpilotUrl : 'Not connected'} />
        </Section>
      </>
    ),
  }

  const callServerHost = (() => {
    try { return new URL(settings.callpilotUrl).host } catch { return settings.callpilotUrl }
  })()
  const skillsOn = (settings.callSkills || []).filter((s) => s.on).length
  const calendarSummary = [
    readsPhone && 'This phone',
    gcalSignedIn && settings.googleCalendarEnabled && 'Google Calendar',
  ].filter(Boolean).join(' · ') || 'Not connected'

  return (
    <Sheet title={page ? PAGE_TITLES[page] : 'Settings'} onClose={onClose} onBack={page ? () => setPage(null) : undefined}>
      {/* A steady height on phones, so the sheet doesn't jump (and a tap doesn't land outside it) between pages. */}
      <div ref={top} className="px-4 md:px-6 py-5 space-y-6 min-h-[80dvh] md:min-h-0">
        {page ? pages[page] : (
          <>
            <Section>
              <button type="button" onClick={() => setPage('account')} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2 transition-colors">
                {signedIn ? <Avatar initial={initial} /> : (
                  <span className="w-9 h-9 rounded-full bg-surface-2 text-ink-3 flex items-center justify-center flex-shrink-0"><UserRound size={18} /></span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink truncate">{signedIn ? email || 'Google account' : 'Sign in with Google'}</span>
                  {signedIn && isCloudConfigured() && sync.status !== 'signed-out'
                    ? <SyncStatus status={sync.status} />
                    : <span className="block text-xs text-ink-3 mt-0.5">{signedIn ? 'Sync is off on this device' : 'Sync your tasks and connect your calendar'}</span>}
                </span>
                <ChevronRight size={17} className="text-ink-3 flex-shrink-0" />
              </button>
            </Section>

            <Section title="General">
              <MenuRow icon={UserRound} label="Profile" onClick={() => setPage('profile')}
                summary={[(settings.userName || '').trim() || 'Add your name', `Assistant: ${(settings.assistantName || '').trim() || 'Pilot'}`].join(' · ')} />
              <MenuRow icon={Bell} label="Reminders" onClick={() => setPage('reminders')} alert={needsPermission}
                summary={needsPermission ? 'Permission needed' : [
                  settings.voiceRemindersEnabled !== false ? 'Spoken aloud' : 'Notifications only',
                  settings.notificationStyle === 'sticky' && 'until done',
                ].filter(Boolean).join(', ')} />
              <MenuRow icon={CalendarDays} label="Calendar" summary={calendarSummary} onClick={() => setPage('calendar')} />
            </Section>

            <Section title="Calling assistant">
              <MenuRow icon={Phone} label="Calling" onClick={() => setPage('calling')}
                summary={settings.callpilotConnected ? `Connected · ${callServerHost}` : 'Connect your calling server'} />
              <MenuRow icon={Sparkles} label="Call skills" onClick={() => setPage('skills')}
                summary={settings.useSkills === false ? 'Off' : `${skillsOn} on`} />
              {settings.callpilotConnected && (
                <MenuRow icon={Gauge} label="Usage & credits" summary="Balances and what calls cost" onClick={() => setUsageOpen(true)} />
              )}
            </Section>

            <Section>
              <MenuRow icon={SlidersHorizontal} label="Advanced" summary="Calendar ID, permissions, diagnostics" onClick={() => setPage('advanced')} />
            </Section>
          </>
        )}
      </div>
      {usageOpen && <UsagePanel onClose={() => setUsageOpen(false)} />}
    </Sheet>
  )
}

const SYNC_LABEL = {
  connecting: 'Connecting…',
  synced: 'Synced across your devices',
  pending: 'Saving changes…',
  offline: 'Offline. Changes will sync when you reconnect.',
  error: 'Sync problem',
  'signed-out': 'Off on this device',
  off: 'Off',
}
const SYNC_DOT = {
  synced: 'bg-success',
  pending: 'bg-warn',
  connecting: 'bg-warn',
  offline: 'bg-ink-3',
  error: 'bg-danger',
}

function SyncStatus({ status }) {
  return (
    <span className={`flex items-center gap-1.5 mt-0.5 text-xs ${status === 'error' ? 'text-danger' : 'text-ink-3'}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SYNC_DOT[status] || 'bg-line'}`} />
      <span className="truncate">{SYNC_LABEL[status] || status}</span>
    </span>
  )
}

function Avatar({ initial }) {
  return (
    <span className="w-9 h-9 rounded-full bg-accent/10 text-accent font-semibold flex items-center justify-center flex-shrink-0">
      {initial}
    </span>
  )
}

/** Google sign-in can't work in this build: one line for everyone, the fix behind Details for the developer. */
function AuthSetupNote({ problem }) {
  return problem === 'missing' ? (
    <ErrorNote tone="warn" summary="Google sign-in isn’t set up in this build.">
      Add <code className="font-mono">VITE_GOOGLE_WEB_CLIENT_ID</code> to <code className="font-mono">.env.local</code> and
      create the matching Android OAuth client (package <code className="font-mono">com.todo.voice</code> + SHA-1).
    </ErrorNote>
  ) : (
    <ErrorNote tone="warn" summary="Google sign-in may be refused: the app’s Google setup doesn’t match.">
      <code className="font-mono">VITE_GOOGLE_WEB_CLIENT_ID</code> is from a different Google Cloud project than this app
      ({GOOGLE_PROJECT_NUMBER}, todo-88bb6). Use the todo-88bb6 Web client, or remove it from{' '}
      <code className="font-mono">.env.local</code>, and rebuild.
    </ErrorNote>
  )
}

/**
 * Standing instructions the calling assistant follows on every call (how to open, what to say first...).
 * Each can be switched off or removed; turning skills off altogether saves tokens and uses the standard call.
 */
function CallSkills({ settings, updateSettings }) {
  const on = settings.useSkills !== false
  const skills = settings.callSkills || []
  const [draft, setDraft] = useState('')
  const save = (next) => updateSettings({ callSkills: next })
  const add = () => {
    const text = draft.trim()
    if (!text) return
    save([...skills, { id: `s${Date.now().toString(36)}`, on: true, text }])
    setDraft('')
  }
  return (
    <>
      <Row label="Use skills" hint={on ? 'Every AI call is planned and made with the skills below.' : 'Off: calls use the standard opening and plan, with fewer tokens.'}>
        <Switch label="Use skills" checked={on} onChange={(v) => updateSettings({ useSkills: v })} />
      </Row>
      <div className={`p-4 space-y-2 ${on ? '' : 'opacity-50'}`}>
        {skills.map((sk, i) => (
          <div key={sk.id} className="flex items-start gap-2">
            <input type="checkbox" checked={sk.on} disabled={!on} aria-label="Use this skill"
              onChange={(e) => save(skills.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
              className="mt-2.5 w-4 h-4 accent-[rgb(var(--accent))] flex-shrink-0" />
            <textarea value={sk.text} disabled={!on} rows={4} maxLength={600}
              onChange={(e) => save(skills.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              className="flex-1 min-w-0 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface resize-y" />
            <IconButton label="Remove skill" disabled={!on} onClick={() => save(skills.filter((_, j) => j !== i))} className="flex-shrink-0 hover:text-danger">
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
        <div className="flex items-start gap-2 pt-1">
          <textarea value={draft} disabled={!on} rows={2} maxLength={600} placeholder="Add a skill, e.g. Always ask for a confirmation number."
            onChange={(e) => setDraft(e.target.value)}
            className="flex-1 min-w-0 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface resize-y" />
          <IconButton label="Add skill" disabled={!on || !draft.trim()} onClick={add} className="flex-shrink-0"><Plus size={17} /></IconButton>
        </div>
        <button type="button" disabled={!on} onClick={() => save(DEFAULT_SKILLS)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink disabled:pointer-events-none">
          <RotateCcw size={12} />Restore the starting skills
        </button>
      </div>
    </>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 min-h-[56px]">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-3 mt-0.5 break-words">{hint}</p>}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  )
}

/** A line of the Settings menu that opens one of its pages. */
function MenuRow({ icon: Icon, label, summary, alert, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 min-h-[56px] text-left hover:bg-surface-2 transition-colors">
      <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
        <Icon size={17} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {summary && <span className={`block text-xs truncate mt-0.5 ${alert ? 'text-warn' : 'text-ink-3'}`}>{summary}</span>}
      </span>
      <ChevronRight size={17} className="text-ink-3 flex-shrink-0" />
    </button>
  )
}
