import { SocialLogin } from '@capgo/capacitor-social-login'
import { Capacitor } from '@capacitor/core'
import { CALENDAR_SCOPES, GOOGLE_WEB_CLIENT_ID, isGoogleAuthConfigured } from '../config/googleAuth'
import { useTaskStore } from '../store/useTaskStore'
import { parseLocalDate, toLocalYMD, toLocalHM, startOfToday, addDays, dueDateTime } from './dates'

const SESSION_KEY = 'google-cal-session'
const API = 'https://www.googleapis.com/calendar/v3'
const IMPORT_WINDOW_DAYS = 14
const IMPORT_MAX_EVENTS = 250
const AUTO_IMPORT_INTERVAL_MS = 5 * 60 * 1000
const TOKEN_LIFETIME_MS = 55 * 60 * 1000

let initialized = false
let session = loadSession()
let lastAutoImport = 0

function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return parsed?.accessToken ? parsed : null
  } catch {
    return null
  }
}

function saveSession(next) {
  session = next
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  else localStorage.removeItem(SESSION_KEY)
}

class AuthExpiredError extends Error {
  constructor() {
    super('Google Calendar sign-in expired. Open Settings and sign in again.')
    this.code = 'AUTH_EXPIRED'
  }
}

export function isGoogleAuthReady() {
  return isGoogleAuthConfigured()
}

export async function initGoogleAuth() {
  if (!isGoogleAuthConfigured()) {
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID — add it to .env.local and rebuild')
  }
  if (initialized) return
  await SocialLogin.initialize({
    google: { webClientId: GOOGLE_WEB_CLIENT_ID, mode: 'online' },
  })
  initialized = true
}

const APP_PACKAGE = 'com.todo.voice'

// Google's sign-in errors are raw codes like "[28404] Failed to retrieve an ID token".
// Turn them into what went wrong and what to do about it, keeping the original for reference.
function describeSignInError(error) {
  const raw = String(error?.message || error || 'Unknown error')
  const text = raw.toLowerCase()
  const clientId = GOOGLE_WEB_CLIENT_ID
    ? `${GOOGLE_WEB_CLIENT_ID.slice(0, 12)}…${GOOGLE_WEB_CLIENT_ID.slice(-28)}`
    : '(not set)'

  if (/28404|28444|developer console|not configured for this installed build|failed to retrieve an id token|\b10:/.test(text)) {
    return [
      "Google didn't recognize this copy of the app, so it refused to sign you in.",
      'This is a Google Cloud setup problem, not your account. To fix it:',
      `• VITE_GOOGLE_WEB_CLIENT_ID must be the "Web application" client ID, not the Android one (now: ${clientId}).`,
      `• The same Cloud project needs an Android OAuth client for package ${APP_PACKAGE} with the SHA-1 of the key that built this APK (debug, release and Play Store keys all differ).`,
      '• If the OAuth consent screen is in Testing, add your Google account as a test user.',
      '• Rebuild the app after changing .env.local. Google changes can take a few minutes to apply.',
      'Tip: run "adb logcat -s GoogleProvider" while signing in to see the exact SHA-1 this build uses.',
    ].join('\n')
  }
  if (/no credentials|no matching credential|no google accounts|nocredential/.test(text)) {
    return [
      "Your phone didn't offer any Google account to sign in with.",
      '• Add a Google account in phone Settings → Passwords & accounts.',
      '• Make sure "Sign in with Google" prompts are on in your Google Account settings.',
    ].join('\n')
  }
  if (/reauth/.test(text)) {
    return [
      'Google asked to re-check your account and it failed.',
      '• If the OAuth consent screen is in Testing, add this account as a test user.',
      '• Supervised (Family Link) or work accounts may be blocked from this app.',
    ].join('\n')
  }
  if (error instanceof TypeError || /network|timeout|unreachable|\b7:/.test(text)) {
    return "Couldn't reach Google. Check your internet connection and try again."
  }
  if (/calendar access token/.test(text)) {
    return [
      'You signed in, but Google gave no Calendar permission.',
      '• Try again and allow Calendar access when Google asks.',
      '• Make sure the Google Calendar API is enabled in the Cloud project.',
    ].join('\n')
  }
  return 'Google Sign-In failed. Try again, and if it keeps failing check the Google Cloud OAuth setup.'
}

