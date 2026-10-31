// Live speech-to-text: microphone -> CallPilot server -> Deepgram, text streams back as you talk.
import { Capacitor } from '@capacitor/core'
import SpeechCapture from '../plugins/SpeechCapture'
import { socketUrl } from './callpilot'

const WORKLET = `class P extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i){const c=i[0]&&i[0][0];if(c){const o=new Int16Array(c.length);for(let k=0;k<c.length;k++){const v=Math.max(-1,Math.min(1,c[k]));o[k]=v<0?v*32768:v*32767}this.b.push(o);this.n+=o.length;if(this.n>=2048){const a=new Int16Array(this.n);let p=0;for(const x of this.b){a.set(x,p);p+=x.length}this.port.postMessage(a.buffer,[a.buffer]);this.b=[];this.n=0}}return true}}registerProcessor('pcm16',P);`

export async function ensureMicPermission() {
  if (Capacitor.isNativePlatform()) {
    const status = await SpeechCapture.requestPermissions()
    if (status?.microphone !== 'granted') throw new Error('Allow microphone access for this app in Android settings.')
  }
}

/**
 * Starts dictation. onText(fullText, { final }) fires as words arrive.
 * Returns { stop(): Promise<string> } which resolves with the final text.
 */
export async function startDictation({ onText, onError } = {}) {
  await ensureMicPermission()
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device cannot use the microphone here.')
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  } catch {
    throw new Error('Microphone is blocked. Allow it for this app and try again.')
  }
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  const ws = new WebSocket(socketUrl(`/dictate?rate=${ctx.sampleRate}`))
  ws.binaryType = 'arraybuffer'
  let committed = ''
  let interim = ''
  let src = null
  let node = null
  let stopped = false
  let lastFinalAt = Date.now()

  const full = () => [committed, interim].filter(Boolean).join(' ')
  ws.onmessage = (e) => {
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.type === 'interim') {
      interim = m.text || ''
      onText?.(full(), { final: false })
    } else if (m.type === 'final') {
      if (m.text) committed = [committed, m.text].filter(Boolean).join(' ')
      interim = ''
      lastFinalAt = Date.now()
      onText?.(full(), { final: true })
    } else if (m.type === 'error') {
      onError?.(new Error(m.message || 'Transcription failed'))
    }
  }
  ws.onerror = () => { if (!stopped) onError?.(new Error('Lost the connection to the calling server.')) }

  const send = (buf) => { if (ws.readyState === 1) ws.send(buf) }
  src = ctx.createMediaStreamSource(stream)
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    node = new AudioWorkletNode(ctx, 'pcm16')
    node.port.onmessage = (e) => send(e.data)
    src.connect(node)
  } catch {
    node = ctx.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) => {
      const c = e.inputBuffer.getChannelData(0)
      const o = new Int16Array(c.length)
      for (let k = 0; k < c.length; k++) { const v = Math.max(-1, Math.min(1, c[k])); o[k] = v < 0 ? v * 32768 : v * 32767 }
      send(o.buffer)
    }
    src.connect(node)
    node.connect(ctx.destination)
  }

  const release = () => {
    try { src?.disconnect(); node?.disconnect() } catch { /* already gone */ }
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => {})
  }

  return {
    async stop() {
      if (stopped) return full()
      stopped = true
      release()
      // Wait briefly for the last words, then close.
      const started = Date.now()
      while (interim && Date.now() - started < 1800) await new Promise((r) => setTimeout(r, 100))
      if (Date.now() - lastFinalAt < 300) await new Promise((r) => setTimeout(r, 200))
      try { ws.close() } catch { /* closed */ }
      const text = full()
      interim = ''
      return text
    },
    cancel() {
      stopped = true
      release()
      try { ws.close() } catch { /* closed */ }
    },
  }
}
