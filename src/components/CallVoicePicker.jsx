import { useEffect, useRef, useState } from 'react'
import { Play, Square, Loader2, Check } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { cp, apiUrl, ownerName, assistantName } from '../lib/callpilot'
import { Note } from './ui'

/**
 * Settings → Calling: hear each voice the assistant can use on calls and pick one. Samples are recorded by the
 * calling server through Deepgram (phone quality, like a real call), so the first play of each takes a few seconds.
 */
export default function CallVoicePicker() {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState({ id: '', state: '' }) // state: loading | playing
  const audio = useRef(null)

  useEffect(() => {
    cp('/api/voices', undefined, { timeoutMs: 30000 })
      .then(setList, (e) => setError(e.message.includes('404') || e.status === 404 ? 'Your calling server needs the latest update to list voices.' : e.message))
    return () => audio.current?.pause()
  }, [])

  const chosen = settings.callVoice || list?.default || ''
  const stop = () => { audio.current?.pause(); setPlaying({ id: '', state: '' }) }
  const play = (id) => {
    if (playing.id === id) return stop()
    audio.current?.pause()
    const a = new Audio(apiUrl(`/api/voices/${id}/sample?owner=${encodeURIComponent(ownerName())}&assistant=${encodeURIComponent(assistantName())}`))
    audio.current = a
    setPlaying({ id, state: 'loading' })
    a.onplaying = () => setPlaying({ id, state: 'playing' })
    a.onended = () => setPlaying((p) => (p.id === id ? { id: '', state: '' } : p))
    a.onerror = () => { setPlaying({ id: '', state: '' }); setError('Couldn’t play that voice. Check that the server has a working Deepgram key.') }
    a.play().catch(() => {})
  }

  if (error && !list) return <div className="px-4 pb-4"><Note tone="warn">{error}</Note></div>
  if (!list) return <p className="px-4 pb-4 text-xs text-ink-3 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Loading voices…</p>
  return (
    <div className="px-4 pb-4">
      <p className="text-sm text-ink">Assistant’s voice on calls</p>
      <p className="text-xs text-ink-3 mt-0.5 mb-2">Play a sample, then pick one. It sounds like a phone line, because that’s how the other person hears it.</p>
      {error && <Note tone="warn" className="mb-2">{error}</Note>}
      <ul className="rounded-xl border border-line divide-y divide-line overflow-hidden">
        {list.voices.map((v) => {
          const [name, ...rest] = v.label.replace(/^Flux /, '').split(', ')
          const isChosen = chosen === v.id
          const p = playing.id === v.id ? playing.state : ''
          return (
            <li key={v.id} className={`flex items-center gap-2 pl-2 pr-3 py-1.5 ${isChosen ? 'bg-accent/5' : ''}`}>
              <button type="button" onClick={() => play(v.id)} aria-label={p ? `Stop ${name}` : `Play ${name}`}
                className="w-10 h-10 rounded-full flex items-center justify-center text-accent hover:bg-accent/10 flex-shrink-0">
                {p === 'loading' ? <Loader2 size={17} className="animate-spin" /> : p === 'playing' ? <Square size={15} /> : <Play size={17} />}
              </button>
              <button type="button" onClick={() => updateSettings({ callVoice: v.id })} aria-pressed={isChosen}
                className="flex-1 min-w-0 flex items-center gap-2 text-left py-1.5">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink">{name}{v.id === list.default && <span className="text-xs text-ink-3"> · default</span>}</span>
                  {rest.length > 0 && <span className="block text-xs text-ink-3 truncate">{rest.join(', ')}</span>}
                </span>
                {isChosen && <Check size={17} className="text-accent flex-shrink-0" />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
