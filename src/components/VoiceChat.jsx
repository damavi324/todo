import { Loader2, Mic, Volume2, X } from 'lucide-react'
import { useVoiceChat, cancelConversation, doneTalking } from '../lib/voiceChat'
import { assistantName } from '../lib/callpilot'

const PHASE = { speaking: 'Speaking…', listening: 'Listening…', thinking: 'Thinking…' }

/** The spoken conversation on screen: what was said both ways, and whose turn it is. */
export default function VoiceChat() {
  const { open, phase, turns, heard } = useVoiceChat()
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={`Talking with ${assistantName()}`}
      className="fixed inset-0 z-[75] bg-black/30 flex items-end md:items-center md:justify-center fade-in">
      <div className="w-full md:w-[440px] bg-surface rounded-t-2xl md:rounded-2xl shadow-pop px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:pb-6 max-h-[75dvh] flex flex-col slide-up md:fade-in">
        <div className="flex items-center gap-3">
          {phase === 'listening'
            ? <span className="relative flex w-3 h-3"><span className="absolute inline-flex h-full w-full rounded-full bg-danger opacity-75 animate-ping" /><span className="relative inline-flex rounded-full w-3 h-3 bg-danger" /></span>
            : phase === 'thinking' ? <Loader2 size={16} className="animate-spin text-primary" /> : <Volume2 size={16} className="text-accent" />}
          <p className="flex-1 font-semibold text-ink">{PHASE[phase] || assistantName()}</p>
          <button onClick={cancelConversation} aria-label="Stop talking" className="w-9 h-9 -mr-2 rounded-lg flex items-center justify-center text-ink-3 hover:bg-surface-2"><X size={17} /></button>
        </div>
        <div className="mt-3 space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <p key={i} className={`text-[15px] leading-snug rounded-xl px-3.5 py-2.5 ${t.role === 'user' ? 'bg-primary/10 text-ink ml-8' : 'bg-surface-2 text-ink mr-8'}`}>{t.text}</p>
          ))}
          {phase === 'listening' && heard && <p className="text-[15px] leading-snug rounded-xl px-3.5 py-2.5 bg-primary/5 text-ink-2 ml-8">{heard}</p>}
        </div>
        {phase === 'listening' && (
          <button type="button" onClick={doneTalking} className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white font-medium h-11 rounded-lg"><Mic size={16} />Done talking</button>
        )}
      </div>
    </div>
  )
}
