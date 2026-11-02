// What the AI services used, for the Usage page. Calls carry their own usage (saved with each call);
// the voice assistant's requests, which aren't calls, are kept in a small list on this device.
const OTHER_KEY = 'callpilot.usage.other'
const MAX_OTHER = 500

// Claude API list prices in US dollars per million tokens (input, output).
export const CLAUDE_PRICES = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],
}

/** Estimated dollars for { [model]: { in, out } }; models without a known price count as zero. */
export function claudeCost(byModel = {}) {
  let total = 0
  for (const [model, t] of Object.entries(byModel)) {
    const price = CLAUDE_PRICES[model]
    if (price) total += ((t.in || 0) * price[0] + (t.out || 0) * price[1]) / 1e6
  }
  return total
}

/** Adds one tally of tokens into another (both { [model]: { in, out, calls } }). */
export function addTokens(into, from = {}) {
  for (const [model, t] of Object.entries(from || {})) {
    const x = (into[model] ||= { in: 0, out: 0, calls: 0 })
    x.in += t.in || 0
    x.out += t.out || 0
    x.calls += t.calls || 0
  }
  return into
}

export function otherUsage() {
  try {
    return JSON.parse(localStorage.getItem(OTHER_KEY) || '[]')
  } catch {
    return []
  }
}

/** Remembers tokens used outside a call (the voice assistant), so the Usage page can count them. */
export function recordOtherUsage(kind, claude) {
  if (!claude || !Object.keys(claude).length) return
  try {
    const list = [{ at: new Date().toISOString(), kind, claude }, ...otherUsage()].slice(0, MAX_OTHER)
    localStorage.setItem(OTHER_KEY, JSON.stringify(list))
  } catch { /* storage full or blocked: the page just won't count this one */ }
}

const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString() }

/** Totals for calls (from the call history) and other requests, this month or all time. */
export function usageTotals(calls, { month = true } = {}) {
  const since = month ? startOfMonth() : ''
  const inRange = (iso) => !since || (iso || '') >= since
  const picked = calls.filter((c) => inRange(c.startedAt))
  const out = { calls: picked.length, agentSeconds: 0, talkSeconds: 0, callTokens: {}, otherTokens: {}, assistantRequests: 0 }
  for (const c of picked) {
    const secs = c.usage?.seconds || 0
    if (c.mode === 'agent') out.agentSeconds += secs
    else out.talkSeconds += secs
    addTokens(out.callTokens, c.usage?.claude)
  }
  for (const o of otherUsage().filter((o) => inRange(o.at))) {
    out.assistantRequests += 1
    addTokens(out.otherTokens, o.claude)
  }
  return out
}
