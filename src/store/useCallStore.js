// App-wide call state. Lives outside the Calls screen so Pilot's questions reach you
// on any screen, and a call keeps running while you look at your tasks.
import { create } from 'zustand'
import { cp, socketUrl, isCallPilotReady, assistantName, wakeServer, callerContext } from '../lib/callpilot'
import { archiveCall, archivedCall, mergeHistory, hasFinal, archivedList } from '../lib/callArchive'
import CallSession from '../plugins/CallSession'
import { contactFor } from '../lib/callFollowUps'

const BAD = new Set(['failed', 'busy', 'no-answer', 'canceled'])
const LIVE_TEXT = { starting: 'Starting', dialing: 'Dialing', queued: 'Dialing', initiated: 'Dialing', ringing: 'Ringing', live: 'Live', ended: 'Call ended', busy: 'Line busy', 'no-answer': 'No answer', failed: 'Call failed', canceled: 'Canceled' }
export const statusText = (s) => LIVE_TEXT[s] || s
export const isBadStatus = (s) => BAD.has(s)

let ws = null
let wsWanted = false
let reconnectTimer = null
let device = null
let devicePromise = null
let historyTimer = null

/** A saved contact's name and notes ride along as background, so the assistant knows who it's calling. */
function withContact(body) {
  const contact = contactFor(body.to)
  if (!contact || String(body.brief || '').includes(contact.name)) return body
  const lines = [`Calling: ${contact.name}`, contact.notes && `About ${contact.name}: ${contact.notes}`, body.brief]
  return { ...body, brief: lines.filter(Boolean).join('\n') }
}

const initial = {
  connected: false, // live socket up
  view: 'compose', // compose | plan | active | summary | detail
  session: null,
  status: null,
  lines: [],
  partials: { you: '', them: '' },
  suggestion: null,
  question: null,
  agentState: null,
  summary: null,
  startedAt: null,
  muted: false,
  speaker: false,
  onAudio: false, // this phone is carrying the call audio
  joinPending: false,
  pending: null, // { mode, to, goal, brief, plan } awaiting "Call now"
  draft: null, // prefill for the compose form
  draftVersion: 0, // bumps with each new draft so the form starts over from it
  detail: null,
  history: archivedList(), // phone copy first, so history shows instantly (even offline)
  serverState: 'unknown', // unknown | waking | up | down
  serverHistory: [],
  logs: [],
  unseenProblems: 0,
  logsOpen: false,
  notice: null,
  phoneState: 'off', // off | starting | ready | error
  phoneError: '',
}

