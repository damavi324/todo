// On-phone copy of every finished call: transcript, summary, plan and redial info.
// The server may forget calls (a free cloud server wipes its disk when it sleeps),
// so the phone keeps its own history and shows it even when the server is asleep or offline.
const INDEX_KEY = 'callpilot.calls.index'
const CALL_KEY = (id) => `callpilot.call.${id}`
const MAX_CALLS = 200

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false // storage full or blocked; history just won't be cached
  }
}

const isFinished = (c) => !!c && (!!c.endedAt || ['ended', 'failed', 'busy', 'no-answer', 'canceled'].includes(c.status))

/** Same light shape as the server's list, so the History screen can show either. */
export function toListItem(c) {
  return {
    id: c.id, mode: c.mode, to: c.to, goal: c.goal, status: c.status, startedAt: c.startedAt, endedAt: c.endedAt,
    error: c.error || null, outcome: c.outcome ?? c.summary?.outcome ?? null, headline: c.headline ?? c.summary?.headline ?? null,
    hasPlan: c.hasPlan ?? !!c.plan, briefChars: c.briefChars ?? (c.brief || '').length,
  }
}

export function archivedList() {
  return read(INDEX_KEY, [])
}

export function archivedCall(id) {
  return read(CALL_KEY(id), null)
}

/** True when the phone already has the final version of this call. */
export function hasFinal(item) {
  const saved = archivedList().find((c) => c.id === item.id)
  return !!saved && saved.final && saved.status === item.status && (!!saved.headline || !item.headline)
}

/** Saves a full call record (only finished calls are worth keeping). */
export function archiveCall(call) {
  if (!call?.id || !isFinished(call)) return false
  if (!write(CALL_KEY(call.id), call)) return false
  const item = { ...toListItem(call), final: !!call.summary || !!call.error || call.status !== 'ended' || !(call.transcript || []).length }
  const list = [item, ...archivedList().filter((c) => c.id !== call.id)]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  for (const old of list.slice(MAX_CALLS)) {
    try { localStorage.removeItem(CALL_KEY(old.id)) } catch { /* ignore */ }
  }
  write(INDEX_KEY, list.slice(0, MAX_CALLS))
  return true
}

/** Server list + phone list, newest first. The server wins for calls it still knows about. */
export function mergeHistory(serverList = []) {
  const ids = new Set(serverList.map((c) => c.id))
  return [...serverList, ...archivedList().filter((c) => !ids.has(c.id))]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}

export function forgetCall(id) {
  try { localStorage.removeItem(CALL_KEY(id)) } catch { /* ignore */ }
  write(INDEX_KEY, archivedList().filter((c) => c.id !== id))
}
