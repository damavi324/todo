// Client for the CallPilot server (calls, plans, voice assistant, live events).
import { useTaskStore } from '../store/useTaskStore'

export function normalizeServerUrl(input) {
  let u = String(input || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/+$/, '')
}

export function cpSettings() {
  const s = useTaskStore.getState().settings
  return { url: normalizeServerUrl(s.callpilotUrl), token: s.callpilotToken || '', connected: !!s.callpilotConnected }
}

export const isCallPilotReady = () => {
  const c = cpSettings()
  return !!(c.url && c.connected)
}

export class CallPilotError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(url, path, { body, token, timeoutMs = 30000, method } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${url}${path}`, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) lastSeenUp = Date.now()
    if (!res.ok) {
      if (res.status === 401) {
        // Passcode changed on the server: show the connect screen instead of failing quietly.
        if (token) useTaskStore.getState().updateSettings({ callpilotConnected: false })
        throw new CallPilotError('Your calling server needs you to connect again (Settings → Calling).', 401)
      }
      throw new CallPilotError(json.error || `Server error ${res.status}`, res.status)
    }
    return json
  } catch (err) {
    if (err instanceof CallPilotError) throw err
    if (err.name === 'AbortError') throw new CallPilotError('The calling server took too long to answer.', 0)
    throw new CallPilotError('Can’t reach the calling server. Check the address in Settings → Calling, and that the server is running.', 0)
  } finally {
    clearTimeout(timer)
  }
}

/** Authenticated call to the configured server. */
export function cp(path, body, opts = {}) {
  const { url, token } = cpSettings()
  if (!url) return Promise.reject(new CallPilotError('Set up calling first (Settings → Calling).', 0))
  return request(url, path, { body, token, ...opts })
}

/** Signs in with the server passcode and saves the connection. */
export async function connectCallPilot(rawUrl, passcode) {
  const url = normalizeServerUrl(rawUrl)
  if (!url) throw new CallPilotError('Enter the server address', 0)
  // A sleeping free cloud server can take up to a minute to answer the first time.
  let health = null
  const started = Date.now()
  while (!health) {
    try {
      health = await request(url, '/api/health', { timeoutMs: 25000 })
    } catch (err) {
      if (Date.now() - started > 90000 || (err.status && ![502, 503, 504].includes(err.status))) throw err
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  if (!health?.ok) throw new CallPilotError('That address is not a CallPilot server.', 0)
  if (!health.api || health.api < 2) throw new CallPilotError('The server is an older version. Update CallPilot on the server, then try again.', 0)
  let token = ''
  if (health.needsPasscode) {
    const login = await request(url, '/api/login', { body: { passcode }, timeoutMs: 15000 })
    token = login.token || ''
  }
  await request(url, '/api/sessions', { token, timeoutMs: 15000 })
  useTaskStore.getState().updateSettings({
    callpilotUrl: url,
    callpilotToken: token,
    callpilotConnected: true,
    callpilotOwner: health.owner || '',
    callpilotAssistant: health.assistant || 'Pilot',
    callpilotProblems: (health.problems || []).filter((p) => !p.startsWith('APP_PASSCODE')),
  })
  return health
}

/**
 * Wakes the server and waits until it answers. A free cloud server sleeps after
 * ~15 idle minutes and takes 30-60 s to start, so we ping as soon as the app opens.
 * Resolves true when it's up, false if it never answered within maxMs.
 */
let wakePromise = null
let lastSeenUp = 0
export function wakeServer({ maxMs = 100000, onWaiting } = {}) {
  const { url } = cpSettings()
  if (!url) return Promise.resolve(false)
  if (Date.now() - lastSeenUp < 60000) return Promise.resolve(true)
  if (wakePromise) return wakePromise
  wakePromise = (async () => {
    const started = Date.now()
    let tries = 0
    while (Date.now() - started < maxMs) {
      try {
        const h = await request(url, '/api/health', { timeoutMs: 20000 })
        if (h?.ok) {
          lastSeenUp = Date.now()
          return true
        }
      } catch { /* still waking */ }
      tries += 1
      if (tries === 1) onWaiting?.()
      await new Promise((r) => setTimeout(r, 3000))
    }
    return false
  })().finally(() => { wakePromise = null })
  return wakePromise
}
export const markServerUp = () => { lastSeenUp = Date.now() }

export function disconnectCallPilot() {
  useTaskStore.getState().updateSettings({ callpilotToken: '', callpilotConnected: false })
}

export function socketUrl(path) {
  const { url, token } = cpSettings()
  const base = url.replace(/^http/i, 'ws')
  return `${base}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

export const assistantName = () => useTaskStore.getState().settings.callpilotAssistant || 'Pilot'
export const ownerName = () => useTaskStore.getState().settings.callpilotOwner || useTaskStore.getState().settings.userName || 'you'

export function formatNumber(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '')
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || ''
}
