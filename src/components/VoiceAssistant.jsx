import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone, CalendarPlus, RotateCcw, X, Flag } from 'lucide-react'
import { cp, isCallPilotReady, assistantName, formatNumber, callerContext } from '../lib/callpilot'
import { startDictation } from '../lib/dictation'
import { parseSpokenTask } from '../lib/voiceTask'
import { toLocalYMD } from '../lib/dates'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import SpeechCapture from '../plugins/SpeechCapture'

const PRIORITY_COLOR = { high: '#EF4444', medium: '#F97316', low: '#3B82F6' }

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

/**
 * One voice entry point for the whole app.
 * Talk naturally; Claude decides whether it is a task, a call for Pilot, or both.
 * Falls back to on-device speech + the old parser when the calling server is not set up.
 */
export default function VoiceAssistant({ onClose, onTask, onCall }) {
  const lists = useTaskStore((s) => s.lists)
  const [phase, setPhase] = useState('listening') // listening | thinking | result | error
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rec = useRef(null)
  const [waking, setWaking] = useState(false)
  const [onDevice, setOnDevice] = useState(false) // phone's own recognizer (stops by itself)
  const smart = isCallPilotReady()

  // Turns what you said into a task and/or a call (Claude on the server, local parser as backup).
  const interpret = async (heard) => {
    setText(heard)
    setPhase('thinking')
    try {
      if (useCallStore.getState().serverState !== 'up') {
        setWaking(true)
        const up = await useCallStore.getState().wake()
        setWaking(false)
        if (!up) throw new Error('The calling server didn’t wake up, so I used the basic parser.')
      }
      const { result: r } = await cp('/api/assistant', { text: heard, ...callerContext(), ...localNow(), lists: lists.map((l) => ({ id: l.id, name: l.name })) }, { timeoutMs: 45000 })
      // Single, clear intent: go straight to it.
      if (r.kind === 'task' && r.task) return onTask({ ...r.task, listId: r.task.listId || undefined })
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

  const begin = async () => {
    setText(''); setResult(null); setError(''); setPhase('listening')
    // Server asleep (free cloud plan): start waking it, and listen on the phone meanwhile
    // so you can talk right away instead of waiting for it.
    const serverUp = useCallStore.getState().serverState === 'up' && useCallStore.getState().connected
    setOnDevice(!smart || !serverUp)
    if (smart && !serverUp) {
      useCallStore.getState().wake()
      try {
        await SpeechCapture.requestPermissions()
        const { text: heard } = await SpeechCapture.listen()
        if (!heard?.trim()) { setError('I didn’t catch anything. Try again.'); setPhase('error'); return }
        await interpret(heard)
      } catch (e) {
        if (!/cancel/i.test(e?.message || '')) { setError(e?.message || 'Could not hear that'); setPhase('error') } else onClose()
      }
      return
    }
    if (!smart) {
      // On-device recognizer: one utterance, then the existing task parser.
      try {
        await SpeechCapture.requestPermissions()
        const { text: heard } = await SpeechCapture.listen()
        setText(heard)
        setPhase('thinking')
        const task = await parseSpokenTask(heard)
        onTask(task)
      } catch (e) {
        if (!/cancel/i.test(e?.message || '')) { setError(e?.message || 'Could not hear that'); setPhase('error') } else onClose()
      }
      return
    }
    try {
      rec.current = await startDictation({
        onText: (t) => setText(t),
        onError: (e) => { setError(e.message); setPhase('error') },
      })
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }

  useEffect(() => {
    begin()
    return () => { rec.current?.cancel(); SpeechCapture.stop?.().catch(() => {}) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = async () => {
    const heard = (await rec.current?.stop()) || text
    rec.current = null
    if (!heard.trim()) { setError('I didn’t catch anything. Try again.'); setPhase('error'); return }
    await interpret(heard)
  }

  const cancel = () => {
    rec.current?.cancel()
    SpeechCapture.stop?.().catch(() => {})
    onClose()
  }

  const taskWithCall = (r) => ({ ...r.task, listId: r.task.listId || undefined, call: r.call ? { to: r.call.to, contact: r.call.contact, goal: r.call.goal, details: r.call.details, mode: r.call.mode } : undefined })
  const callDraft = (r) => ({ mode: r.call.mode, to: r.call.to, goal: r.call.goal || (r.call.contact ? `Call ${r.call.contact}` : ''), brief: [r.call.contact && `Calling: ${r.call.contact}`, r.call.details].filter(Boolean).join('\n') })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={(e) => e.target === e.currentTarget && phase !== 'listening' && cancel()}>
      <div className="w-full bg-white rounded-t-3xl px-6 pt-6 pb-10 max-h-[85dvh] overflow-y-auto slide-up">
        {phase === 'listening' && (
          <>
            <div className="flex items-center gap-3">
              <span className="relative flex w-3 h-3"><span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" /><span className="relative inline-flex rounded-full w-3 h-3 bg-red-500" /></span>
              <p className="text-lg font-semibold text-gray-800">Listening…</p>
            </div>
            <p className={`mt-3 min-h-[3.5rem] text-[17px] leading-snug ${text ? 'text-gray-900' : 'text-gray-400'}`}>
              {text || (smart ? `Say anything: "Remind me Friday at 9 to renew my license", or "Have ${assistantName()} call the dentist at 214 555 0100 to move my cleaning."` : 'Say the task, including the day and time.')}
            </p>
            {smart && !onDevice ? (
              <div className="flex gap-2 mt-5">
                <button onClick={finish} className="flex-[2] bg-primary text-white font-semibold py-3.5 rounded-2xl">Done</button>
                <button onClick={cancel} className="flex-1 bg-gray-100 text-gray-800 font-medium py-3.5 rounded-2xl">Cancel</button>
              </div>
            ) : (
              <button onClick={cancel} className="mt-5 w-full bg-gray-100 text-gray-800 font-medium py-3 rounded-2xl">Cancel</button>
            )}
          </>
        )}

        {phase === 'thinking' && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 className="animate-spin text-primary" size={22} />
            <div>
              <p className="font-semibold text-gray-800">{waking ? 'Waking up the server…' : 'Working it out…'}</p>
              {waking && <p className="text-xs text-gray-500 mt-0.5">It was asleep. This takes up to a minute the first time.</p>}
              <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">&ldquo;{text}&rdquo;</p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <>
            <p className="font-semibold text-gray-800">That didn’t work</p>
            <p className="text-sm text-gray-600 mt-1">{error}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={begin} className="flex-1 flex items-center justify-center gap-2 bg-primary text-white font-semibold py-3 rounded-2xl"><RotateCcw size={16} />Try again</button>
              <button onClick={cancel} className="flex-1 bg-gray-100 text-gray-800 font-medium py-3 rounded-2xl">Close</button>
            </div>
          </>
        )}

        {phase === 'result' && result && (
          <>
            <div className="flex items-start gap-3">
              <p className="flex-1 font-semibold text-gray-900">{result.kind === 'unclear' ? (result.question || 'Can you say that a little differently?') : (result.say || 'Here’s what I got')}</p>
              <button onClick={cancel} aria-label="Close" className="p-1.5 rounded-full bg-gray-100 text-gray-500"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-400 mt-1">&ldquo;{result.heard}&rdquo;</p>

            {result.task && (
              <div className="mt-4 rounded-2xl border border-gray-200 p-3.5">
                <p className="text-xs font-semibold text-gray-500">Task</p>
                <p className="font-medium text-gray-900 mt-0.5">{result.task.title}</p>
                <p className="text-sm text-gray-500 flex items-center gap-2 mt-0.5">
                  {describeDue(result.task) || 'No date'}
                  {PRIORITY_COLOR[result.task.priority] && <Flag size={13} style={{ color: PRIORITY_COLOR[result.task.priority] }} />}
                  {result.call?.when === 'later' && <span className="text-emerald-700">· {assistantName()} call attached</span>}
                </p>
                <button onClick={() => onTask(taskWithCall(result))} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-white font-semibold py-2.5"><CalendarPlus size={16} />Review and save</button>
              </div>
            )}

            {result.call && (
              <div className="mt-3 rounded-2xl border border-gray-200 p-3.5">
                <p className="text-xs font-semibold text-gray-500">{result.call.when === 'later' ? 'Call, or make it now' : 'Call'}</p>
                <p className="font-medium text-gray-900 mt-0.5">{result.call.contact || formatNumber(result.call.to) || 'Who to call?'}</p>
                {result.call.goal && <p className="text-sm text-gray-500 mt-0.5">{result.call.goal}</p>}
                {!result.call.to && <p className="text-xs text-amber-700 mt-1">No number heard. You can add it on the next screen.</p>}
                <button onClick={() => onCall(callDraft(result))} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white font-semibold py-2.5">
                  <Phone size={16} />{result.call.mode === 'copilot' ? 'Set up my call' : `Have ${assistantName()} call ${result.call.when === 'later' ? 'now' : ''}`.trim()}
                </button>
              </div>
            )}

            {result.kind === 'unclear' && (
              <button onClick={begin} className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white font-semibold py-3 rounded-2xl"><RotateCcw size={16} />Say it again</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
