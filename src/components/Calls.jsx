import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, Grid3x3, ScrollText, ChevronLeft, Sparkles, RotateCcw, Pencil,
  ListPlus, Copy, AlertTriangle, Bot, UserRound, Loader2, CalendarPlus, Clock, Check, UserPlus, Plus, Trash2,
  BookUser, MessageCircleQuestion, Settings, Gauge,
} from 'lucide-react'
import UsagePanel from './UsagePanel'
import { useCallStore, statusText, isBadStatus, withoutContact } from '../store/useCallStore'
import { callResult } from '../lib/callArchive'
import { useTaskStore } from '../store/useTaskStore'
import { formatNumber, assistantName, ownerName, isCallPilotReady } from '../lib/callpilot'
import { startDictation, listenUntilPause } from '../lib/dictation'
import { parseSpokenCall } from '../lib/spokenCall'
import { say } from '../lib/notifications'
import { loadPhoneContacts, phoneContacts, mergeContacts, pickByName } from '../lib/phoneContacts'
import { formatDue } from '../lib/dates'
import { addAppointment, addFollowUp, callWith, contactFor, scheduleCallback, callbackTime } from '../lib/callFollowUps'
import { Button, IconButton, Note, Segmented, Sheet, fieldClass } from './ui'

const touchScreen = () => window.matchMedia('(pointer: coarse)').matches

// ---------- small building blocks ----------
function Card({ className = '', children }) {
  return <div className={`bg-surface rounded-xl shadow-card ${className}`}>{children}</div>
}

function Block({ title, children }) {
  return (
    <section className="mt-5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-2">{title}</h4>
      {children}
    </section>
  )
}

function Bullets({ items, ordered }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 text-sm text-ink-2 marker:text-ink-3`}>
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </Tag>
  )
}

function useTimer(startedAt, running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt || !running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt, running])
  if (!startedAt) return '0:00'
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Text field with a mic button that streams speech into it. */
function DictationField({ label, value, onChange, placeholder, rows = 2, hint, maxLength = 40000 }) {
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
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-ink">{label}</span>
        <button type="button" onClick={toggle} aria-pressed={!!rec}
          className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${rec ? 'bg-danger text-white animate-pulse' : 'text-ink-2 hover:bg-surface-2'}`}>
          {rec ? <MicOff size={13} /> : <Mic size={13} />}{rec ? 'Stop' : 'Dictate'}
        </button>
      </span>
      <textarea rows={rows} value={value} maxLength={maxLength}
        onChange={(e) => { if (rec) { rec.cancel(); setRec(null) } onChange(e.target.value) }}
        placeholder={placeholder}
        className={`w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink leading-relaxed outline-none border resize-y focus:bg-surface ${rec ? 'border-danger/60' : 'border-transparent focus:border-accent/50'}`} />
      {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
      {error && <span className="block text-xs text-danger mt-1">{error}</span>}
    </label>
  )
}
const join = (a, b) => [a, b].filter(Boolean).join(a && b ? ' ' : '')

// How long a hands-free call waits before dialing, so there's time to cancel.
const HANDS_FREE_SECONDS = 8

