import { useEffect, useRef, useState } from 'react'
import { Play, Square, Loader2, Check } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { cp, apiUrl, ownerName, assistantName } from '../lib/callpilot'
import { ErrorNote, Segmented } from './ui'

const SERVICES = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'deepgram', label: 'Deepgram' },
]

const THINKING = [
  { value: 'smart', label: 'Smarter' },
  { value: 'fast', label: 'Faster' },
]

/**
 * Settings → Calling: how the assistant thinks on calls, and the voice it uses: hear each one and pick it.
 * Samples are recorded by the calling server at phone quality (like a real call), so the first play takes a few seconds.
 * ElevenLabs voices (the most natural) come from your ElevenLabs library once the server has an ElevenLabs key.
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
  const language = settings.callLanguage || 'en'
  // Older servers don't list languages: English only.
  const languages = list?.languages || []
  const nepali = languages.find((l) => l.id === 'ne')
  const stop = () => { audio.current?.pause(); setPlaying({ id: '', state: '' }) }
  const play = (id) => {
    if (playing.id === id) return stop()
    audio.current?.pause()
    const a = new Audio(apiUrl(`/api/voices/${id}/sample?owner=${encodeURIComponent(ownerName())}&assistant=${encodeURIComponent(assistantName())}`))
    audio.current = a
    setPlaying({ id, state: 'loading' })
    a.onplaying = () => setPlaying({ id, state: 'playing' })
    a.onended = () => setPlaying((p) => (p.id === id ? { id: '', state: '' } : p))
    a.onerror = () => {
      setPlaying({ id: '', state: '' })
      setError(id.startsWith('el-') ? 'Couldn’t play that voice. Check the ElevenLabs key on the server.' : 'Couldn’t play that voice. Check that the server has a working Deepgram key.')
    }
    a.play().catch(() => {})
  }
  const thinking = settings.callThinking || 'smart'
  // Older servers don't say which voices are ElevenLabs': all of them are Deepgram's.
  const byService = {
    elevenlabs: list?.voices.filter((v) => v.provider === 'elevenlabs') || [],
    deepgram: list?.voices.filter((v) => v.provider !== 'elevenlabs') || [],
  }
  // The voice service is whichever one the chosen voice belongs to; it applies from the next call, no restart.
  const service = chosen.startsWith('el-') ? 'elevenlabs' : 'deepgram'
  const [serviceNote, setServiceNote] = useState('')
  const chooseService = (next) => {
    setServiceNote('')
    if (next === service) return
    const voices = byService[next]
    if (!voices.length) {
      setServiceNote(next === 'elevenlabs'
        ? (list.elevenlabs?.ready ? 'Couldn’t load your ElevenLabs voices. Check the ElevenLabs key on the server, then reopen this page.' : 'Add your ElevenLabs key to the calling server (ELEVENLABS_API_KEY) to use ElevenLabs voices.')
        : 'No Deepgram voices are available.')
      return
    }
    updateSettings({ callVoice: (voices.find((v) => v.id === list.default) || voices[0]).id })
  }

  if (error && !list) return <div className="p-4"><ErrorNote tone="warn">{error}</ErrorNote></div>
  if (!list) return <p className="p-4 text-xs text-ink-3 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Loading voices…</p>
  return (
    <div className="p-4">
      {nepali && (
        <div className="mb-4">
          <p className="text-sm text-ink">Language on calls</p>
          <p className="text-xs text-ink-3 mt-0.5 mb-2">What the assistant speaks by default. You can change it for each call on the call screen.</p>
          <Segmented value={language} onChange={(v) => updateSettings({ callLanguage: v })}
            options={languages.map((l) => ({ value: l.id, label: l.label }))} />
          {language === 'ne' && !nepali.ready && <ErrorNote tone="warn" className="mt-2">{nepali.problem}</ErrorNote>}
          {language === 'ne' && nepali.ready && <p className="text-xs text-ink-3 mt-2">Nepali calls use the ElevenLabs voice set on the calling server. The voices below are for English calls.</p>}
        </div>
      )}
      {list.thinking && (
        <div className="mb-4">
          <p className="text-sm text-ink">How {assistantName()} thinks on calls</p>
          <p className="text-xs text-ink-3 mt-0.5 mb-2">
            {thinking === 'fast'
              ? 'Quicker replies, simpler judgment (Claude Haiku).'
              : 'Better judgment on tricky calls, a moment slower to reply (Claude Sonnet).'}
          </p>
          <Segmented value={thinking} onChange={(v) => updateSettings({ callThinking: v })} options={THINKING} />
          {thinking === 'smart' && !list.thinking.ready && (
            <ErrorNote tone="warn" className="mt-2">The calling server has no Anthropic key, so calls use the faster model.</ErrorNote>
          )}
        </div>
      )}
      {list.elevenlabs && (
        <div className="mb-4">
          <p className="text-sm text-ink">Voice service</p>
          <p className="text-xs text-ink-3 mt-0.5 mb-2">
            {service === 'elevenlabs'
              ? 'ElevenLabs: the most natural voices. If it ever fails mid-call, a Deepgram voice takes over.'
              : 'Deepgram: quick and clear, included in the calling price.'}
            {' '}Switching applies from your next call.
          </p>
          <Segmented value={service} onChange={chooseService} options={SERVICES} />
          {serviceNote && <ErrorNote tone="warn" className="mt-2">{serviceNote}</ErrorNote>}
        </div>
      )}
      <p className="text-sm text-ink">Assistant’s voice on calls</p>
      <p className="text-xs text-ink-3 mt-0.5 mb-2">Play a sample, then pick one. It sounds like a phone line, because that’s how the other person hears it.</p>
      {error && <ErrorNote tone="warn" className="mb-2">{error}</ErrorNote>}
      <VoiceList voices={list.elevenlabs ? byService[service] : list.voices} chosen={chosen} defaultId={list.default} playing={playing} play={play}
        choose={(id) => updateSettings({ callVoice: id })} />
    </div>
  )
}

function VoiceList({ voices, chosen, defaultId, playing, play, choose }) {
  return (
    <ul className="rounded-xl border border-line divide-y divide-line overflow-hidden">
      {voices.map((v) => {
        const [name, ...rest] = v.label.replace(/^Flux /, '').split(', ')
        const isChosen = chosen === v.id
        const p = playing.id === v.id ? playing.state : ''
        return (
          <li key={v.id} className={`flex items-center gap-2 pl-2 pr-3 py-1.5 ${isChosen ? 'bg-accent/5' : ''}`}>
            <button type="button" onClick={() => play(v.id)} aria-label={p ? `Stop ${name}` : `Play ${name}`}
              className="w-10 h-10 rounded-full flex items-center justify-center text-accent hover:bg-accent/10 flex-shrink-0">
              {p === 'loading' ? <Loader2 size={17} className="animate-spin" /> : p === 'playing' ? <Square size={15} /> : <Play size={17} />}
            </button>
            <button type="button" onClick={() => choose(v.id)} aria-pressed={isChosen}
              className="flex-1 min-w-0 flex items-center gap-2 text-left py-1.5">
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink">{name}{v.id === defaultId && <span className="text-xs text-ink-3"> · default</span>}</span>
                {rest.length > 0 && <span className="block text-xs text-ink-3 truncate">{rest.join(', ')}</span>}
              </span>
              {isChosen && <Check size={17} className="text-accent flex-shrink-0" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
