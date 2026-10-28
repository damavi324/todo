import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, Grid3x3, ScrollText, ChevronLeft, Sparkles, X,
  RotateCcw, Pencil, ListPlus, Copy, AlertTriangle, Bot, UserRound, Loader2,
} from 'lucide-react'
import { useCallStore, statusText, isBadStatus } from '../store/useCallStore'
import { useTaskStore } from '../store/useTaskStore'
import { formatNumber, assistantName, ownerName, isCallPilotReady } from '../lib/callpilot'
import { startDictation } from '../lib/dictation'
import { syncReminders } from '../lib/notifications'

// ---------- small building blocks ----------
function Section({ title, children }) {
  return (
    <section className="mt-3">
      <h4 className="text-xs font-semibold text-gray-500 mb-1">{title}</h4>
      {children}
    </section>
  )
}

function Bullets({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5 text-sm text-gray-700`}>
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </Tag>
  )
}

function useTimer(startedAt, running) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!startedAt || !running) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [startedAt, running])
  if (!startedAt) return '0:00'
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Text field with a mic button that streams speech into it. */
function DictationField({ label, value, onChange, placeholder, rows = 2, optional, maxLength = 40000, inputMode }) {
  const [rec, setRec] = useState(null)
  const [error, setError] = useState('')
  const base = useRef('')
  const toggle = async () => {
    setError('')
    if (rec) {
      const text = await rec.stop()
      setRec(null)
      onChange(join(base.current, text))
      return
    }
    base.current = value.replace(/\s+$/, '')
    try {
      const r = await startDictation({
        onText: (t) => onChange(join(base.current, t)),
        onError: (e) => { setError(e.message); setRec(null) },
      })
      setRec(r)
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => () => rec?.cancel(), [rec])
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}{optional && <span className="text-gray-400 font-normal"> optional</span>}</span>
        {isCallPilotReady() && (
          <button type="button" onClick={toggle} aria-pressed={!!rec}
            className={`flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors ${rec ? 'bg-red-500 border-red-500 text-white animate-pulse' : 'border-gray-200 text-gray-600 bg-white'}`}>
            {rec ? <MicOff size={14} /> : <Mic size={14} />}{rec ? 'Stop' : 'Speak'}
          </button>
        )}
      </span>
      <textarea rows={rows} value={value} maxLength={maxLength} inputMode={inputMode}
        onChange={(e) => { if (rec) { rec.cancel(); setRec(null) } onChange(e.target.value) }}
        placeholder={placeholder}
        className={`w-full rounded-2xl border bg-gray-50 px-3.5 py-3 text-[15px] outline-none focus:border-primary resize-y ${rec ? 'border-red-400' : 'border-gray-200'}`} />
      {value.length > 300 && <span className="block text-right text-xs text-gray-400 mt-0.5">{value.length.toLocaleString()} characters</span>}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  )
}
const join = (a, b) => [a, b].filter(Boolean).join(a && b ? ' ' : '')

// ---------- compose ----------
function Compose() {
  const { draft, setDraft, makePlan, startCall, notify, phoneState } = useCallStore()
  const [mode, setMode] = useState('agent')
  const [to, setTo] = useState('')
  const [goal, setGoal] = useState('')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!draft) return
    setMode(draft.mode || 'agent')
    setTo(draft.to ? formatNumber(draft.to) : '')
    setGoal(draft.goal || '')
    setBrief(draft.brief || '')
    setDraft(null)
  }, [draft, setDraft])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const body = { mode, to, goal, brief }
    try {
      if (mode === 'agent') {
        if (!goal.trim()) throw new Error(`Tell ${assistantName()} what the call is for`)
        setBusy('plan')
        await makePlan(body)
      } else {
        setBusy('call')
        await startCall(body)
      }
    } catch (err) {
      setError(err.message)
      notify(err.message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-3xl p-4 shadow-sm space-y-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {[
          ['agent', Bot, `${assistantName()} calls`, 'I can jump in anytime'],
          ['copilot', UserRound, 'I’ll talk', 'AI listens and coaches'],
        ].map(([value, Icon, title, sub]) => (
          <button type="button" key={value} role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
            className={`text-left rounded-2xl border-2 p-3 transition-colors ${mode === value ? 'border-primary bg-primary/5' : 'border-gray-100'}`}>
            <Icon size={18} className={mode === value ? 'text-primary' : 'text-gray-400'} />
            <span className="block font-semibold text-sm mt-1 text-gray-800">{title}</span>
            <span className="block text-xs text-gray-500">{sub}</span>
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Phone number</span>
        <input type="tel" inputMode="tel" autoComplete="tel" value={to} onChange={(e) => setTo(e.target.value)} required
          placeholder="(214) 555-0123"
          className="mt-1 w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-xl tracking-wide outline-none focus:border-primary tabular-nums" />
      </label>

      <DictationField label="What’s the call for?" optional={mode === 'copilot'} value={goal} onChange={setGoal}
        placeholder="Move my cleaning to a weekday morning next week" maxLength={2000} />
      <DictationField label="Details the AI can use" value={brief} onChange={setBrief} rows={4}
        placeholder="Talk or type as much as you like: who you are, account info, times that work, what's OK to agree to, what to avoid." />

      <button type="submit" disabled={!!busy || (mode === 'copilot' && phoneState === 'starting')}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-white font-semibold py-4 text-base disabled:opacity-60 active:scale-[0.99] transition-transform">
        {busy ? <Loader2 size={18} className="animate-spin" /> : mode === 'agent' ? <Sparkles size={18} /> : <Phone size={18} />}
        {busy === 'plan' ? 'Writing the call plan…' : busy === 'call' ? 'Calling…' : mode === 'agent' ? `Have ${assistantName()} call` : 'Call'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}

// ---------- plan review ----------
function PlanView() {
  const { pending, startCall, setDraft, notify } = useCallStore()
  const [busy, setBusy] = useState(false)
  if (!pending) return null
  const p = pending.plan
  const extras = [
    p.if_phone_menu && `Phone menu: ${p.if_phone_menu}`,
    p.if_voicemail && `Voicemail: “${p.if_voicemail}”`,
    p.confirm_before_hanging_up?.length && `Confirms before hanging up: ${p.confirm_before_hanging_up.join(', ')}`,
  ].filter(Boolean)
  const call = async () => {
    setBusy(true)
    try { await startCall(pending) } catch (err) { notify(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="bg-white rounded-3xl p-4 shadow-sm">
      <p className="text-xs text-gray-500">Call plan for {formatNumber(pending.to) || pending.to}</p>
      <h2 className="text-lg font-semibold text-gray-900 mt-1 leading-snug">{p.objective || 'Call plan'}</h2>
      <div className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-3">
        <p className="text-xs font-semibold text-amber-800">{assistantName()} opens with</p>
        <p className="text-sm text-gray-800 mt-0.5">&ldquo;Hi, this is {assistantName()}, an AI assistant calling on behalf of {ownerName()}. {p.opening}&rdquo;</p>
      </div>
      {p.steps?.length > 0 && <Section title="How the call should go"><Bullets items={p.steps} ordered /></Section>}
      {p.facts_to_share?.length > 0 && (
        <Section title="Can share">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-sm">
            {p.facts_to_share.map((f, i) => [<dt key={`t${i}`} className="text-gray-500">{f.label}</dt>, <dd key={`d${i}`} className="text-gray-800">{f.value}</dd>])}
          </dl>
        </Section>
      )}
      {p.can_agree_to?.length > 0 && <Section title="Can agree to on its own"><Bullets items={p.can_agree_to} /></Section>}
      {p.ask_owner_before?.length > 0 && <Section title="Will ask you first"><Bullets items={p.ask_owner_before} /></Section>}
      {p.never_share?.length > 0 && <Section title="Will never share"><Bullets items={p.never_share} /></Section>}
      {p.likely_questions?.length > 0 && <Section title="If they ask"><Bullets items={p.likely_questions.map((x) => `${x.q} → ${x.a || 'Will ask you'}`)} /></Section>}
      {extras.length > 0 && <Section title="Also"><Bullets items={extras} /></Section>}
      {p.missing_info?.length > 0 && (
        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm">
          <p className="font-semibold text-amber-900">Not covered by your details. {assistantName()} will ask you if these come up:</p>
          <Bullets items={p.missing_info} />
        </div>
      )}
      <p className="text-xs text-gray-500 mt-3">A guide, not a script: {assistantName()} adapts to what they say and asks you before anything outside it.</p>
      <div className="flex gap-2 mt-4">
        <button onClick={call} disabled={busy} className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-white font-semibold py-3.5 disabled:opacity-60">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Phone size={18} />}Call now
        </button>
        <button onClick={() => setDraft({ mode: pending.mode, to: pending.to, goal: pending.goal, brief: pending.brief })}
          className="flex-1 rounded-2xl border border-gray-200 font-semibold text-gray-700 py-3.5">Edit</button>
      </div>
    </div>
  )
}

// ---------- live call ----------
const AGENT_TEXT = {
  talking: (a) => `${a} is talking`,
  thinking: (a) => `${a} is thinking`,
  waiting_for_you: (a) => `${a} asked them to hold and needs your answer`,
  pressing_keys: (a, d) => `${a} pressed ${d}`,
  handing_off: () => 'Connecting you now…',
  you_are_on: (a) => `You’re on the call. ${a} is listening and suggesting.`,
}

function Transcript() {
  const { lines, partials } = useCallStore()
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [lines.length, partials.them, partials.you])
  const who = (s) => (s === 'you' ? 'You' : s === 'agent' ? assistantName() : 'Them')
  if (!lines.length && !partials.them && !partials.you) {
    return <p className="text-center text-sm text-gray-400 py-8">The conversation shows up here as it happens.</p>
  }
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] ${l.speaker === 'them' ? 'bg-teal-50 mr-auto rounded-bl-md' : l.speaker === 'agent' ? 'bg-amber-50 ml-auto rounded-br-md' : 'bg-indigo-50 ml-auto rounded-br-md'}`}>
          <span className={`block text-[11px] font-semibold ${l.speaker === 'them' ? 'text-teal-700' : l.speaker === 'agent' ? 'text-amber-800' : 'text-indigo-700'}`}>{who(l.speaker)}</span>
          {l.text}
        </div>
      ))}
      {partials.them && <p className="text-sm italic text-gray-500"><b className="not-italic text-teal-700">Them:</b> {partials.them}</p>}
      {partials.you && <p className="text-sm italic text-gray-500 text-right"><b className="not-italic text-indigo-700">You:</b> {partials.you}</p>}
      <div ref={end} />
    </div>
  )
}