class SignInError extends Error {
  constructor(cause) {
    const raw = String(cause?.message || cause || 'Unknown error').replace(/^Google Sign-In failed:\s*/i, '')
    super(`${describeSignInError(cause)}\n\nDetails: ${raw}`)
    this.code = cause?.code
    this.detail = raw
  }
}

function isUserCancelled(error) {
  return error?.code === 'USER_CANCELLED' || /cancel/i.test(String(error?.message || ''))
}

export async function signIn() {
  try {
    return await signInWithGoogle()
  } catch (e) {
    if (isUserCancelled(e)) throw Object.assign(e instanceof Error ? e : new Error(String(e)), { code: 'USER_CANCELLED' })
    throw new SignInError(e)
  }
}

async function signInWithGoogle() {
  await initGoogleAuth()

  const { result } = await SocialLogin.login({
    provider: 'google',
    options: {
      scopes: CALENDAR_SCOPES,
      forceRefreshToken: Capacitor.getPlatform() === 'android',
      style: 'bottom',
    },
  })

  const accessToken = extractAccessToken(result?.accessToken)
  if (!accessToken) {
    throw new Error('Google Sign-In did not return a Calendar access token.')
  }

  const email = result?.profile?.email || ''
  saveSession({ accessToken, email, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
  useTaskStore.getState().setCalendarError('')
  return { email }
}

function extractAccessToken(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.token === 'string') return value.token
  return null
}

export async function signOut() {
  try {
    if (isGoogleAuthConfigured()) {
      await initGoogleAuth().catch(() => {})
      await SocialLogin.logout({ provider: 'google' }).catch(() => {})
    }
  } finally {
    saveSession(null)
  }
}

export function isSignedIn() {
  return !!session?.accessToken
}

export function getSignedInEmail() {
  return session?.email || ''
}

/** True when tasks should be pushed to Google Calendar. */
export function calendarActive() {
  return useTaskStore.getState().settings.googleCalendarEnabled && isSignedIn()
}

/** Show a calendar failure to the user instead of dropping it. */
export function reportCalendarError(error) {
  const message = error?.code === 'AUTH_EXPIRED'
    ? error.message
    : error instanceof TypeError
      ? "Couldn't reach Google Calendar, so this change wasn't synced."
      : `Google Calendar sync failed: ${String(error?.message || error).slice(0, 140)}`
  useTaskStore.getState().setCalendarError(message)
}

// Google access tokens last about an hour. The plugin refreshes silently and hands back the new one.
async function refreshAccessToken() {
  await initGoogleAuth()
  await SocialLogin.refresh({ provider: 'google', options: { scopes: CALENDAR_SCOPES } })
  const fresh = await SocialLogin.getAuthorizationCode({ provider: 'google' })
  const accessToken = extractAccessToken(fresh?.accessToken)
  if (!accessToken) throw new Error('No access token after refresh')
  saveSession({ ...session, accessToken, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
}

async function calendarFetch(path, { method = 'GET', body } = {}, isRetry = false) {
  if (!session?.accessToken) throw new AuthExpiredError()

  if (!isRetry && session.expiresAt && Date.now() > session.expiresAt) {
    await refreshAccessToken().catch(() => {})
  }

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    if (!isRetry) {
      const refreshed = await refreshAccessToken().then(() => true, () => false)
      if (refreshed) return calendarFetch(path, { method, body }, true)
    }
    saveSession(null)
    throw new AuthExpiredError()
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = text
    try {
      message = JSON.parse(text)?.error?.message || text
    } catch { /* not JSON */ }
    throw new Error(message || `Calendar API error ${res.status}`)
  }

  if (res.status === 204) return null
  return res.json()
}

// Timed tasks become one-hour events. Tasks with only a date, or no date at all (today), become all-day events.
// The other form is nulled so a PATCH can switch an event between timed and all-day.
function eventTimes(task) {
  if (task.dueDate && task.dueTime) {
    const start = dueDateTime(task)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const stamp = (d) => ({ dateTime: `${toLocalYMD(d)}T${toLocalHM(d)}:00`, timeZone, date: null })
    return { start: stamp(start), end: stamp(end) }
  }
  const day = parseLocalDate(task.dueDate) || startOfToday()
  const allDay = (d) => ({ date: toLocalYMD(d), dateTime: null, timeZone: null })
  return { start: allDay(day), end: allDay(addDays(day, 1)) }
}

const eventsPath = (calendarId, eventId) =>
  `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`

export async function createCalendarEvent(task, calendarId = 'primary') {
  const res = await calendarFetch(eventsPath(calendarId), {
    method: 'POST',
    body: {
      summary: task.title,
      description: task.notes || '',
      ...eventTimes(task),
      extendedProperties: { private: { todoTaskId: task.id || '' } },
    },
  })
  return res.id
}

export async function updateCalendarEvent(googleEventId, task, calendarId = 'primary') {
  if (!googleEventId) return
  await calendarFetch(eventsPath(calendarId, googleEventId), {
    method: 'PATCH',
    body: { summary: task.title, description: task.notes || '', ...eventTimes(task) },
  })
}

export async function deleteCalendarEvent(googleEventId, calendarId = 'primary') {
  if (!googleEventId) return
  await calendarFetch(eventsPath(calendarId, googleEventId), { method: 'DELETE' })
}

async function fetchUpcomingEvents(calendarId, windowEnd) {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    timeMax: windowEnd.toISOString(),
    maxResults: String(IMPORT_MAX_EVENTS),
    singleEvents: 'true',
    orderBy: 'startTime',
  })
  const res = await calendarFetch(`${eventsPath(calendarId)}?${params}`)
  return res.items || []
}