export const useCallStore = create((set, get) => ({
  ...initial,

  // ---------- live connection ----------
  /** Pings the server (waking it if it's asleep) and then opens the live connection. */
  async wake() {
    if (!isCallPilotReady()) return false
    if (get().serverState === 'up' && ws && ws.readyState === 1) return true
    const up = await wakeServer({ onWaiting: () => set({ serverState: 'waking' }) })
    set({ serverState: up ? 'up' : 'down' })
    if (up) get().connect(true)
    return up
  },

  connect(awake = false) {
    if (!isCallPilotReady()) return
    wsWanted = true
    if (ws && ws.readyState <= 1) return
    clearTimeout(reconnectTimer)
    if (!awake) {
      // Make sure the server is awake first; wake() calls back into connect(true).
      get().wake()
      return
    }
    try {
      ws = new WebSocket(socketUrl('/ui'))
    } catch {
      reconnectTimer = setTimeout(() => get().connect(), 3000)
      return
    }
    ws.onopen = () => {
      set({ connected: true, serverState: 'up' })
      // Warm up the phone line in the background so the first call (or a hand-off) is instant.
      setTimeout(() => { if (!device && !devicePromise) get().ensurePhone().catch(() => {}) }, 2000)
      get().loadHistory()
    }
    ws.onerror = () => { /* onclose follows and retries */ }
    ws.onmessage = (e) => {
      try { get().handleEvent(JSON.parse(e.data)) } catch (err) { console.error(err) }
    }
    ws.onclose = () => {
      set({ connected: false })
      ws = null
      if (wsWanted) reconnectTimer = setTimeout(() => get().connect(), 2500) // goes through wake()
    }
  },
  disconnect() {
    wsWanted = false
    clearTimeout(reconnectTimer)
    try { ws?.close() } catch { /* closed */ }
    ws = null
    try { device?.destroy() } catch { /* gone */ }
    device = null
    devicePromise = null
    set({ connected: false, phoneState: 'off' })
  },

  notify(message, level = 'info') {
    set({ notice: { message, level, at: Date.now() } })
  },

  handleEvent(ev) {
    if (ev.type === 'hello') return
    if (ev.type === 'log') {
      const logs = [...get().logs, ev.entry].slice(-600)
      const problem = ev.entry.level !== 'info'
      set({ logs, unseenProblems: get().logsOpen || !problem ? get().unseenProblems : get().unseenProblems + 1 })
      return
    }
    if (ev.type === 'call_log') {
      const d = get().detail
      if (d && d.id === ev.sessionId) set({ detail: { ...d, log: [...(d.log || []), ev.line] } })
      if (ev.line.level !== 'info') get().refreshHistorySoon()
      return
    }
    const s = get().session
    if (!s || ev.sessionId !== s.id) {
      if (ev.type === 'status' || ev.type === 'summary') get().refreshHistorySoon()
      return
    }
    switch (ev.type) {
      case 'status': {
        const patch = { status: ev.status }
        if (ev.status === 'live' && !get().startedAt) patch.startedAt = Date.now()
        set(patch)
        if (ev.status === 'live') CallSession.update({ title: get().callTitle(), text: 'Live. Tap to open.' }).catch(() => {})
        if (ev.status === 'ended' || BAD.has(ev.status)) {
          get().endLocal(ev.status === 'failed' ? ev.detail : null)
          get().saveCallLocally(s.id)
        }
        break
      }
      case 'line':
        set({ lines: [...get().lines, ev.line] })
        break
      case 'partial':
        set({ partials: { ...get().partials, [ev.speaker]: ev.text } })
        break
      case 'suggestion':
        set({ suggestion: ev.suggestion })
        break
      case 'question':
        set({ question: ev.question })
        CallSession.alert({ title: `${assistantName()} needs your answer`, text: ev.question.question }).catch(() => {})
        if (navigator.vibrate) navigator.vibrate([150, 90, 150])
        break
      case 'question_closed':
        if (get().question?.id === ev.questionId) set({ question: null })
        CallSession.clearAlert().catch(() => {})
        break
      case 'agent_state':
        set({ agentState: { state: ev.state, detail: ev.detail } })
        break
      case 'summary':
        set({ summary: ev.summary, view: 'summary' })
        get().saveCallLocally(s.id)
        get().refreshHistorySoon()
        break
      case 'notice':
        get().notify(ev.message, ev.level === 'error' ? 'error' : 'info')
        break
      default:
        break
    }
  },

  callTitle() {
    const s = get().session
    if (!s) return 'Call'
    return s.mode === 'agent' && !get().onAudio ? `${assistantName()} is on a call` : 'Call in progress'
  },

  // ---------- Twilio phone line (for "I'll talk" and joining) ----------
  async ensurePhone() {
    if (device) return device
    if (devicePromise) return devicePromise
    set({ phoneState: 'starting', phoneError: '' })
    devicePromise = (async () => {
      const { Device } = await import('@twilio/voice-sdk')
      const { token } = await cp('/api/token')
      const d = new Device(token, { logLevel: 'error', codecPreferences: ['opus', 'pcmu'] })
      d.on('registered', () => set({ phoneState: 'ready', phoneError: '' }))
      d.on('unregistered', () => set({ phoneState: 'off' }))
      d.on('error', (err) => {
        set({ phoneState: 'error', phoneError: err?.message || String(err) })
        get().report(`Phone line error ${err?.code || ''}: ${err?.message || err}${err?.explanation ? ` (${err.explanation})` : ''}`)
      })
      d.on('tokenWillExpire', async () => {
        try { d.updateToken((await cp('/api/token')).token) } catch { /* retry next time */ }
      })
      d.on('incoming', (call) => get().onIncoming(call))
      await d.register()
      device = d
      return d
    })()
    try {
      return await devicePromise
    } catch (err) {
      devicePromise = null
      set({ phoneState: 'error', phoneError: err.message })
      throw err
    }
  },

  bindCall(call) {
    get()._call = call
    call.on('accept', () => { if (!get().startedAt) set({ startedAt: Date.now() }) })
    call.on('disconnect', () => {
      get()._call = null
      set({ onAudio: false })
      if (get().session?.mode === 'copilot' || get().session?.joined) get().endLocal()
    })
    call.on('cancel', () => get().endLocal())
    call.on('reject', () => get().endLocal())
    call.on('error', (err) => {
      get().notify(`Call: ${err.message}`, 'error')
      get().report(`Call error ${err.code || ''}: ${err.message}${err.explanation ? ` (${err.explanation})` : ''}`, true)
    })
  },

  onIncoming(call) {
    // The only incoming call we accept is Pilot handing you a call you asked to join.
    // Ignore (not reject) so a hand-off meant for another of your devices keeps ringing there.
    if (!get().joinPending) return call.ignore()
    set({ joinPending: false, onAudio: true, session: { ...get().session, joined: true } })
    call.accept()
    get().bindCall(call)
    CallSession.start({ mode: 'audio', title: 'You’re on the call', text: 'Tap to open' }).catch(() => {})
    CallSession.setSpeaker({ on: get().speaker }).catch(() => {})
    get().notify('You’re on the call')
  },

  // ---------- starting and controlling calls ----------
  setDraft(draft) {
    set({ draft, view: 'compose', draftVersion: get().draftVersion + 1 })
  },

  async ensureAwake() {
    if (get().serverState === 'up' && get().connected) return
    const up = await get().wake()
    if (!up) throw new Error('The calling server isn’t answering. If it runs on your PC, make sure it’s on and npm run go is running.')
  },

  async makePlan(body) {
    body = withContact(body)
    await get().ensureAwake()
    const { plan } = await cp('/api/plan', { ...callerContext(), ...body }, { timeoutMs: 90000 })
    set({ pending: { ...body, plan }, view: 'plan' })
    return plan
  },

  async startCall(body) {
    const fresh = { lines: [], partials: { you: '', them: '' }, suggestion: null, question: null, agentState: null, summary: null, startedAt: null, muted: false, onAudio: false, detail: null }
    let session
    body = withContact(body)
    await get().ensureAwake()
    if (body.mode === 'copilot') await get().ensurePhone()
    ;({ session } = await cp('/api/sessions', { ...callerContext(), ...body }))
    set({ ...fresh, session, status: session.status, view: 'active', pending: null })
    get().refreshHistorySoon()
    try {
      if (body.mode === 'copilot') {
        const call = await device.connect({ params: { To: session.to, sessionId: session.id } })
        set({ onAudio: true, status: 'ringing' })
        get().bindCall(call)
        await CallSession.start({ mode: 'audio', title: 'Call in progress', text: 'Ringing…' }).catch(() => {})
        await CallSession.setSpeaker({ on: get().speaker }).catch(() => {})
      } else {
        await CallSession.start({ mode: 'monitor', title: `${assistantName()} is calling`, text: 'Tap to follow along' }).catch(() => {})
      }
    } catch (err) {
      get().report(`Could not start the call: ${err.message}`, true)
      throw err
    }
    return session
  },

  async answer(answer) {
    const { session, question } = get()
    if (!session || !question || !String(answer).trim()) return
    set({ question: null })
    CallSession.clearAlert().catch(() => {})
    try {
      await cp(`/api/sessions/${session.id}/answer`, { questionId: question.id, answer })
    } catch (err) {
      get().notify(err.message, 'error')
    }
  },

  async join() {
    const { session } = get()
    if (!session) return
    await get().ensurePhone()
    set({ joinPending: true })
    try {
      await cp(`/api/sessions/${session.id}/join`, {})
    } catch (err) {
      set({ joinPending: false })
      throw err
    }
  },

  async hangup() {
    const { session } = get()
    const call = get()._call
    if (call) call.disconnect()
    if (session) await cp(`/api/sessions/${session.id}/hangup`, {}).catch(() => {})
    get().endLocal()
  },

  toggleMute() {
    const call = get()._call
    if (!call) return
    const muted = !call.isMuted()
    call.mute(muted)
    set({ muted })
  },

  async toggleSpeaker() {
    const on = !get().speaker
    set({ speaker: on })
    await CallSession.setSpeaker({ on }).catch(() => {})
  },

  sendDigits(d) {
    get()._call?.sendDigits(d)
  },

  endLocal(detail) {
    if (detail) get().notify(detail, 'error')
    set({ onAudio: false, joinPending: false, question: null })
    CallSession.stop().catch(() => {})
  },

  report(message, fatal = false) {
    const sid = get().session?.id
    const path = sid ? `/api/sessions/${sid}/client-error` : '/api/client-log'
    cp(path, { level: 'error', message, fatal }).catch(() => {})
  },

  newCall() {
    set({ view: 'compose', session: null, status: null, summary: null, pending: null, detail: null })
  },

  // ---------- history, details, logs ----------
  refreshHistorySoon() {
    clearTimeout(historyTimer)
    historyTimer = setTimeout(() => get().loadHistory(), 600)
  },
  /** Copies a finished call (transcript, summary, plan, redial info) onto the phone. */
  async saveCallLocally(id, tries = 0) {
    try {
      const { call } = await cp(`/api/sessions/${id}`)
      archiveCall(call)
      // The summary arrives a few seconds after hang-up; save again once it's there.
      if (call.status === 'ended' && !call.summary && (call.transcript || []).length && tries < 6) {
        setTimeout(() => get().saveCallLocally(id, tries + 1), 5000)
      }
      set({ history: mergeHistory(get().serverHistory || []) })
    } catch { /* server asleep; we'll catch up on the next history load */ }
  },
  async loadHistory() {
    set({ history: mergeHistory(get().serverHistory || []) })
    if (!isCallPilotReady()) return
    try {
      const { history: serverHistory } = await cp('/api/sessions')
      set({ serverHistory, history: mergeHistory(serverHistory) })
      const live = serverHistory.find((h) => !h.endedAt && ['live', 'dialing', 'ringing', 'initiated', 'queued', 'starting', 'answered'].includes(h.status))
      if (live && !get().session && Date.now() - Date.parse(live.startedAt) < 2 * 60 * 60 * 1000) get().openDetail(live.id).catch(() => {})
      // Back up any finished call the phone doesn't have yet (a few at a time).
      const missing = serverHistory.filter((h) => (h.endedAt || BAD.has(h.status)) && !hasFinal(h)).slice(0, 8)
      for (const h of missing) await get().saveCallLocally(h.id)
    } catch { /* offline; keep the old list */ }
  },
  async openDetail(id) {
    let call
    try {
      ;({ call } = await cp(`/api/sessions/${id}`))
    } catch (err) {
      // Server asleep, offline, or it forgot this call: use the phone's copy.
      call = archivedCall(id)
      if (!call) throw err
    }
    if (!call) call = archivedCall(id)
    if (!call) throw new Error('That call is no longer available.')
    archiveCall(call)
    const stillGoing = !call.endedAt && call.status && call.status !== 'ended' && !BAD.has(call.status)
    if (stillGoing && get().session?.id !== call.id) {
      // App was closed mid-call: pick the live call back up.
      set({
        session: call, status: call.status, view: 'active', lines: call.transcript || [], partials: { you: '', them: '' },
        suggestion: call.suggestions?.at(-1) || null, question: (call.questions || []).find((q) => q.answer == null) || null,
        summary: null, startedAt: Date.parse(call.startedAt) || Date.now(), onAudio: false, detail: null,
      })
      if (call.mode === 'agent') CallSession.start({ mode: 'monitor', title: `${assistantName()} is on a call`, text: 'Tap to follow along' }).catch(() => {})
      return
    }
    if (stillGoing) return set({ view: 'active' })
    set({ detail: call, view: 'detail' })
  },
  async openLogs() {
    set({ logsOpen: true, unseenProblems: 0 })
    try {
      const { logs } = await cp('/api/logs')
      set({ logs })
    } catch (err) {
      get().notify(err.message, 'error')
    }
  },
  closeLogs() {
    set({ logsOpen: false })
  },
}))

// Tapping "Hang up" on the call notification.
CallSession.addListener?.('hangup', () => useCallStore.getState().hangup())