function QuestionCard() {
  const { question, answer } = useCallStore()
  const [text, setText] = useState('')
  useEffect(() => setText(''), [question?.id])
  if (!question) return null
  const send = (v) => { answer(v); setText('') }
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3.5 space-y-2">
      <p className="text-xs font-semibold text-amber-800">{assistantName()} is asking you</p>
      <p className="font-semibold text-gray-900">{question.question}</p>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer"
        className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 outline-none focus:border-amber-500" />
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-xl bg-gray-900 text-white font-semibold py-2.5">Send</button>
        <button type="button" onClick={() => send('Yes, that works.')} className="px-4 rounded-xl border border-amber-300 font-semibold">Yes</button>
        <button type="button" onClick={() => send('No. Say I’ll follow up.')} className="px-4 rounded-xl border border-amber-300 font-semibold">No</button>
      </div>
    </form>
  )
}

function ActiveCall() {
  const s = useCallStore()
  const [keypad, setKeypad] = useState(false)
  const [busy, setBusy] = useState(false)
  const session = s.session
  const live = s.status === 'live'
  const ended = s.status === 'ended' || isBadStatus(s.status)
  const time = useTimer(s.startedAt, !ended)
  if (!session) return null
  const agentMode = session.mode === 'agent' && !s.onAudio
  const join = async () => {
    setBusy(true)
    try { await s.join() } catch (err) { s.notify(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 font-semibold ${live ? 'bg-amber-400 text-amber-950' : ended ? 'bg-gray-200 text-gray-700' : 'bg-[#1a1d2e] text-white'}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${live ? 'bg-red-600 animate-pulse' : 'bg-gray-400'}`} />
        {statusText(s.status || 'starting')}
        <span className="ml-auto tabular-nums">{time}</span>
      </div>
      <div className="bg-white rounded-3xl p-4 shadow-sm">
        <p className="text-2xl font-bold tabular-nums text-gray-900">{formatNumber(session.to)}</p>
        {session.goal && <p className="text-sm text-gray-500 mt-0.5">{session.goal}</p>}
        {s.agentState && !ended && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            {(AGENT_TEXT[s.agentState.state] || ((a) => s.agentState.state))(assistantName(), s.agentState.detail)}
          </p>
        )}
        {!ended && (
          agentMode ? (
            <div className="flex gap-2 mt-4">
              <button onClick={join} disabled={busy || s.joinPending} className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-[#1a1d2e] text-white font-semibold py-3.5 disabled:opacity-60">
                {busy || s.joinPending ? <Loader2 size={18} className="animate-spin" /> : <Phone size={18} />}Join the call
              </button>
              <button onClick={s.hangup} className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-red-600 text-white font-semibold py-3.5"><PhoneOff size={18} />End</button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 mt-4">
              <button onClick={s.toggleMute} aria-pressed={s.muted} className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-semibold border ${s.muted ? 'bg-indigo-50 border-indigo-300' : 'border-gray-200'}`}>{s.muted ? <MicOff size={18} /> : <Mic size={18} />}{s.muted ? 'Unmute' : 'Mute'}</button>
              <button onClick={s.toggleSpeaker} aria-pressed={s.speaker} className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-semibold border ${s.speaker ? 'bg-indigo-50 border-indigo-300' : 'border-gray-200'}`}><Volume2 size={18} />Speaker</button>
              <button onClick={() => setKeypad(!keypad)} aria-expanded={keypad} className="flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-semibold border border-gray-200"><Grid3x3 size={18} />Keypad</button>
              <button onClick={s.hangup} className="flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-semibold bg-red-600 text-white"><PhoneOff size={18} />End</button>
            </div>
          )
        )}
        {keypad && !agentMode && !ended && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
              <button key={d} onClick={() => s.sendDigits(d)} className="rounded-xl border border-gray-200 bg-gray-50 py-3 text-xl">{d}</button>
            ))}
          </div>
        )}
      </div>
      <QuestionCard />
      {s.suggestion && !ended && (
        <div className="rounded-2xl bg-indigo-50 border-l-4 border-indigo-500 px-4 py-3">
          <p className="text-xs font-semibold text-gray-500">Say next</p>
          {s.suggestion.say?.map((t, i) => <p key={i} className={i ? 'text-sm text-gray-600 mt-1' : 'text-lg font-semibold text-gray-900 leading-snug'}>{t}</p>)}
          {s.suggestion.note && <p className="text-sm text-amber-800 mt-1.5">{s.suggestion.note}</p>}
        </div>
      )}
      <div className="bg-white rounded-3xl p-4 shadow-sm"><Transcript /></div>
    </div>
  )
}

// ---------- after the call ----------
function Summary() {
  const { summary, session, newCall, notify } = useCallStore()
  const addTask = useTaskStore((st) => st.addTask)
  const [added, setAdded] = useState(false)
  if (!summary) return null
  const label = { done: 'Done', needs_you: 'Needs you', failed: 'Not completed', no_answer: 'No answer', voicemail: 'Left voicemail', no_conversation: 'No conversation' }[summary.outcome] || 'Call notes'
  const bad = ['needs_you', 'failed', 'no_answer'].includes(summary.outcome)
  const addFollowUps = () => {
    const facts = summary.key_facts?.length ? `\n\nFrom the call: ${summary.key_facts.join('; ')}` : ''
    for (const item of summary.action_items || []) {
      addTask({ title: item, notes: `${summary.headline || ''}${facts}`.trim(), dueDate: '', dueTime: '', priority: 'none', listId: 'inbox', googleEventId: null })
    }
    syncReminders().catch(() => {})
    setAdded(true)
    notify(`Added ${summary.action_items.length} task${summary.action_items.length === 1 ? '' : 's'}`)
  }
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-3xl p-4 shadow-sm">
        <p className={`text-xs font-semibold ${bad ? 'text-red-600' : 'text-emerald-700'}`}>{label}</p>
        <h2 className="text-lg font-semibold text-gray-900 mt-0.5 leading-snug">{summary.headline || 'Call notes'}</h2>
        {summary.summary && <p className="text-sm text-gray-700 mt-1.5">{summary.summary}</p>}
        {summary.key_facts?.length > 0 && <Section title="Key details"><Bullets items={summary.key_facts} /></Section>}
        {summary.action_items?.length > 0 && <Section title="Follow-ups"><Bullets items={summary.action_items} /></Section>}
        <div className="flex gap-2 mt-4">
          {summary.action_items?.length > 0 && (
            <button onClick={addFollowUps} disabled={added} className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-gray-200 font-semibold py-3 disabled:opacity-50">
              <ListPlus size={18} />{added ? 'Added to tasks' : 'Add as tasks'}
            </button>
          )}
          <button onClick={newCall} className="flex-1 rounded-2xl bg-primary text-white font-semibold py-3">New call</button>
        </div>
      </div>
      {session && <div className="bg-white rounded-3xl p-4 shadow-sm"><Transcript /></div>}
    </div>
  )
}

// ---------- history + one call ----------
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

function History() {
  const { history, openDetail, notify } = useCallStore()
  if (!history.length) return <p className="text-sm text-gray-400 px-1">No calls yet.</p>
  return (
    <ul className="space-y-1.5">
      {history.slice(0, 25).map((h) => {
        const failed = isBadStatus(h.status) || h.error || ['failed', 'no_answer'].includes(h.outcome)
        return (
          <li key={h.id}>
            <button onClick={() => openDetail(h.id).catch((e) => notify(e.message, 'error'))} className="w-full text-left bg-white rounded-2xl px-4 py-3 shadow-sm active:bg-gray-50">
              <span className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-800 truncate flex-1">{h.headline || h.goal || (h.mode === 'agent' ? 'AI call' : 'Call')}</span>
                {failed ? <span className="text-xs font-semibold text-red-600">Failed</span> : h.status === 'live' ? <span className="text-xs font-semibold text-amber-600">Live</span> : null}
              </span>
              <span className="block text-xs text-gray-400 mt-0.5">
                {formatNumber(h.to)} · {new Date(h.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.mode === 'agent' ? ` · by ${assistantName()}` : ''}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Detail() {
  const { detail: c, newCall, setDraft, notify } = useCallStore()
  const set = useCallStore.setState
  if (!c) return null
  const err = c.error || (isBadStatus(c.status) ? `Call ${c.status}` : '')
  const redial = () => {
    const body = { mode: c.mode, to: c.to, goal: c.goal, brief: c.brief }
    if (c.mode === 'agent' && c.plan) set({ pending: { ...body, plan: c.plan }, view: 'plan', detail: null })
    else setDraft(body)
  }
  return (
    <div className="space-y-3">
      <button onClick={newCall} className="flex items-center gap-1 text-sm font-semibold text-primary"><ChevronLeft size={16} />All calls</button>
      <div className="bg-white rounded-3xl p-4 shadow-sm">
        <p className="text-xs text-gray-500">{formatNumber(c.to)} · {c.mode === 'agent' ? `${assistantName()} made the call` : 'You talked'} · {new Date(c.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        <h2 className="text-lg font-semibold text-gray-900 mt-0.5 leading-snug">{c.summary?.headline || c.goal || 'Call'}</h2>
        {err && <p className="mt-2 flex gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />{err}</p>}
        {c.goal && <Section title="Goal"><p className="text-sm text-gray-700">{c.goal}</p></Section>}
        {c.brief && <Section title={`Details the AI used (${c.brief.length.toLocaleString()} characters)`}><p className="text-sm text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto rounded-xl bg-gray-50 px-3 py-2">{c.brief}</p></Section>}
        {c.summary?.summary && <Section title="Summary"><p className="text-sm text-gray-700">{c.summary.summary}</p></Section>}
        <div className="flex gap-2 mt-4">
          <button onClick={redial} className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-white font-semibold py-3.5"><RotateCcw size={18} />{c.mode === 'agent' && c.plan ? 'Redial, same plan' : 'Redial, same info'}</button>
          <button onClick={() => setDraft({ mode: c.mode, to: c.to, goal: c.goal, brief: c.brief })} className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-gray-200 font-semibold py-3.5"><Pencil size={16} />Edit</button>
        </div>
        <Section title="What happened">
          <ol className="space-y-1 text-[13px] max-h-64 overflow-y-auto">
            {(c.log || []).map((l, i) => (
              <li key={i} className="grid grid-cols-[72px_1fr] gap-2">
                <time className="text-gray-400 tabular-nums">{fmtTime(l.at)}</time>
                <span className={l.level === 'error' ? 'text-red-600 font-medium' : l.level === 'warn' ? 'text-amber-700' : 'text-gray-700'}>{l.text}</span>
              </li>
            ))}
            {!c.log?.length && <li className="text-gray-400">No log lines were recorded.</li>}
          </ol>
        </Section>
        {c.transcript?.length > 0 && (
          <Section title="Transcript">
            <ol className="space-y-1 text-[13px]">
              {c.transcript.slice(-50).map((l, i) => (
                <li key={i} className="grid grid-cols-[52px_1fr] gap-2"><b className="text-gray-500 font-medium">{l.speaker === 'you' ? 'You' : l.speaker === 'agent' ? assistantName() : 'Them'}</b><span className="text-gray-700">{l.text}</span></li>
              ))}
            </ol>
          </Section>
        )}
      </div>
      <button onClick={() => notify('Copied') || navigator.clipboard?.writeText((c.log || []).map((l) => `${l.at} ${l.level} ${l.text}`).join('\n'))}
        className="text-xs text-gray-400 flex items-center gap-1"><Copy size={12} />Copy this call's log</button>
    </div>
  )
}

// ---------- logs ----------
export function LogsSheet() {
  const { logs, logsOpen, closeLogs, notify } = useCallStore()
  const [problems, setProblems] = useState(false)
  const end = useRef(null)
  useEffect(() => { if (logsOpen) end.current?.scrollIntoView({ block: 'end' }) }, [logsOpen, logs.length])
  if (!logsOpen) return null
  const shown = problems ? logs.filter((l) => l.level !== 'info') : logs
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.map((l) => `${l.at} ${l.level.toUpperCase()} ${l.text}`).join('\n'))
      notify('Logs copied')
    } catch { notify('Could not copy', 'error') }
  }
  return (
    <div className="fixed inset-0 z-[60] bg-[#0f1522] text-[#dbe2ee] flex flex-col" role="dialog" aria-label="Server logs">
      <div className="flex items-center gap-2 px-4 pt-12 pb-3 border-b border-white/10">
        <strong className="mr-auto">Logs</strong>
        <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} />Problems only</label>
        <button onClick={copy} className="text-xs border border-white/20 rounded-full px-3 py-1.5">Copy</button>
        <button onClick={closeLogs} aria-label="Close logs" className="p-1.5 rounded-full bg-white/10"><X size={16} /></button>
      </div>
      <ol className="flex-1 overflow-y-auto px-4 py-2 text-[12.5px] leading-snug">
        {shown.map((l, i) => (
          <li key={i} className="grid grid-cols-[64px_1fr] gap-2 py-1 border-b border-white/5 break-words">
            <time className="text-[#7d8aa3] tabular-nums">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/\s?[AP]M$/i, '')}</time>
            <span className={l.level === 'error' ? 'text-[#ff8f7d]' : l.level === 'warn' ? 'text-[#f4c177]' : ''}>{l.text}</span>
          </li>
        ))}
        {!shown.length && <li className="text-[#7d8aa3] py-6 text-center">Nothing logged yet.</li>}
        <li ref={end} />
      </ol>
    </div>
  )
}

// ---------- screen ----------
export default function Calls({ onOpenSettings }) {
  const { view, connected, loadHistory, openLogs, unseenProblems, phoneState, phoneError, session, status, serverState, wake } = useCallStore()
  const ready = isCallPilotReady()
  const problems = useTaskStore((st) => st.settings.callpilotProblems) || []
  useEffect(() => { if (ready) loadHistory() }, [ready, loadHistory])
  const onCall = session && status && status !== 'ended' && !isBadStatus(status)

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-32">
      <div className="pt-12 pb-3 flex items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900 mr-auto">Calls</h1>
        {ready && (
          serverState === 'down' && !connected ? (
            <button onClick={() => wake()} className="flex items-center gap-1.5 text-xs text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-500" />Server offline · Retry
            </button>
          ) : (
            <span className={`flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-700' : serverState === 'waking' ? 'text-amber-600' : 'text-gray-400'}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : serverState === 'waking' ? 'bg-amber-400 animate-pulse' : 'bg-gray-300'}`} />
              {connected ? 'Connected' : serverState === 'waking' ? 'Waking up server…' : 'Connecting…'}
            </span>
          )
        )}
        {ready && (
          <button onClick={openLogs} className="relative flex items-center gap-1 text-xs font-semibold rounded-full bg-white border border-gray-200 px-3 py-1.5">
            <ScrollText size={14} />Logs
            {unseenProblems > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5">{unseenProblems}</span>}
          </button>
        )}
      </div>

      {!ready ? (
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <Phone size={22} className="text-primary" />
          <h2 className="font-semibold text-gray-900 mt-2">Connect your calling server</h2>
          <p className="text-sm text-gray-500 mt-1">Calls run through your CallPilot server. Add its address and passcode once, in Settings.</p>
          <button onClick={onOpenSettings} className="mt-4 w-full rounded-2xl bg-primary text-white font-semibold py-3">Open Settings</button>
        </div>
      ) : (
        <>
          {problems.length > 0 && (
            <div className="mb-3 rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-3 text-xs text-amber-900">
              <p className="font-semibold">Your server reports setup items:</p>
              <ul className="list-disc pl-4 mt-1">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {phoneState === 'error' && <p className="mb-3 rounded-2xl bg-red-50 px-3.5 py-2.5 text-xs text-red-700">Phone line: {phoneError}</p>}
          {onCall && view !== 'active' && (
            <button onClick={() => useCallStore.setState({ view: 'active' })} className="mb-3 w-full flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 font-semibold text-amber-950">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />Back to the call
            </button>
          )}
          {view === 'compose' && <Compose />}
          {view === 'plan' && <PlanView />}
          {view === 'active' && <ActiveCall />}
          {view === 'summary' && <Summary />}
          {view === 'detail' && <Detail />}
          {(view === 'compose' || view === 'summary') && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 px-1">Recent calls</h3>
              <History />
            </div>
          )}
        </>
      )}
    </div>
  )
}
