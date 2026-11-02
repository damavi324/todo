import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone, CalendarPlus, RotateCcw, X, Flag, Mic, MicOff, ArrowUp } from 'lucide-react'
import { cp, isCallPilotReady, assistantName, formatNumber, callerContext } from '../lib/callpilot'
import { startDictation } from '../lib/dictation'
import { recordOtherUsage } from '../lib/usage'
import { parseSpokenTask } from '../lib/voiceTask'
import { toLocalYMD } from '../lib/dates'
import { useTaskStore } from '../store/useTaskStore'
import { PRIORITY_COLOR } from '../lib/views'
import { useCallStore } from '../store/useCallStore'
import SpeechCapture from '../plugins/SpeechCapture'
import { useBack } from '../lib/backStack'
import { mergeContacts, phoneContacts, pickByName, likelyContacts } from '../lib/phoneContacts'


function localNow() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return { now: `${toLocalYMD(d)}T${hh}:${mm}`, weekday: d.toLocaleDateString('en-US', { weekday: 'long' }), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

function describeDue(t) {
  if (!t?.dueDate) return ''
  const d = new Date(`${t.dueDate}T${t.dueTime || '00:00'}`)
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return t.dueTime ? `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day
}

// What a result turns into: a task (with any call attached), or a draft for the call form.
const taskWithCall = (r) => ({ ...r.task, listId: r.task.listId || undefined, call: r.call ? { to: r.call.to, contact: r.call.contact, goal: r.call.goal, details: r.call.details, mode: r.call.mode } : undefined })
const callDraft = (r) => ({ mode: r.call.mode, to: r.call.to || r.call.contact || '', goal: r.call.goal || (r.call.contact ? `Call ${r.call.contact}` : ''), brief: [r.call.contact && `Calling: ${r.call.contact}`, r.call.details].filter(Boolean).join('\n') })

/**
 * The assistant, from anywhere in the app: speak or type in the same box.
 * Claude (on the calling server) decides whether it is a task, a call for Pilot, or both; a call you said out loud
 * goes straight to dialing. Falls back to on-device speech + the built-in parser when the server is not set up.
 */
export default function VoiceAssistant({ onClose, onTask: handTask, onCall: handCall }) {
  const lists = useTaskStore((s) => s.lists)
  const [phase, setPhase] = useState('compose') // compose | thinking | result | error
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rec = useRef(null)
  const [waking, setWaking] = useState(false)
  const [onDevice, setOnDevice] = useState(false) // phone's own recognizer (stops by itself)
  const smart = isCallPilotReady()
  // Closed while it was still working something out: drop the late result instead of acting on it.
  const closed = useRef(false)
  const onTask = (...args) => { if (!closed.current) handTask(...args) }
  const onCall = (...args) => { if (!closed.current) handCall(...args) }
  const [listening, setListening] = useState(false)
  // Once you type, the words are yours: the microphone stops and nothing it hears afterwards replaces them.
  const typed = useRef(false)

  // Turns what you said into a task and/or a call (Claude on the server, local parser as backup).
  const interpret = async (heard, { spoken = false } = {}) => {
    setText(heard)
    setPhase('thinking')
    if (!smart) {
      try { onTask(await parseSpokenTask(heard)) } catch (e) { setError(e.message); setPhase('error') }
      return
    }
    try {
      if (useCallStore.getState().serverState !== 'up') {
        setWaking(true)
        const up = await useCallStore.getState().wake()
        setWaking(false)
        if (!up) throw new Error('The calling server didn’t wake up, so I used the basic parser.')
      }
      const people = mergeContacts(useTaskStore.getState().contacts, phoneContacts())
      const { result: r, usage } = await cp('/api/assistant', { text: heard, ...callerContext(), ...localNow(), lists: lists.map((l) => ({ id: l.id, name: l.name })), contacts: likelyContacts(people, heard) }, { timeoutMs: 45000 })
      // The name it heard, matched to a saved or phone contact, gives the number.
      if (r.call && !r.call.to && r.call.contact) {
        const who = pickByName(people, r.call.contact)
        if (who) r.call = { ...r.call, to: who.phone, contact: who.name }
      }
      recordOtherUsage('assistant', usage)
      // Single, clear intent: go straight to it.
      if (r.kind === 'task' && r.task) return onTask({ ...r.task, listId: r.task.listId || undefined })
      // A call you said out loud, with who and why: plan it and dial, hands-free (cancel stays one tap away).
      if (spoken && r.kind === 'call' && r.call && r.call.when !== 'later' && r.call.to && r.call.goal) {
        return onCall({ ...callDraft(r), autoStart: true })
      }
      setResult(r)
      setPhase('result')
    } catch (e) {
      setWaking(false)
      // Server hiccup: still save the words as a task with the local parser.
      try {
        const task = await parseSpokenTask(heard)
        onTask({ ...task, parseWarning: e.message })
      } catch {
        setError(e.message)
        setPhase('error')
      }
    }
  }

  const stopListening = () => {
    rec.current?.cancel()
    rec.current = null
    SpeechCapture.stop?.().catch(() => {})
    setListening(false)
  }

  const begin = async () => {
    setResult(null); setError(''); setPhase('compose')
    typed.current = false
    const before = text.trim()
    const join = (t) => [before, t].filter(Boolean).join(' ')
    setListening(true)
    // Server asleep (free cloud plan) or not set up: listen on the phone, so you can talk right away.
    const serverUp = useCallStore.getState().serverState === 'up' && useCallStore.getState().connected
    setOnDevice(!smart || !serverUp)
    if (!smart || !serverUp) {
      if (smart) useCallStore.getState().wake()
      try {
        await SpeechCapture.requestPermissions()
        const { text: heard } = await SpeechCapture.listen()
        setListening(false)
        if (typed.current || closed.current) return
        if (!heard?.trim()) { setError('I didn’t catch anything. Try again, or type it.'); setPhase('error'); return }
        await interpret(join(heard), { spoken: true })
      } catch (e) {
        setListening(false)
        if (typed.current || closed.current) return
        // No speech recognition here (a desktop browser, say): just type.
        if (!/cancel/i.test(e?.message || '')) setError(e?.message || 'Could not hear that. You can type it instead.')
      }
      return
    }
    try {
      rec.current = await startDictation({
        onText: (t) => { if (!typed.current) setText(join(t)) },
        onError: (e) => { setListening(false); if (!typed.current) setError(e.message) },
      })
    } catch (e) {
      setListening(false)
      setError(`${e.message} You can type it instead.`)
    }
  }

  useEffect(() => {
    // Start listening once the panel is on screen.
    const frame = requestAnimationFrame(() => begin())
    return () => { cancelAnimationFrame(frame); rec.current?.cancel(); SpeechCapture.stop?.().catch(() => {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Send: what you said (finishing the dictation first) or what you typed.
  const send = async () => {
    if (rec.current && !typed.current) {
      const heard = (await rec.current.stop()) || text
      rec.current = null
      setListening(false)
      if (!heard.trim()) { setError('I didn’t catch anything. Try again, or type it.'); return }
      return interpret(heard, { spoken: true })
    }
    stopListening()
    if (text.trim()) await interpret(text.trim(), { spoken: !typed.current })
  }

  const onType = (value) => {
    if (!typed.current) { typed.current = true; if (listening) stopListening() }
    setError('')
    setText(value)
  }

  const cancel = () => {
    closed.current = true
    rec.current?.cancel()
    SpeechCapture.stop?.().catch(() => {})
    onClose()
  }

  useBack(cancel)


  return (
    <div role="dialog" aria-modal="true" aria-label="Assistant"
      className="fixed inset-0 z-50 bg-black/30 flex items-end md:items-center md:justify-center fade-in" onClick={(e) => e.target === e.currentTarget && !listening && cancel()}>
      <div className="w-full md:w-[480px] bg-surface rounded-t-2xl md:rounded-2xl shadow-pop px-6 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] md:pb-8 max-h-[85dvh] overflow-y-auto slide-up md:fade-in">
        {phase === 'compose' && (
          <>
            <div className="flex items-center gap-3">
              {listening
                ? <span className="relative flex w-3 h-3"><span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" /><span className="relative inline-flex rounded-full w-3 h-3 bg-danger" /></span>
                : <Mic size={16} className="text-ink-3" />}
              <p className="flex-1 text-lg font-semibold text-ink">{listening ? 'Listening…' : `Ask ${assistantName()}`}</p>
              <button onClick={cancel} aria-label="Close" className="w-9 h-9 -mr-2 rounded-lg flex items-center justify-center text-ink-3 hover:bg-surface-2"><X size={17} /></button>
            </div>
            <textarea value={text} onChange={(e) => onType(e.target.value)} rows={3} enterKeyHint="send"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={smart ? `Speak or type: "Remind me Friday at 9 to renew my license", or "Have ${assistantName()} call the dentist at 214 555 0100 to move my cleaning."` : 'Speak or type the task, with the day and time.'}
              className="mt-3 w-full resize-none rounded-xl bg-surface-2 px-3.5 py-3 text-[16px] leading-snug text-ink placeholder:text-ink-3 outline-none border border-transparent focus:border-accent/50" />
            {error && <p className="text-xs text-warn mt-1.5">{error}</p>}
            <div className="flex items-center gap-2 mt-3">
              <button type="button" onClick={() => (listening ? (onDevice ? stopListening() : send()) : begin())}
                aria-label={listening ? 'Stop listening' : 'Speak'}
                className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${listening ? 'bg-danger text-white' : 'bg-surface-2 text-accent'}`}>
                {listening ? <MicOff size={19} /> : <Mic size={19} />}
              </button>
              <p className="flex-1 min-w-0 text-xs text-ink-3">{listening ? 'Speak, or start typing to switch' : 'Type, or tap the mic to speak'}</p>
              <button type="button" onClick={send} disabled={!text.trim() && !(listening && !onDevice)} aria-label="Send"
                className="h-11 px-4 rounded-full bg-primary text-white font-medium flex items-center gap-1.5 disabled:opacity-40">
                <ArrowUp size={17} />Send
              </button>
            </div>
          </>
        )}

        {phase === 'thinking' && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 className="animate-spin text-primary" size={22} />
            <div>
              <p className="font-semibold text-ink">{waking ? 'Waking up the server…' : 'Working it out…'}</p>
              {waking && <p className="text-xs text-ink-2 mt-0.5">It was asleep. This takes up to a minute the first time.</p>}
              <p className="text-sm text-ink-2 mt-0.5 line-clamp-2">&ldquo;{text}&rdquo;</p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <>
            <p className="font-semibold text-ink">That didn’t work</p>
            <p className="text-sm text-ink-2 mt-1">{error}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={begin} className="flex-1 flex items-center justify-center gap-2 bg-primary text-white font-medium h-11 rounded-lg"><RotateCcw size={16} />Try again</button>
              <button onClick={cancel} className="flex-1 bg-surface-2 text-ink font-medium h-11 rounded-lg">Close</button>
            </div>
          </>
        )}

        {phase === 'result' && result && (
          <>
            <div className="flex items-start gap-3">
              <p className="flex-1 font-semibold text-ink">{result.kind === 'unclear' ? (result.question || 'Can you say that a little differently?') : (result.say || 'Here’s what I got')}</p>
              <button onClick={cancel} aria-label="Close" className="w-8 h-8 -mr-2 -mt-1 rounded-lg flex items-center justify-center text-ink-3 hover:bg-surface-2"><X size={16} /></button>
            </div>
            <p className="text-xs text-ink-3 mt-1">&ldquo;{result.heard}&rdquo;</p>

            {result.task && (
              <div className="mt-4 rounded-xl border border-line p-3.5">
                <p className="text-xs font-semibold text-ink-2">Task</p>
                <p className="font-medium text-ink mt-0.5">{result.task.title}</p>
                <p className="text-sm text-ink-2 flex items-center gap-2 mt-0.5">
                  {describeDue(result.task) || 'No date'}
                  {PRIORITY_COLOR[result.task.priority] && <Flag size={13} style={{ color: PRIORITY_COLOR[result.task.priority] }} />}
                  {result.call?.when === 'later' && <span className="text-accent">· {assistantName()} call attached</span>}
                </p>
                <button onClick={() => onTask(taskWithCall(result), { review: true })} className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-primary text-white font-medium h-10"><CalendarPlus size={16} />Review and save</button>
              </div>
            )}

            {result.call && (
              <div className="mt-3 rounded-xl border border-line p-3.5">
                <p className="text-xs font-semibold text-ink-2">{result.call.when === 'later' ? 'Call, or make it now' : 'Call'}</p>
                <p className="font-medium text-ink mt-0.5">{result.call.contact || formatNumber(result.call.to) || 'Who to call?'}</p>
                {result.call.goal && <p className="text-sm text-ink-2 mt-0.5">{result.call.goal}</p>}
                {!result.call.to && <p className="text-xs text-warn mt-1">No number heard. You can add it on the next screen.</p>}
                <button onClick={() => onCall(callDraft(result))} className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-accent text-white font-medium h-10">
                  <Phone size={16} />{result.call.mode === 'copilot' ? 'Set up my call' : `Have ${assistantName()} call ${result.call.when === 'later' ? 'now' : ''}`.trim()}
                </button>
              </div>
            )}

            {result.kind === 'unclear' && (
              <button onClick={begin} className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white font-medium h-11 rounded-lg"><RotateCcw size={16} />Say it again</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