/** Counts down, then runs onDone. Cancel stops it. */
function Countdown({ label, seconds = HANDS_FREE_SECONDS, onDone, onCancel }) {
  const [left, setLeft] = useState(seconds)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  useEffect(() => {
    if (left <= 0) {
      done.current()
      return
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return (
    <div className="flex items-center gap-3 rounded-xl bg-accent/10 px-4 py-3" role="status">
      <Loader2 size={16} className="animate-spin text-accent flex-shrink-0" />
      <span className="flex-1 text-sm font-medium text-accent">{label} in {Math.max(0, left)}s</span>
      <Button size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  )
}
function callText(draft) {
  const goal = (draft?.goal || '').trim()
  // A saved contact's details were added for the assistant; they're added again on the next call.
  const brief = withoutContact(draft?.brief, draft?.to).trim()
  if (!goal) return brief
  if (!brief || brief === goal) return goal
  if (brief.startsWith(goal)) return brief
  return `${goal}\n\n${brief}`
}

// ---------- compose ----------
const MODES = [
  { value: 'agent', label: 'Assistant calls', icon: <Bot size={14} /> },
  { value: 'copilot', label: 'I’ll talk', icon: <UserRound size={14} /> },
]
// The language the assistant speaks on the call (Nepali needs ElevenLabs set up on the calling server).
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ne', label: 'नेपाली' },
]

/** The form starts from the draft it was opened with (a redial, a task's call); the screen remounts it per draft. */
function Compose() {
  const { makePlan, startCall, notify, phoneState } = useCallStore()
  const contacts = useTaskStore((s) => s.contacts)
  const [draft] = useState(() => useCallStore.getState().draft)
  const [mode, setMode] = useState(draft?.mode || 'agent')
  const [language, setLanguage] = useState(() => draft?.language || useTaskStore.getState().settings.callLanguage || 'en')
  const [to, setTo] = useState(draft?.to ? formatNumber(draft.to) || draft.to : '')
  const [text, setText] = useState(callText(draft))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)

  // Used up: the next time the form opens without a new draft, it starts empty.
  useEffect(() => { if (draft) useCallStore.setState({ draft: null }) }, [draft])

  // Hands-free: the listener while it runs, what it has heard so far, and an "I'll talk" call about to dial.
  const [listening, setListening] = useState(null)
  const [heard, setHeard] = useState('')
  const [autoCall, setAutoCall] = useState(null)
  useEffect(() => () => listening?.cancel(), [listening])

  // The phone's own contacts (Android, once allowed) join the ones saved here.
  const [phoneList, setPhoneList] = useState(phoneContacts)
  useEffect(() => { loadPhoneContacts().then(setPhoneList) }, [])
  const everyone = mergeContacts(contacts, phoneList)

  const contact = contactFor(to)
  const query = to.trim().toLowerCase()
  const typedDigits = query.replace(/\D/g, '')
  // Search by name, or by part of the number; with an empty field, show your saved contacts first.
  // Only while the field is in use: leaving it closes the list, so it can't cover the fields below.
  const matches = !picking ? []
    : /[a-z]/i.test(query)
      ? everyone.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 8)
      : typedDigits.length >= 3 && !contact
        ? everyone.filter((c) => c.phone.replace(/\D/g, '').includes(typedDigits)).slice(0, 5)
        : !query ? everyone.slice(0, 8) : []

  // A contact's name typed in full (without tapping the suggestion) still means their number.
  const resolveTo = (value) => {
    if (!/[a-z]/i.test(value)) return value
    return pickByName(everyone, value)?.phone || value
  }

  const go = async (fields, { handsFree = false } = {}) => {
    setError('')
    const note = fields.text.trim()
    const body = { mode: fields.mode, to: resolveTo(fields.to), goal: note, brief: note, language: fields.mode === 'agent' ? fields.language || language : 'en' }
    useCallStore.setState({ handsFree })
    try {
      if (fields.mode === 'agent') {
        if (!note) throw new Error(`Tell ${assistantName()} what this call is for`)
        setBusy('plan')
        const plan = await makePlan(body)
        if (handsFree) say(`${plan.objective || 'The plan is ready'}. Calling in ${HANDS_FREE_SECONDS} seconds. Tap cancel to stop.`)
      } else {
        setBusy('call')
        await startCall(body)
      }
    } catch (err) {
      setError(err.message)
      notify(err.message, 'error')
      if (handsFree) say(`That didn't work. ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  const submit = (e) => {
    e.preventDefault()
    go({ mode, to, text })
  }

  /** One tap, then speak: "Call the dentist at 214 555 0100 and move my cleaning to next week." */
  const speakCall = async () => {
    if (listening) return listening.stop()
    setError('')
    setHeard('')
    setAutoCall(null)
    let listener
    try {
      listener = await listenUntilPause({ onText: setHeard })
    } catch (e) {
      setError(e.message)
      return
    }
    setListening(listener)
    let said = ''
    try {
      said = await listener.done
    } catch (e) {
      setError(e.message)
    }
    setListening(null)
    if (!said.trim()) return

    const parsed = parseSpokenCall(said, everyone)
    const next = {
      mode: parsed.mode || mode,
      to: parsed.to ? formatNumber(parsed.to) || parsed.to : to,
      text: parsed.note || text,
    }
    setMode(next.mode)
    setTo(next.to)
    setText(next.text)
    if (!next.to.trim()) return say('I didn’t catch who to call. Say their full name or the number.')
    if (next.mode === 'agent' && !next.text.trim()) return say('What should the call be about?')
    const who = parsed.contact || callWith({ to: resolveTo(next.to) })
    if (next.mode === 'agent') {
      say(`Got it. Getting the call to ${who} ready.`)
      go(next, { handsFree: true })
    } else {
      say(`Calling ${who} in ${HANDS_FREE_SECONDS} seconds.`)
      setAutoCall(next)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="p-5 space-y-5">
        <button type="button" onClick={speakCall} disabled={!!busy}
          className={`w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-colors disabled:opacity-50 ${listening ? 'bg-danger/10' : 'bg-accent/10 hover:bg-accent/15'}`}>
          <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${listening ? 'bg-danger text-white animate-pulse' : 'bg-accent text-accent-ink'}`}>
            {listening ? <MicOff size={20} /> : <Mic size={20} />}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-medium text-ink">{listening ? 'Listening… pause when you’re done' : 'Speak the call'}</span>
            <span className="block text-xs text-ink-3 mt-0.5 line-clamp-3">
              {listening
                ? heard || 'Who to call, and what it’s about'
                : 'Hands-free: say who to call (a number or a contact) and what it’s about. It fills this in and dials.'}
            </span>
          </span>
        </button>
        {autoCall && (
          <Countdown label={`Calling ${callWith({ to: resolveTo(autoCall.to) })}`}
            onDone={() => { const fields = autoCall; setAutoCall(null); go(fields, { handsFree: true }) }}
            onCancel={() => setAutoCall(null)} />
        )}

        <div className="space-y-1.5">
          <Segmented value={mode} onChange={setMode} options={MODES} />
          <p className="text-xs text-ink-3 px-1">
            {mode === 'agent'
              ? `${assistantName()} makes the call for you, checks with you before agreeing to anything new, and you can join anytime.`
              : 'You talk. The assistant listens, suggests what to say, and writes up the call.'}
          </p>
          {mode === 'agent' && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-ink-3 px-1 flex-shrink-0">Speaks</span>
              <div className="flex-1"><Segmented size="sm" value={language} onChange={setLanguage} options={LANGUAGES} /></div>
            </div>
          )}
        </div>

        <div className="relative">
          <span className="block text-sm font-medium text-ink mb-1.5">Who to call</span>
          {/* A full keyboard, not the number pad, so you can search contacts by name. */}
          <input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} value={to} required
            onChange={(e) => { setTo(e.target.value); setPicking(true) }}
            onFocus={(e) => {
              setPicking(true)
              // Phones: bring the field to the top, so its suggestions aren't hidden under the keyboard.
              const field = e.currentTarget
              if (touchScreen()) setTimeout(() => field.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300)
            }}
            onBlur={() => setTimeout(() => setPicking(false), 150)}
            placeholder={everyone.length ? 'Search contacts, or type a number' : '(214) 555-0123'}
            enterKeyHint="next" className={`${fieldClass} w-full h-11 text-base tabular-nums scroll-mt-4`} />
          {contact && <p className="text-xs text-ink-3 mt-1.5 px-1">{contact.name}{contact.notes ? ' · their notes are included' : ''}</p>}
          {matches.length > 0 && (
            <div className="absolute z-10 inset-x-0 mt-1 bg-surface rounded-lg shadow-pop py-1 max-h-80 overflow-y-auto">
              {matches.map((c) => (
                <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setTo(formatNumber(c.phone) || c.phone); setPicking(false) }}
                  className="w-full flex items-center justify-between gap-3 px-3 h-11 text-left hover:bg-surface-2">
                  <span className="text-sm text-ink truncate">{c.name}</span>
                  <span className="text-xs text-ink-3 tabular-nums flex-shrink-0">
                    {c.label && <span className="mr-1.5">{c.label}</span>}{formatNumber(c.phone) || c.phone}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <DictationField
          label={mode === 'agent' ? 'What should happen' : 'Notes for the assistant'}
          value={text} onChange={setText} rows={4} maxLength={8000}
          placeholder={mode === 'agent'
            ? 'e.g. Move my cleaning to a weekday morning next week. Fine with 8–11am. Don’t agree to any fee.'
            : 'Optional: what you want out of the call, so the suggestions are useful.'}
          hint={mode === 'agent' ? 'Your name and standing details come from Settings → Profile.' : undefined}
        />

        {error && <Note tone="danger">{error}</Note>}
        <Button type="submit" variant="primary" className="w-full h-11"
          disabled={!!busy || (mode === 'copilot' && phoneState === 'starting')}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : mode === 'agent' ? <Sparkles size={17} /> : <Phone size={17} />}
          {busy === 'plan' ? 'Preparing the call plan…' : busy === 'call' ? 'Calling…' : mode === 'agent' ? 'Review call plan' : 'Call'}
        </Button>
      </form>
    </Card>
  )
}

// ---------- plan review ----------
function PlanView() {
  const { pending, startCall, setDraft, notify } = useCallStore()
  const [busy, setBusy] = useState(false)
  // Asked for by voice: call on its own after a short countdown, unless you cancel.
  const [auto, setAuto] = useState(() => useCallStore.getState().handsFree)
  if (!pending) return null
  const p = pending.plan
  const extras = [
    p.if_phone_menu && `Phone menu: ${p.if_phone_menu}`,
    p.if_voicemail && `Voicemail: “${p.if_voicemail}”`,
    p.confirm_before_hanging_up?.length && `Reads back before hanging up: ${p.confirm_before_hanging_up.join(', ')}`,
  ].filter(Boolean)
  const call = async () => {
    setAuto(false)
    setBusy(true)
    try { await startCall(pending) } catch (err) {
      notify(err.message, 'error')
      if (useCallStore.getState().handsFree) say(`The call didn't start. ${err.message}`)
    } finally { setBusy(false) }
  }
  return (
    <Card className="p-5">
      {auto && !busy && (
        <div className="mb-4">
          <Countdown label={`Calling ${callWith(pending)}`} onDone={call} onCancel={() => setAuto(false)} />
        </div>
      )}
      <p className="text-xs text-ink-3">Call plan · {callWith(pending)}</p>
      <h2 className="text-lg font-semibold text-ink mt-1 leading-snug">{p.objective || 'Call plan'}</h2>
      <div className="mt-4 rounded-lg bg-surface-2 px-4 py-3">
        <p className="text-xs font-medium text-ink-3">{assistantName()} opens with</p>
        <p className="text-sm text-ink mt-1 leading-relaxed">“{p.greeting
          ? (/\bAI\b/.test(p.greeting) ? p.greeting : `Hi, this is ${assistantName()}, an AI assistant. ${p.greeting.replace(/^(hi|hello)[,!.]?\s*/i, '')}`)
          : `Hi, this is ${assistantName()}, an AI assistant calling on behalf of ${ownerName()}. This call is being transcribed. ${p.opening || ''}`.trim()}”</p>
      </div>
      {p.missing_info?.length > 0 && (
        <Note tone="warn" className="mt-4">
          <span className="font-medium">Not covered by your details.</span> {assistantName()} will ask you if these come up: {p.missing_info.join('; ')}.
        </Note>
      )}
      {p.steps?.length > 0 && <Block title="How it should go"><Bullets items={p.steps} ordered /></Block>}
      {p.facts_to_share?.length > 0 && (
        <Block title="Can share">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {p.facts_to_share.map((f, i) => [<dt key={`t${i}`} className="text-ink-3">{f.label}</dt>, <dd key={`d${i}`} className="text-ink">{f.value}</dd>])}
          </dl>
        </Block>
      )}
      {p.can_agree_to?.length > 0 && <Block title="Can agree to on its own"><Bullets items={p.can_agree_to} /></Block>}
      {p.ask_owner_before?.length > 0 && <Block title="Will check with you first"><Bullets items={p.ask_owner_before} /></Block>}
      {p.never_share?.length > 0 && <Block title="Will never share"><Bullets items={p.never_share} /></Block>}
      {p.likely_questions?.length > 0 && <Block title="If they ask"><Bullets items={p.likely_questions.map((x) => `${x.q} → ${x.a || 'Will ask you'}`)} /></Block>}
      {extras.length > 0 && <Block title="Also"><Bullets items={extras} /></Block>}
      <p className="text-xs text-ink-3 mt-5">A guide, not a script. {assistantName()} adapts to what they say and checks with you before anything outside it.</p>
      <div className="flex gap-2 mt-5">
        <Button variant="primary" onClick={call} disabled={busy} className="flex-[2] h-11">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Phone size={17} />}Call now
        </Button>
        <Button onClick={() => setDraft({ mode: pending.mode, to: pending.to, goal: pending.goal, brief: pending.brief, language: pending.language })} className="flex-1 h-11">
          <Pencil size={15} />Edit
        </Button>
      </div>
    </Card>
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

const NO_PARTIALS = { you: '', them: '' }

/** The conversation. While the call is live it follows the newest line. */
function Transcript({ lines, partials = NO_PARTIALS, live = false }) {
  const end = useRef(null)
  useEffect(() => { if (live) end.current?.scrollIntoView({ block: 'end' }) }, [live, lines.length, partials.them, partials.you])
  const who = (s) => (s === 'you' ? 'You' : s === 'agent' ? assistantName() : 'Them')
  if (!lines.length && !partials.them && !partials.you) {
    return <p className="text-center text-sm text-ink-3 py-8">The conversation shows up here as it happens.</p>
  }
  return (
    <div className="space-y-2.5">
      {lines.map((l, i) => {
        // Notes about the call itself, such as "Went to voicemail", sit in the middle.
        if (l.speaker === 'system') {
          return <p key={i} className="flex justify-center"><span className="rounded-full bg-warn/10 text-warn text-xs font-medium px-3 py-1">{l.text}</span></p>
        }
        const mine = l.speaker !== 'them'
        return (
          <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${mine ? 'bg-accent/10 text-ink rounded-br-md' : 'bg-surface-2 text-ink rounded-bl-md'}`}>
              <span className={`block text-[11px] font-semibold mb-0.5 ${mine ? 'text-accent' : 'text-ink-3'}`}>{who(l.speaker)}</span>
              {l.text}
            </div>
          </div>
        )
      })}
      {partials.them && <p className="text-sm italic text-ink-3"><b className="not-italic font-medium">Them:</b> {partials.them}</p>}
      {partials.you && <p className="text-sm italic text-ink-3 text-right"><b className="not-italic font-medium">You:</b> {partials.you}</p>}
      <div ref={end} />
    </div>
  )
}

function QuestionCard({ question, answer }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(null)
  useEffect(() => () => listening?.cancel(), [listening])
  const send = (v) => { answer(v); setText('') }
  // Say the answer: it's sent once you pause.
  const speak = async () => {
    if (listening) return listening.stop()
    try {
      const listener = await listenUntilPause({ onText: setText, noSpeechMs: 12000 })
      setListening(listener)
      const said = await listener.done
      setListening(null)
      if (said.trim()) send(said.trim())
    } catch {
      setListening(null)
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(text) }} className="rounded-xl border-2 border-accent bg-surface shadow-pop p-4 space-y-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-accent">
        <MessageCircleQuestion size={15} />{assistantName()} needs your answer · they’re on hold
      </p>
      <p className="text-[15px] font-medium text-ink leading-snug">{question.question}</p>
      {/* Hands-free: no keyboard popping up over the Speak button. */}
      <input autoFocus={!useCallStore.getState().handsFree} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Type your answer" enterKeyHint="send" className={`${fieldClass} w-full h-10`} />
      <div className="flex gap-2">
        <Button size="sm" onClick={speak} aria-pressed={!!listening}
          className={listening ? '!bg-danger !text-white animate-pulse' : ''}>
          {listening ? <MicOff size={14} /> : <Mic size={14} />}{listening ? 'Listening' : 'Speak'}
        </Button>
        <Button type="submit" variant="primary" size="sm" className="flex-1" disabled={!text.trim()}>Send</Button>
        <Button size="sm" onClick={() => send('Yes, that works.')}>Yes</Button>
        <Button size="sm" onClick={() => send('No. Say I’ll follow up.')}>No</Button>
      </div>
    </form>
  )
}

function ControlButton({ icon: Icon, label, active, danger, ...props }) {
  return (
    <button type="button" aria-pressed={active}
      className={`flex flex-col items-center justify-center gap-1.5 h-16 rounded-xl text-xs font-medium transition-colors ${
        danger ? 'bg-danger text-white hover:bg-danger/90' : active ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-ink hover:bg-line'
      }`} {...props}>
      <Icon size={19} />{label}
    </button>
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
  const state = s.agentState && !ended && (AGENT_TEXT[s.agentState.state]?.(assistantName(), s.agentState.detail) || s.agentState.state)
  return (
    <div className="space-y-3">
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${live ? 'bg-danger animate-pulse' : ended ? 'bg-ink-3' : 'bg-warn'}`} />
          <span className={`font-medium ${live ? 'text-danger' : 'text-ink-2'}`}>{statusText(s.status || 'starting')}</span>
          <span className="ml-auto tabular-nums text-ink-2">{time}</span>
        </div>
        <p className="text-2xl font-semibold tracking-tight text-ink mt-3">{callWith(session)}</p>
        {contactFor(session.to) && <p className="text-sm text-ink-3 tabular-nums">{formatNumber(session.to)}</p>}
        {session.goal && <p className="text-sm text-ink-2 mt-1.5 line-clamp-2">{session.goal}</p>}
        {state && <p className="mt-4 text-sm text-ink-2 flex items-center gap-2"><Bot size={15} className="text-accent" />{state}</p>}
        {!ended && (
          agentMode ? (
            <div className="flex gap-2 mt-5">
              <Button variant="primary" onClick={join} disabled={busy || s.joinPending} className="flex-1 h-11">
                {busy || s.joinPending ? <Loader2 size={17} className="animate-spin" /> : <Phone size={17} />}Join the call
              </Button>
              <Button onClick={s.hangup} className="flex-1 h-11 !text-danger"><PhoneOff size={17} />End call</Button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 mt-5">
              <ControlButton icon={s.muted ? MicOff : Mic} label={s.muted ? 'Unmute' : 'Mute'} active={s.muted} onClick={s.toggleMute} />
              <ControlButton icon={Volume2} label="Speaker" active={s.speaker} onClick={s.toggleSpeaker} />
              <ControlButton icon={Grid3x3} label="Keypad" active={keypad} onClick={() => setKeypad(!keypad)} />
              <ControlButton icon={PhoneOff} label="End" danger onClick={s.hangup} />
            </div>
          )
        )}
        {/* The notes usually replace this screen a few seconds after hang-up. If they never come
            (server asleep, connection lost), don't leave the finished call stuck here. */}
        {ended && (
          <div className="flex items-center gap-3 mt-5">
            <Loader2 size={15} className="animate-spin text-ink-3" />
            <span className="flex-1 text-sm text-ink-3">Writing up the call…</span>
            <Button variant="primary" size="sm" onClick={s.newCall}>Done</Button>
          </div>
        )}
        {keypad && !agentMode && !ended && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
              <button key={d} onClick={() => s.sendDigits(d)} className="h-12 rounded-lg bg-surface-2 text-xl text-ink hover:bg-line">{d}</button>
            ))}
          </div>
        )}
      </Card>
      {s.question && <QuestionCard key={s.question.id} question={s.question} answer={s.answer} />}
      {s.suggestion && !ended && (
        <Card className="p-4 border-l-4 border-accent">
          <p className="text-xs font-semibold text-ink-3">Say next</p>
          {s.suggestion.say?.map((t, i) => <p key={i} className={i ? 'text-sm text-ink-2 mt-1' : 'text-[17px] font-medium text-ink leading-snug mt-1'}>{t}</p>)}
          {s.suggestion.note && <p className="text-sm text-warn mt-2">{s.suggestion.note}</p>}
        </Card>
      )}
      <Card className="p-4"><Transcript lines={s.lines} partials={s.partials} live={!ended} /></Card>
    </div>
  )
}

// ---------- after the call ----------
const OUTCOME = {
  done: ['Done', 'success'],
  needs_you: ['Needs you', 'warn'],
  failed: ['Not completed', 'danger'],
  no_answer: ['No answer', 'warn'],
  voicemail: ['Went to voicemail', 'warn'],
  no_conversation: ['No conversation', 'warn'],
}
const TONE_TEXT = { success: 'text-success', warn: 'text-warn', danger: 'text-danger' }

/** Old calls stored follow-ups as plain strings. */
const asItem = (x) => (typeof x === 'string' ? { title: x, date: '', time: '' } : x)

/** What came out of a call, and the one-tap next steps: add to tasks, try again later, save the contact. */
function CallOutcome({ call, summary, error }) {
  const { notify, setDraft } = useCallStore()
  const [added, setAdded] = useState({})
  const mark = (key) => setAdded((a) => ({ ...a, [key]: true }))
  const run = (key, fn, message) => async () => {
    try { await fn(); mark(key); notify(message) } catch (e) { notify(e.message, 'error') }
  }

  const [label, tone] = OUTCOME[summary?.outcome] || (error ? ['Call failed', 'danger'] : ['Call notes', 'success'])
  const appointments = summary?.appointments || []
  const followUps = (summary?.action_items || []).map(asItem).filter((x) => x?.title)
  const retry = !!error || ['no_answer', 'voicemail', 'failed', 'needs_you', 'no_conversation'].includes(summary?.outcome) || !!summary?.callback_after
  const suggested = summary?.callback_after
  const redial = () => {
    const body = { mode: call.mode, to: call.to, goal: call.goal, brief: call.brief }
    if (call.mode === 'agent' && call.plan) useCallStore.setState({ pending: { ...body, plan: call.plan }, view: 'plan', detail: null })
    else setDraft(body)
  }

  return (
    <>
      <p className={`text-xs font-semibold ${TONE_TEXT[tone]}`}>{label}</p>
      <h2 className="text-lg font-semibold text-ink mt-1 leading-snug">{summary?.headline || call.goal || 'Call'}</h2>
      {error && <Note tone="danger" className="mt-3 flex gap-2"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />{error}</Note>}
      {summary?.summary && <p className="text-sm text-ink-2 leading-relaxed mt-2">{summary.summary}</p>}
      {summary?.key_facts?.length > 0 && <Block title="Key details"><Bullets items={summary.key_facts} /></Block>}

      {appointments.length > 0 && (
        <Block title="Booked">
          <div className="rounded-lg border border-line divide-y divide-line">
            {appointments.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <CalendarPlus size={16} className="text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{a.title}</p>
                  <p className="text-xs text-ink-3">{formatDue(a.date, a.time)}</p>
                </div>
                <Button size="sm" variant={added[`a${i}`] ? 'ghost' : 'secondary'} disabled={added[`a${i}`]}
                  onClick={run(`a${i}`, () => addAppointment(a, call), 'Added to your schedule')}>
                  {added[`a${i}`] ? <><Check size={14} />Added</> : 'Add'}
                </Button>
              </div>
            ))}
          </div>
        </Block>
      )}

      {followUps.length > 0 && (
        <Block title="Follow-ups">
          <div className="rounded-lg border border-line divide-y divide-line">
            {followUps.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                <ListPlus size={16} className="text-ink-3 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink">{f.title}</p>
                  {f.date && <p className="text-xs text-ink-3">{formatDue(f.date, f.time)}</p>}
                </div>
                <Button size="sm" variant={added[`f${i}`] ? 'ghost' : 'secondary'} disabled={added[`f${i}`]}
                  onClick={run(`f${i}`, () => addFollowUp(f, call), 'Added to tasks')}>
                  {added[`f${i}`] ? <><Check size={14} />Added</> : 'Add'}
                </Button>
              </div>
            ))}
          </div>
        </Block>
      )}

      {retry && (
        <Block title="Try again">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={redial}><RotateCcw size={14} />Call again now</Button>
            {suggested && suggested !== '1h' && suggested !== 'tomorrow' && (
              <Button size="sm" disabled={added.cbS} onClick={run('cbS', () => scheduleCallback(call, suggested), 'I’ll remind you to call back')}>
                {added.cbS ? <Check size={14} /> : <Clock size={14} />}{added.cbS ? 'Reminder set' : formatDue(callbackTime(suggested).dueDate, callbackTime(suggested).dueTime)}
              </Button>
            )}
            <Button size="sm" disabled={added.cb1} onClick={run('cb1', () => scheduleCallback(call, '1h'), 'I’ll remind you in an hour')}>
              {added.cb1 ? <Check size={14} /> : <Clock size={14} />}{added.cb1 ? 'Reminder set' : 'In an hour'}
            </Button>
            <Button size="sm" disabled={added.cbT} onClick={run('cbT', () => scheduleCallback(call, 'tomorrow'), 'I’ll remind you tomorrow at 9')}>
              {added.cbT ? <Check size={14} /> : <Clock size={14} />}{added.cbT ? 'Reminder set' : 'Tomorrow 9 AM'}
            </Button>
          </div>
          <p className="text-xs text-ink-3 mt-2">A reminder carries the call, so one tap hands it back to {assistantName()} with the same details.</p>
        </Block>
      )}

      <SaveContact phone={call.to} />
    </>
  )
}

