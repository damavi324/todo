// Voice mode, out loud: what the app says is spoken in a natural voice from the calling server (never the
// phone's robotic one), and when something needs you it asks out loud and you answer out loud, a few turns at
// most, with Claude working out what you meant. Nothing plays when the server can't be reached.
import { create } from 'zustand'
import { cp, cpSettings, isCallPilotReady, callerContext } from './callpilot'
import { listenUntilPause } from './dictation'
import { recordOtherUsage } from './usage'
import { useTaskStore } from '../store/useTaskStore'

/** What the sheet on screen shows while a conversation is going on. */
export const useVoiceChat = create(() => ({
  open: false,
  phase: 'idle', // speaking | listening | thinking | idle
  topic: '',
  turns: [], // { role: 'assistant' | 'user', text }
  heard: '', // your words so far, while you're talking
  // You're in a spoken conversation: a problem with the call is talked through too, not only shown.
  live: false,
  request: '', // a new request you made out loud, for the assistant to act on (App opens it)
}))

const set = (patch) => useVoiceChat.setState(patch)

/** Whether the app may talk: Settings allows it and the calling server is set up. */
export const canTalk = () => isCallPilotReady() && useTaskStore.getState().settings.voiceTalkBack !== false

let player = null
let finishSpeaking = null
let listener = null
let cancelled = false

function stopSpeaking() {
  try { player?.pause() } catch { /* gone */ }
  player = null
  finishSpeaking?.()
  finishSpeaking = null
}

/** Says `text` in the server's voice and resolves once it's done (or couldn't play). */
export async function speakOut(text) {
  const line = String(text || '').trim()
  if (!line || !canTalk()) return
  stopSpeaking()
  const { url, token } = cpSettings()
  let blob
  try {
    const res = await fetch(`${url}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text: line }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`speak ${res.status}`)
    blob = await res.blob()
  } catch (err) {
    console.warn('Could not speak:', err.message)
    return
  }
  const src = URL.createObjectURL(blob)
  const audio = new Audio(src)
  player = audio
  await new Promise((resolve) => {
    finishSpeaking = resolve
    audio.onended = resolve
    audio.onerror = resolve
    audio.play().catch(resolve)
  })
  if (player === audio) player = null
  URL.revokeObjectURL(src)
}

/** Stops whatever is being said or heard, and closes the sheet. */
export function cancelConversation() {
  cancelled = true
  stopSpeaking()
  listener?.cancel()
  listener = null
  set({ open: false, phase: 'idle', heard: '' })
}

/** A message as a spoken sentence: ends with a full stop, so the next sentence doesn't run into it. */
export const sentence = (text) => { const t = String(text || '').trim(); return !t || /[.!?…]$/.test(t) ? t : `${t}.` }

/** You're done talking: send what you've said now instead of waiting for a pause. */
export function doneTalking() {
  listener?.stop()
}

/** Hands a new request you said out loud to the assistant, as if you'd just asked it. */
export function askAssistant(text) {
  set({ request: String(text || '').trim() })
}

/** The spoken conversation is over for this request (a call finished, or the flow was left). */
export function endTalk() {
  set({ live: false })
}

const localNow = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return { now: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`, weekday: d.toLocaleDateString('en-US', { weekday: 'long' }) }
}

/**
 * Talks something through out loud. `topic` is unclear | question | problem (see server/src/talk.js), `opening`
 * is the first thing said. Resolves with { outcome, text }: outcome is request | answer | retry | stop, or
 * 'none' when you said nothing, it was cancelled, or the server couldn't help.
 */
export async function converse({ topic, opening, context = {}, maxTurns = 4 }) {
  if (!canTalk()) return { outcome: 'none' }
  cancelConversation()
  cancelled = false
  const turns = [{ role: 'assistant', text: opening }]
  set({ open: true, live: true, topic, turns: [...turns], phase: 'speaking', heard: '' })
  const end = (result) => {
    if (!cancelled) set({ open: false, phase: 'idle', heard: '' })
    if (result.outcome === 'stop') endTalk()
    return result
  }
  await speakOut(opening)
  for (let turn = 0; turn < maxTurns; turn++) {
    if (cancelled) return { outcome: 'none' }
    set({ phase: 'listening', heard: '' })
    let heard = ''
    try {
      listener = await listenUntilPause({ pauseMs: 1800, noSpeechMs: 9000, maxMs: 45000, onText: (t) => set({ heard: t }) })
      heard = (await listener.done || '').trim()
    } catch (err) {
      console.warn('Could not listen:', err.message)
    }
    listener = null
    if (cancelled) return { outcome: 'none' }
    if (!heard) return end({ outcome: 'none' })
    turns.push({ role: 'user', text: heard })
    set({ turns: [...turns], phase: 'thinking', heard: '' })
    let r
    try {
      const res = await cp('/api/talk', { topic, context, turns, ...callerContext(), ...localNow() }, { timeoutMs: 20000 })
      recordOtherUsage('talk', res.usage)
      r = res.result
    } catch (err) {
      console.warn('Talk failed:', err.message)
      return end({ outcome: 'none' })
    }
    if (cancelled) return { outcome: 'none' }
    if (r.reply) {
      turns.push({ role: 'assistant', text: r.reply })
      set({ turns: [...turns], phase: 'speaking' })
      await speakOut(r.reply)
    }
    if (r.outcome !== 'continue') return end({ outcome: r.outcome, text: r.text })
  }
  return end({ outcome: 'none' })
}
