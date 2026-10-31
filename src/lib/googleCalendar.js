import { SocialLogin } from '@capgo/capacitor-social-login'
import { Capacitor } from '@capacitor/core'
import { CALENDAR_SCOPES, GOOGLE_WEB_CLIENT_ID, isGoogleAuthConfigured } from '../config/googleAuth'
import { useTaskStore } from '../store/useTaskStore'
import DeviceCalendar from '../plugins/DeviceCalendar'
import { cloudSignIn, cloudSignOut } from './cloudSync'
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
    google: {
      webClientId: GOOGLE_WEB_CLIENT_ID,
      mode: 'online',
      // In a browser the sign-in popup returns to the site's address, e.g. http://localhost:5173, which is
      // what the OAuth client lists under redirect URIs. Google matches it exactly, so no trailing slash.
      ...(!Capacitor.isNativePlatform() && { redirectUrl: window.location.origin }),
    },
  })
  initialized = true
}

export async function signIn() {
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
    throw new Error('Google Sign-In did not return a Calendar access token. Check OAuth scopes and SHA-1 setup.')
  }

  const email = result?.profile?.email || ''
  saveSession({ accessToken, email, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
  useTaskStore.getState().setCalendarError('')

  // The same Google account signs in to sync. Calendar still works if this part fails.
  let syncError = ''
  try {
    await cloudSignIn({ idToken: result?.idToken, accessToken })
  } catch (e) {
    console.error(e)
    syncError = `Signed in, but sync couldn't start: ${e?.message || e}`
  }
  return { email, syncError }
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
    await cloudSignOut().catch(console.error)
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

// Timed tasks become one-hour events and date-only tasks become all-day events (undated tasks are never pushed).
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

/** True when upcoming events are read from the phone's own calendar instead of from Google. */
export function readsPhoneCalendar() {
  return Capacitor.isNativePlatform() && useTaskStore.getState().settings.phoneCalendarEnabled === true
}

async function googleUpcoming(windowEnd) {
  const { settings } = useTaskStore.getState()
  const items = await fetchUpcomingEvents(settings.googleCalendarId || 'primary', windowEnd)
  const events = items
    .filter((ev) => ev?.id && ev.status !== 'cancelled')
    .filter((ev) => !ev.attendees?.some((a) => a.self && a.responseStatus === 'declined'))
    .map((ev) => ({
      id: ev.id,
      taskId: ev.extendedProperties?.private?.todoTaskId,
      title: ev.summary || 'Calendar event',
      notes: ev.description || '',
      ...parseEventStart(ev.start),
    }))
  // Only safe to infer deletions when the window wasn't truncated.
  return { events, complete: items.length < IMPORT_MAX_EVENTS }
}

async function phoneUpcoming(now, windowEnd) {
  const { settings } = useTaskStore.getState()
  const hidden = new Set(settings.phoneCalendarHiddenIds || [])
  const { events = [] } = await DeviceCalendar.getEvents({ from: now.getTime(), to: windowEnd.getTime() })
  return {
    complete: true,
    events: events
      .filter((ev) => !hidden.has(ev.calendarId))
      .map((ev) => {
        const start = new Date(ev.begin)
        return {
          id: phoneEventKey(ev, start),
          title: ev.title || 'Calendar event',
          notes: ev.description || '',
          dueDate: ev.allDay ? ev.date : toLocalYMD(start),
          dueTime: ev.allDay ? '' : toLocalHM(start),
        }
      }),
  }
}

// Google events on the phone carry their Google id, and a repeat of a recurring event is named the way
// Google names it. So a task pushed to Google is recognised when it comes back through the phone, and
// tasks imported earlier from Google are kept rather than duplicated.
function phoneEventKey(ev, start) {
  if (!ev.syncId) return `phone:${ev.eventId}:${ev.begin}`
  if (!ev.recurring) return ev.syncId
  const stamp = start.toISOString().replace(/[-:]|\.\d+/g, '')
  return `${ev.syncId}_${ev.allDay ? stamp.slice(0, 8) : stamp}`
}

/**
 * Mirror the next two weeks of the calendar into tasks so they get reminders. Events are read from the
 * phone's calendar when that is switched on, otherwise from Google Calendar.
 * Imported tasks follow the calendar: changed events update them, deleted events remove them.
 * Tasks created in the app are never touched here.
 */
export async function importUpcomingEvents() {
  const now = new Date()
  const windowEnd = addDays(now, IMPORT_WINDOW_DAYS)
  const { events, complete } = readsPhoneCalendar()
    ? await phoneUpcoming(now, windowEnd)
    : await googleUpcoming(windowEnd)

  removeDuplicateImports(useTaskStore.getState())
  const store = useTaskStore.getState()
  // Where these events came from. Each device only removes events from the source it reads, so a phone
  // reading its own calendar and a browser reading Google don't delete each other's imports.
  const origin = readsPhoneCalendar() ? 'phone' : 'google'
  const dismissed = new Set(store.dismissedEventIds)
  const taskIds = new Set(store.tasks.map((t) => t.id))
  const byEventId = new Map(store.tasks.filter((t) => t.googleEventId).map((t) => [t.googleEventId, t]))
  const inboxId = store.lists.find((l) => l.id === 'inbox')?.id || store.lists[0]?.id || 'inbox'
  const seen = new Set()
  const today = startOfToday()
  const result = { imported: 0, updated: 0, removed: 0 }

  for (const ev of events) {
    seen.add(ev.id)
    if (dismissed.has(ev.id)) continue
    // An event that began on an earlier day and is still running has nothing left to remind about.
    if (parseLocalDate(ev.dueDate) < today) continue
    if (taskIds.has(ev.taskId)) continue

    const fromEvent = { title: ev.title, dueDate: ev.dueDate, dueTime: ev.dueTime }
    const existing = byEventId.get(ev.id)

    if (!existing) {
      store.addTask({
        ...fromEvent,
        id: importedTaskId(ev.id),
        notes: ev.notes,
        priority: 'none',
        listId: inboxId,
        googleEventId: ev.id,
        source: 'calendar',
        calendarOrigin: origin,
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

  if (complete) {
    for (const task of useTaskStore.getState().tasks) {
      if (task.source !== 'calendar' || task.completed || seen.has(task.googleEventId)) continue
      if ((task.calendarOrigin || 'google') !== origin) continue
      const due = dueDateTime(task)
      if (due && due > now && due < windowEnd) {
        store.deleteTask(task.id)
        result.removed += 1
      }
    }
  }

  return result
}

/** The task id for an imported event: the same on every device, so syncing never doubles it. */
function importedTaskId(eventId) {
  return `cal-${String(eventId).replace(/\//g, '_')}`
}

/**
 * Imports made before ids were fixed got random ids, so the same event imported on two devices shows up
 * twice once they sync. Keep one task per event, preferring one already marked done.
 */
function removeDuplicateImports(store) {
  const byEvent = new Map()
  for (const task of store.tasks) {
    if (task.source !== 'calendar' || !task.googleEventId) continue
    const kept = byEvent.get(task.googleEventId)
    if (!kept) {
      byEvent.set(task.googleEventId, task)
    } else if (task.completed && !kept.completed) {
      store.deleteTask(kept.id)
      byEvent.set(task.googleEventId, task)
    } else {
      store.deleteTask(task.id)
    }
  }
}

/** Background import on launch/resume. Returns true when tasks changed. */
export async function autoImport() {
  if (!(readsPhoneCalendar() || calendarActive()) || Date.now() - lastAutoImport < AUTO_IMPORT_INTERVAL_MS) return false
  lastAutoImport = Date.now()
  try {
    const r = await importUpcomingEvents()
    return r.imported + r.updated + r.removed > 0
  } catch (e) {
    // Being offline at launch is normal; only an expired sign-in needs the user's attention.
    if (e?.code === 'AUTH_EXPIRED') reportCalendarError(e)
    return false
  }
}