function SaveContact({ phone }) {
  const addContact = useTaskStore((s) => s.addContact)
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  if (!phone || contactFor(phone)) return null
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-5 inline-flex items-center gap-2 text-sm text-accent hover:underline">
        <UserPlus size={15} />Save {formatNumber(phone) || phone} as a contact
      </button>
    )
  }
  return (
    <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) addContact({ name: name.trim(), phone }) }}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Bright Smiles Dental" className={`${fieldClass} flex-1`} />
      <Button type="submit" size="sm" variant="primary" className="h-9" disabled={!name.trim()}>Save</Button>
    </form>
  )
}

function Summary() {
  const { summary, session, lines, newCall, status } = useCallStore()
  if (!summary || !session) return null
  const error = isBadStatus(status) ? statusText(status) : ''
  return (
    <div className="space-y-3">
      <Card className="p-5">
        <CallOutcome call={session} summary={summary} error={error} />
        <div className="flex mt-6">
          <Button variant="primary" onClick={newCall} className="flex-1 h-11">Done</Button>
        </div>
      </Card>
      {lines.length > 0 && <Card className="p-4"><Transcript lines={lines} /></Card>}
    </div>
  )
}

// ---------- history + one call ----------
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

// How each call went, for the list and its filters.
const RESULT = {
  live: ['Live', 'text-danger'],
  answered: ['Answered', 'text-success'],
  voicemail: ['Voicemail', 'text-warn'],
  no_answer: ['No answer', 'text-warn'],
  busy: ['Busy', 'text-warn'],
  canceled: ['Canceled', 'text-ink-3'],
  failed: ['Failed', 'text-danger'],
}

