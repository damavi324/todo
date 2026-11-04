import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { cp, formatNumber } from '../lib/callpilot'
import { Note } from './ui'

/**
 * Settings → Calling: which number calls show as coming from. The numbers themselves are set on the calling
 * server (your verified caller ID and your Twilio number); the choice here applies to the next call, no redeploy.
 */
export default function CallerIdPicker() {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  const [list, setList] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    cp('/api/caller-ids', undefined, { timeoutMs: 30000 })
      .then(setList, (e) => setError(e.status === 404 ? 'Your calling server needs the latest update to pick a caller ID.' : e.message))
  }, [])

  if (error) return <div className="px-4 pb-4"><Note tone="warn">{error}</Note></div>
  if (!list) return <p className="px-4 pb-4 text-xs text-ink-3 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Loading numbers…</p>
  if (list.numbers.length < 2) return null
  const chosen = list.numbers.some((n) => n.key === settings.callFrom) ? settings.callFrom : list.default
  return (
    <div className="px-4 pb-4">
      <p className="text-sm text-ink">Calls come from</p>
      <p className="text-xs text-ink-3 mt-0.5 mb-2">The number the other person sees. Changes apply to your next call.</p>
      <ul className="rounded-xl border border-line divide-y divide-line overflow-hidden">
        {list.numbers.map((n) => {
          const isChosen = chosen === n.key
          return (
            <li key={n.key}>
              <button type="button" onClick={() => updateSettings({ callFrom: n.key })} aria-pressed={isChosen}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left ${isChosen ? 'bg-accent/5' : ''}`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink">{n.label}{n.key === list.default && <span className="text-xs text-ink-3"> · default</span>}</span>
                  <span className="block text-xs text-ink-3">{formatNumber(n.number)}</span>
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