function parseEventStart(start) {
  if (start?.date) return { dueDate: start.date, dueTime: '' }
  if (start?.dateTime) {
    const d = new Date(start.dateTime)
    return { dueDate: toLocalYMD(d), dueTime: toLocalHM(d) }
  }
  return { dueDate: '', dueTime: '' }
}

/**
 * Mirror the next two weeks of Google Calendar into tasks so they get reminders.
 * Imported tasks follow the calendar: changed events update them, deleted events remove them.
 * Tasks created in the app are never touched here.
 */
export async function importUpcomingEvents(calendarId = 'primary') {
  const now = new Date()
  const windowEnd = addDays(now, IMPORT_WINDOW_DAYS)
  const events = await fetchUpcomingEvents(calendarId, windowEnd)

  const store = useTaskStore.getState()
  const dismissed = new Set(store.dismissedEventIds)
  const taskIds = new Set(store.tasks.map((t) => t.id))
  const byEventId = new Map(store.tasks.filter((t) => t.googleEventId).map((t) => [t.googleEventId, t]))
  const inboxId = store.lists.find((l) => l.id === 'inbox')?.id || store.lists[0]?.id || 'inbox'
  const seen = new Set()
  const result = { imported: 0, updated: 0, removed: 0 }

  for (const ev of events) {
    if (!ev?.id || ev.status === 'cancelled') continue
    seen.add(ev.id)
    if (dismissed.has(ev.id)) continue
    if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
    if (taskIds.has(ev.extendedProperties?.private?.todoTaskId)) continue

    const fromEvent = {
      title: ev.summary || 'Calendar event',
      ...parseEventStart(ev.start),
    }
    const existing = byEventId.get(ev.id)

    if (!existing) {
      store.addTask({
        ...fromEvent,
        notes: ev.description || '',
        priority: 'none',
        listId: inboxId,
        googleEventId: ev.id,
        source: 'calendar',
      })
      result.imported += 1
    } else if (
      existing.source === 'calendar' &&
      !existing.completed &&
      (existing.title !== fromEvent.title ||
        existing.dueDate !== fromEvent.dueDate ||
        (existing.dueTime || '') !== fromEvent.dueTime)
    ) {
      store.updateTask(existing.id, fromEvent)
      result.updated += 1
    }
  }

  // Only safe to infer deletions when the window wasn't truncated.
  if (events.length < IMPORT_MAX_EVENTS) {
    for (const task of useTaskStore.getState().tasks) {
      if (task.source !== 'calendar' || task.completed || seen.has(task.googleEventId)) continue
      const due = dueDateTime(task)
      if (due && due > now && due < windowEnd) {
        store.deleteTask(task.id)
        result.removed += 1
      }
    }
  }

  return result
}

/** Background import on launch/resume. Returns true when tasks changed. */
export async function autoImport() {
  if (!calendarActive() || Date.now() - lastAutoImport < AUTO_IMPORT_INTERVAL_MS) return false
  lastAutoImport = Date.now()
  try {
    const { settings } = useTaskStore.getState()
    const r = await importUpcomingEvents(settings.googleCalendarId || 'primary')
    return r.imported + r.updated + r.removed > 0
  } catch (e) {
    // Being offline at launch is normal; only an expired sign-in needs the user's attention.
    if (e?.code === 'AUTH_EXPIRED') reportCalendarError(e)
    return false
  }
}