function RecentCalls() {
  const { history, openDetail, notify } = useCallStore()
  const [filter, setFilter] = useState('all')
  if (!history.length) return <p className="text-sm text-ink-3 px-2">Your calls will show up here.</p>
  const counts = {}
  for (const h of history) { const r = callResult(h); counts[r] = (counts[r] || 0) + 1 }
  const shown = (filter === 'all' ? history : history.filter((h) => callResult(h) === filter)).slice(0, 50)
  const chip = (key, label, n) => (
    <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
      className={`h-8 px-3 rounded-full text-[13px] font-medium transition-colors ${filter === key ? 'bg-ink text-bg' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}>
      {label} <span className="opacity-60 tabular-nums">{n}</span>
    </button>
  )
  return (
    <>
    <div className="flex flex-wrap gap-1.5 pb-2">
      {chip('all', 'All', history.length)}
      {Object.keys(RESULT).filter((k) => counts[k]).map((k) => chip(k, RESULT[k][0], counts[k]))}
    </div>
    <Card className="overflow-hidden divide-y divide-line">
      {shown.map((h) => {
        const [resultLabel, resultTone] = RESULT[callResult(h)] || RESULT.failed
        const Icon = h.mode === 'agent' ? Bot : UserRound
        return (
          <button key={h.id} onClick={() => openDetail(h.id).catch((e) => notify(e.message, 'error'))}
            className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-surface-2/60 transition-colors">
            <span className="mt-0.5 w-8 h-8 rounded-full bg-surface-2 text-ink-3 flex items-center justify-center flex-shrink-0"><Icon size={15} /></span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm text-ink truncate flex-1">{h.headline || h.goal || (h.mode === 'agent' ? 'Assistant call' : 'Call')}</span>
                <span className={`text-xs font-medium flex-shrink-0 ${resultTone}`}>{resultLabel}</span>
              </span>
              <span className="block text-xs text-ink-3 mt-0.5 truncate">{callWith(h)} · {when(h.startedAt)}</span>
            </span>
          </button>
        )
      })}
      {!shown.length && <p className="text-sm text-ink-3 px-4 py-3">No calls like that yet.</p>}
    </Card>
    </>
  )
}

function Detail() {
  const { detail: c, newCall, setDraft, notify } = useCallStore()
  if (!c) return null
  const err = c.error || (isBadStatus(c.status) ? `Call ${statusText(c.status).toLowerCase()}` : '')
  return (
    <div className="space-y-3">
      <button onClick={newCall} className="flex items-center gap-1 text-sm font-medium text-accent"><ChevronLeft size={16} />All calls</button>
      <Card className="p-5">
        <p className="text-xs text-ink-3 mb-3">{callWith(c)} · {c.mode === 'agent' ? `${assistantName()} made the call` : 'You talked'} · {when(c.startedAt)} · <span className={`font-medium ${(RESULT[callResult(c)] || RESULT.failed)[1]}`}>{(RESULT[callResult(c)] || RESULT.failed)[0]}</span></p>
        <CallOutcome call={c} summary={c.summary} error={err} />
        {(c.brief || c.goal) && (
          <Block title="What you asked for">
            <p className="text-sm text-ink-2 whitespace-pre-wrap max-h-40 overflow-y-auto rounded-lg bg-surface-2 px-3 py-2">{callText(c)}</p>
          </Block>
        )}
        <div className="flex gap-2 mt-6">
          <Button onClick={() => setDraft({ mode: c.mode, to: c.to, goal: c.goal, brief: c.brief })} className="flex-1"><Pencil size={15} />New call with these details</Button>
        </div>
      </Card>
      {c.transcript?.length > 0 && <Card className="p-4"><Transcript lines={c.transcript} /></Card>}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">What happened</h4>
          <button onClick={() => { navigator.clipboard?.writeText((c.log || []).map((l) => `${l.at} ${l.level} ${l.text}`).join('\n')); notify('Copied') }}
            className="text-xs text-ink-3 hover:text-ink flex items-center gap-1"><Copy size={12} />Copy</button>
        </div>
        <ol className="space-y-1 text-[13px] max-h-64 overflow-y-auto">
          {(c.log || []).map((l, i) => (
            <li key={i} className="grid grid-cols-[76px_1fr] gap-2">
              <time className="text-ink-3 tabular-nums">{fmtTime(l.at)}</time>
              <span className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warn' : 'text-ink-2'}>{l.text}</span>
            </li>
          ))}
          {!c.log?.length && <li className="text-ink-3">No log lines were recorded.</li>}
        </ol>
      </Card>
    </div>
  )
}

// ---------- contacts ----------
function Contacts() {
  const contacts = useTaskStore((s) => s.contacts)
  const setDraft = useCallStore((s) => s.setDraft)
  const [editing, setEditing] = useState(null)
  return (
    <>
      <Card className="overflow-hidden divide-y divide-line">
        {contacts.map((c) => (
          <div key={c.id} className="group flex items-center gap-3 px-4 py-2.5">
            <span className="w-8 h-8 rounded-full bg-accent/10 text-accent text-sm font-semibold flex items-center justify-center flex-shrink-0">
              {c.name.charAt(0).toUpperCase()}
            </span>
            <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(c)}>
              <span className="block text-sm text-ink truncate">{c.name}</span>
              <span className="block text-xs text-ink-3 truncate tabular-nums">{formatNumber(c.phone) || c.phone}{c.notes ? ` · ${c.notes}` : ''}</span>
            </button>
            <IconButton label={`Call ${c.name}`} onClick={() => setDraft({ mode: 'agent', to: c.phone })}><Phone size={16} /></IconButton>
          </div>
        ))}
        <button onClick={() => setEditing({})} className="w-full flex items-center gap-3 px-4 h-11 text-sm text-accent hover:bg-surface-2/60">
          <Plus size={16} />Add contact
        </button>
      </Card>
      {editing && <ContactEditor contact={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ContactEditor({ contact, onClose }) {
  const { addContact, updateContact, removeContact } = useTaskStore()
  const isEdit = !!contact.id
  const [name, setName] = useState(contact.name || '')
  const [phone, setPhone] = useState(contact.phone ? formatNumber(contact.phone) || contact.phone : '')
  const [notes, setNotes] = useState(contact.notes || '')
  const [confirming, setConfirming] = useState(false)
  const save = () => {
    if (!name.trim() || !phone.trim()) return
    const data = { name: name.trim(), phone: phone.trim(), notes: notes.trim() }
    if (isEdit) updateContact(contact.id, data)
    else addContact(data)
    onClose()
  }
  return (
    <Sheet title={isEdit ? 'Edit contact' : 'New contact'} onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (confirming
            ? <Button variant="danger" size="sm" className="-ml-2" onClick={() => { removeContact(contact.id); onClose() }}><Trash2 size={15} />Really delete</Button>
            : <Button variant="danger" size="sm" className="-ml-2" onClick={() => setConfirming(true)}><Trash2 size={15} />Delete</Button>)}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!name.trim() || !phone.trim()}>Save</Button>
        </div>
      }>
      <div className="p-5 space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Name</span>
          <input autoFocus={!isEdit} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bright Smiles Dental" className={`${fieldClass} w-full`} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(214) 555-0123" className={`${fieldClass} w-full tabular-nums`} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">What the assistant should know</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
            placeholder="e.g. Dr. Lee’s office. Patient ID 48213. Press 2 for appointments."
            className="w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface resize-y" />
          <span className="block text-xs text-ink-3 mt-1">Shared on every call to this number.</span>
        </label>
      </div>
    </Sheet>
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
    <Sheet title="Server logs" onClose={closeLogs} wide
      footer={
        <div className="flex items-center gap-3">
          <label className="text-xs text-ink-2 flex items-center gap-2 mr-auto">
            <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} />Problems only
          </label>
          <Button size="sm" onClick={copy}><Copy size={14} />Copy</Button>
        </div>
      }>
      <ol className="px-5 py-3 font-mono text-[12px] leading-relaxed">
        {shown.map((l, i) => (
          <li key={i} className="grid grid-cols-[64px_1fr] gap-3 py-1 border-b border-line/60 break-words">
            <time className="text-ink-3 tabular-nums">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/\s?[AP]M$/i, '')}</time>
            <span className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warn' : 'text-ink-2'}>{l.text}</span>
          </li>
        ))}
        {!shown.length && <li className="text-ink-3 py-6 text-center font-sans">Nothing logged yet.</li>}
        <li ref={end} />
      </ol>
    </Sheet>
  )
}

// ---------- screen ----------
function ServerStatus() {
  const { connected, serverState, wake } = useCallStore()
  if (serverState === 'down' && !connected) {
    return (
      <button onClick={() => wake()} className="inline-flex items-center gap-1.5 text-danger">
        <span className="w-1.5 h-1.5 rounded-full bg-danger" />Server offline · Retry
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : serverState === 'waking' ? 'bg-warn animate-pulse' : 'bg-ink-3'}`} />
      {connected ? 'Ready to call' : serverState === 'waking' ? 'Waking up the server…' : 'Connecting…'}
    </span>
  )
}

