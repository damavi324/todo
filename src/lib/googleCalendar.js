const SCOPES = 'https://www.googleapis.com/auth/calendar'
const DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'

let gapiReady = false
let tokenClient = null

export function loadGoogleApis(clientId, onReady) {
  if (gapiReady) { onReady(); return }

  const gapiScript = document.createElement('script')
  gapiScript.src = 'https://apis.google.com/js/api.js'
  gapiScript.onload = () => {
    window.gapi.load('client', async () => {
      await window.gapi.client.init({ discoveryDocs: [DISCOVERY] })
      gapiReady = true

      const gisScript = document.createElement('script')
      gisScript.src = 'https://accounts.google.com/gsi/client'
      gisScript.onload = () => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: () => {},
        })
        onReady()
      }
      document.head.appendChild(gisScript)
    })
  }
  document.head.appendChild(gapiScript)
}

export function signIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) { reject(new Error('Google APIs not loaded')); return }
    tokenClient.callback = (resp) => {
      if (resp.error) reject(resp)
      else resolve(resp)
    }
    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

export function signOut() {
  const token = window.gapi?.client?.getToken()
  if (token) window.google?.accounts?.oauth2?.revoke(token.access_token)
  window.gapi?.client?.setToken(null)
}

export function isSignedIn() {
  return !!window.gapi?.client?.getToken()
}

export async function createCalendarEvent(task, calendarId = 'primary') {
  const start = task.dueDate
    ? buildDateTime(task.dueDate, task.dueTime)
    : { date: new Date().toISOString().split('T')[0] }

  const end = task.dueTime
    ? buildDateTime(task.dueDate, incrementHour(task.dueTime))
    : start.date
      ? { date: start.date }
      : { dateTime: new Date(new Date(start.dateTime).getTime() + 3600000).toISOString() }

  const event = {
    summary: task.title,
    description: task.notes || '',
    start,
    end,
    extendedProperties: { private: { todoTaskId: task.id } },
  }

  const res = await window.gapi.client.calendar.events.insert({ calendarId, resource: event })
  return res.result.id
}

export async function updateCalendarEvent(googleEventId, task, calendarId = 'primary') {
  if (!googleEventId) return
  const start = task.dueDate
    ? buildDateTime(task.dueDate, task.dueTime)
    : { date: new Date().toISOString().split('T')[0] }
  const end = task.dueTime
    ? buildDateTime(task.dueDate, incrementHour(task.dueTime))
    : start

  await window.gapi.client.calendar.events.patch({
    calendarId,
    eventId: googleEventId,
    resource: { summary: task.title, description: task.notes || '', start, end },
  })
}

export async function deleteCalendarEvent(googleEventId, calendarId = 'primary') {
  if (!googleEventId) return
  await window.gapi.client.calendar.events.delete({ calendarId, eventId: googleEventId })
}

export async function fetchUpcomingEvents(calendarId = 'primary') {
  const res = await window.gapi.client.calendar.events.list({
    calendarId,
    timeMin: new Date().toISOString(),
    maxResults: 50,
    singleEvents: true,
    orderBy: 'startTime',
  })
  return res.result.items || []
}

function buildDateTime(date, time) {
  if (time) {
    return { dateTime: `${date}T${time}:00`, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  }
  return { date }
}

function incrementHour(time) {
  const [h, m] = time.split(':').map(Number)
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
