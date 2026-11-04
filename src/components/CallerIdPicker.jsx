import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { formatNumber, rememberCallerId } from '../lib/callpilot'
import { ErrorNote, fieldClass } from './ui'

// The server's numbers, kept between screens so the call form can show its picker without waiting.
let lastList = null

/**
 * Which number calls show as coming from: a list in Settings → Calling, and a `compact` dropdown on the call form
 * and plan. The numbers themselves are set on the calling server (your verified caller ID and your Twilio number);
 * the choice applies to the next call, no redeploy.
 */
export default function CallerIdPicker({ compact = false }) {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  const [list, setList] = useState(lastList)
  const [error, setError] = useState('')

  useEffect(() => {
    rememberCallerId()
      .then((l) => { lastList = l; setList(l) },
        (e) => setError(e.status === 404 ? 'Your calling server needs the latest update to pick a caller ID.' : e.message))
  }, [])

  if (compact) {
    // One number (or none known yet): just say which one they'll see.
    if (!list || list.numbers.length < 2) {
      return settings.callFromNumber
        ? <p className="text-xs text-ink-3 mt-1">The other person sees {formatNumber(settings.callFromNumber)}</p>
        : null
    }
    const current = list.numbers.some((n) => n.key === settings.callFrom) ? settings.callFrom : list.default
    return (
      <label className="flex items-center justify-between gap-3 mt-2">
        <span className="text-xs text-ink-3 flex-shrink-0">Call from</span>
        <select value={current} aria-label="Call from"
          onChange={(e) => {
            const n = list.numbers.find((x) => x.key === e.target.value)
            if (n) updateSettings({ callFrom: n.key, callFromNumber: n.number })
          }}
          className={`${fieldClass} h-8 min-w-0 text-[13px]`}>
          {list.numbers.map((n) => <option key={n.key} value={n.key}>{n.label} · {formatNumber(n.number)}</option>)}
        </select>
      </label>
    )
  }

  if (error) return <div className="p-4"><ErrorNote tone="warn">{error}</ErrorNote></div>
  if (!list) return <p className="p-4 text-xs text-ink-3 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />Loading numbers…</p>
  if (list.numbers.length < 2) return null
  const chosen = list.numbers.some((n) => n.key === settings.callFrom) ? settings.callFrom : list.default
  const choose = (n) => updateSettings({ callFrom: n.key, callFromNumber: n.number })
  return (
    <div className="p-4">
      <p className="text-sm text-ink">Calls come from</p>
      <p className="text-xs text-ink-3 mt-0.5 mb-2">The number the other person sees. Changes apply to your next call.</p>
      <ul className="rounded-xl border border-line divide-y divide-line overflow-hidden">
        {list.numbers.map((n) => {
          const isChosen = chosen === n.key
          return (
            <li key={n.key}>
              <button type="button" onClick={() => choose(n)} aria-pressed={isChosen}
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
