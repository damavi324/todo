import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Sheet, Segmented, IconButton } from './ui'
import { useCallStore } from '../store/useCallStore'
import { cp, formatNumber } from '../lib/callpilot'
import { usageTotals, claudeCost, addTokens, CLAUDE_PRICES } from '../lib/usage'

const money = (n, currency = 'USD') =>
  Number.isFinite(n) ? new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n) : '—'
const mins = (secs) => `${Math.round((secs || 0) / 6) / 10} min`
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n || 0))

/**
 * Where the money goes: live balances from Twilio and Deepgram, and the Claude tokens this app counted
 * (Anthropic has no balance API for a regular key, so that one is an estimate at list price).
 */
export default function UsagePanel({ onClose }) {
  const history = useCallStore((s) => s.history)
  const [range, setRange] = useState('month')
  const [accounts, setAccounts] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchAccounts = () =>
    cp('/api/usage', undefined, { timeoutMs: 30000 })
      .then(setAccounts, (e) => setAccounts({ error: e.message }))
      .finally(() => setLoading(false))
  const load = () => { setLoading(true); fetchAccounts() }
  useEffect(() => { fetchAccounts() }, [])

  const t = usageTotals(history, { month: range === 'month' })
  const allTokens = addTokens(addTokens({}, t.callTokens), t.otherTokens)
  const claude = claudeCost(allTokens)
  const recent = history.filter((c) => c.usage && (c.usage.seconds || Object.keys(c.usage.claude || {}).length)).slice(0, 30)

  return (
    <Sheet title="Usage & credits" onClose={onClose}>
      <div className="p-5 space-y-6">
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Account balances</h3>
            <IconButton label="Refresh balances" onClick={load} className={`-mr-2 ${loading ? 'animate-spin' : ''}`}><RefreshCw size={15} /></IconButton>
          </div>
          {accounts?.error && (
            <p className="text-xs text-warn mb-2">Couldn’t get balances from the calling server ({accounts.error}). If it says “Not found”, the server needs the latest update.</p>
          )}
            <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-3 gap-2">
              <Balance name="Twilio" hint="Phone line, per minute of each call" data={accounts?.error ? { error: 'Not available' } : accounts?.twilio} loading={loading && !accounts}
                extra={accounts?.twilio?.spentThisMonth != null && `${money(accounts.twilio.spentThisMonth, accounts.twilio.currency)} spent this month`}
                link="https://console.twilio.com/us1/billing/manage-billing/billing-overview" />
              <Balance name="Deepgram" hint="Voice: listening and speaking, per minute" data={accounts?.error ? { error: 'Not available' } : accounts?.deepgram} loading={loading && !accounts}
                link="https://console.deepgram.com/billing" />
              <div className="rounded-xl bg-surface-2 px-4 py-3">
                <p className="text-sm font-medium text-ink">Claude</p>
                <p className="text-xs text-ink-3">Plans, live tips, notes, per token</p>
                <p className="text-lg font-semibold text-ink mt-1 tabular-nums">≈ {money(claude)}</p>
                <p className="text-xs text-ink-3">{range === 'month' ? 'this month' : 'all time'}, counted by this app</p>
                <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent mt-1">Credit balance<ExternalLink size={11} /></a>
              </div>
            </div>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">What you used</h3>
            <div className="w-48"><Segmented size="sm" value={range} onChange={setRange} options={[{ value: 'month', label: 'This month' }, { value: 'all', label: 'All time' }]} /></div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Calls" value={t.calls} />
            <Stat label="Assistant call time" value={mins(t.agentSeconds)} />
            <Stat label="Your call time" value={mins(t.talkSeconds)} />
            <Stat label="Voice assistant requests" value={t.assistantRequests} />
          </dl>
          <div className="mt-3 rounded-xl border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-ink-3">
                <tr><th className="text-left font-medium px-3 py-2">Claude model</th><th className="text-right font-medium px-3 py-2">In</th><th className="text-right font-medium px-3 py-2">Out</th><th className="text-right font-medium px-3 py-2">Cost</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {Object.entries(allTokens).map(([model, x]) => (
                  <tr key={model}>
                    <td className="px-3 py-2 text-ink truncate max-w-[9rem]">{model.replace('claude-', '')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{tokens(x.in)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{tokens(x.out)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{CLAUDE_PRICES[model] ? money(claudeCost({ [model]: x })) : '—'}</td>
                  </tr>
                ))}
                {!Object.keys(allTokens).length && <tr><td colSpan={4} className="px-3 py-3 text-ink-3">No Claude use counted yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-3 mt-2 leading-relaxed">
            Claude costs are estimates at list price. While the assistant is on a call, its thinking runs inside Deepgram and is billed there, not here.
            Calls made before this update have no usage recorded.
          </p>
        </section>

        {recent.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3 mb-2">Per call</h3>
            <ul className="rounded-xl border border-line divide-y divide-line text-[13px]">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 min-w-0 truncate text-ink">{c.headline || c.goal || formatNumber(c.to)}</span>
                  <span className="tabular-nums text-ink-3">{mins(c.usage.seconds)}</span>
                  <span className="tabular-nums text-ink w-14 text-right">{money(claudeCost(c.usage.claude))}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}

function Balance({ name, hint, data, loading, extra, link }) {
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <p className="text-sm font-medium text-ink">{name}</p>
      <p className="text-xs text-ink-3">{hint}</p>
      <p className="text-lg font-semibold text-ink mt-1 tabular-nums">{loading ? '…' : data?.error ? '—' : money(data?.balance, data?.currency)}</p>
      <p className="text-xs text-ink-3">{data?.error ? data.error : extra || 'balance left'}</p>
      <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent mt-1">Billing<ExternalLink size={11} /></a>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-base font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  )
}