export default function Calls({ onOpenSettings }) {
  const { view, loadHistory, openLogs, unseenProblems, phoneState, phoneError, session, status, newCall, draftVersion } = useCallStore()
  const ready = isCallPilotReady()
  const problems = useTaskStore((st) => st.settings.callpilotProblems) || []
  useEffect(() => { if (ready) loadHistory() }, [ready, loadHistory])
  const onCall = session && status && status !== 'ended' && !isBadStatus(status)
  // A new screen (a plan, a call's details, a form filled from a contact) starts at the top, where it begins.
  const scroller = useRef(null)
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0 }, [view, draftVersion])
  const [usageOpen, setUsageOpen] = useState(false)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="safe-top flex-shrink-0">
        <div className="max-w-3xl mx-auto w-full px-5 md:px-10 pt-6 md:pt-10 pb-4 flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[28px] md:text-[30px] leading-tight font-semibold tracking-tight text-ink">Calls</h1>
            <p className="text-sm text-ink-3 mt-1">{ready ? <ServerStatus /> : 'Not set up yet'}</p>
          </div>
          {ready && view !== 'compose' && view !== 'active' && (
            <Button variant="primary" size="sm" onClick={newCall} className="mb-1"><Plus size={15} />New call</Button>
          )}
          {ready && (
            <IconButton label="Usage & credits" onClick={() => setUsageOpen(true)} className="mb-0.5">
              <Gauge size={18} />
            </IconButton>
          )}
          {ready && (
            <IconButton label="Server logs" onClick={openLogs} className="relative mb-0.5 md:-mr-2">
              <ScrollText size={18} />
              {unseenProblems > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger" />}
            </IconButton>
          )}
          <IconButton label="Settings" onClick={onOpenSettings} className="md:hidden -mr-2 mb-0.5">
            <Settings size={20} />
          </IconButton>
        </div>
      </header>
      {usageOpen && <UsagePanel onClose={() => setUsageOpen(false)} />}

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-3 md:px-10 pb-36 md:pb-16">
          {!ready ? (
            <Card className="p-8 text-center">
              <span className="w-12 h-12 mx-auto rounded-2xl bg-accent/10 text-accent flex items-center justify-center mb-4"><Phone size={22} /></span>
              <h2 className="text-lg font-semibold text-ink">Let your assistant make calls</h2>
              <p className="text-sm text-ink-3 mt-1.5 max-w-sm mx-auto">
                Book appointments, wait on hold, reschedule and follow up. Connect your calling server once in Settings.
              </p>
              <Button variant="primary" onClick={onOpenSettings} className="mt-5">Set up calling</Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {problems.length > 0 && (
                <Note tone="warn">
                  <span className="font-medium">Your server reports setup items:</span> {problems.join('; ')}
                </Note>
              )}
              {phoneState === 'error' && <Note tone="danger">Phone line: {phoneError}</Note>}
              {onCall && view !== 'active' && (
                <button onClick={() => useCallStore.setState({ view: 'active' })}
                  className="w-full flex items-center gap-2 rounded-xl bg-danger/10 px-4 h-12 text-sm font-medium text-danger">
                  <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />Call in progress · Return to call
                </button>
              )}
              {view === 'compose' && <Compose key={draftVersion} />}
              {view === 'plan' && <PlanView />}
              {view === 'active' && <ActiveCall />}
              {view === 'summary' && <Summary />}
              {view === 'detail' && <Detail />}
              {(view === 'compose' || view === 'summary') && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2 pt-5">
                  <section>
                    <h3 className="px-2 mb-1.5 text-[13px] font-semibold text-ink-2">Recent calls</h3>
                    <RecentCalls />
                  </section>
                  <section>
                    <h3 className="px-2 mb-1.5 text-[13px] font-semibold text-ink-2 flex items-center gap-1.5"><BookUser size={14} />Contacts</h3>
                    <Contacts />
                  </section>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
