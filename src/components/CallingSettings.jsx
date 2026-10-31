import { useState } from 'react'
import { Phone, Loader2, CheckCircle2, LogOut } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import { connectCallPilot, disconnectCallPilot, normalizeServerUrl } from '../lib/callpilot'

/** Settings → Calling: connect the app to your CallPilot server. */
export default function CallingSettings() {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  const [url, setUrl] = useState(settings.callpilotUrl || '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const connected = settings.callpilotConnected && normalizeServerUrl(url) === settings.callpilotUrl

  const connect = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setOk('')
    try {
      const health = await connectCallPilot(url, passcode)
      setPasscode('')
      setOk(`Connected. Calls opens ${normalizeServerUrl(url)}.`)
      useCallStore.getState().disconnect()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = () => {
    disconnectCallPilot()
    useCallStore.getState().disconnect()
    setOk(''); setError('')
  }

  return (
    <div>
    <form onSubmit={connect} className="px-5 py-4 space-y-3">
      <p className="text-xs text-ink-2 flex gap-2">
        <Phone size={14} className="flex-shrink-0 mt-0.5 text-accent" />
        <span>Calls opens this CallPilot page inside the app, so updates to that page show up without a new install. Use its permanent cloud address, or the link your PC prints after <code className="font-mono">npm run go</code>.</span>
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://callpilot.onrender.com" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        className="w-full text-sm bg-surface-2 rounded-xl px-3 py-2.5 outline-none border border-line focus:border-primary" />
      <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" placeholder={connected ? 'Passcode saved' : 'Server passcode'} autoComplete="current-password"
        className="w-full text-sm bg-surface-2 rounded-xl px-3 py-2.5 outline-none border border-line focus:border-primary" />
      {error && <p className="text-xs text-danger bg-danger/10 rounded-xl px-3 py-2.5">{error}</p>}
      {(ok || connected) && !error && (
        <p className="text-xs text-success bg-success/10 rounded-xl px-3 py-2.5 flex gap-2"><CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />{ok || `Connected to ${settings.callpilotUrl}`}</p>
      )}
      <button type="submit" disabled={busy || !url.trim()} className="w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40">
        {busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Connecting… (a sleeping server takes up to a minute)' : connected ? 'Reconnect' : 'Connect'}
      </button>
      {settings.callpilotConnected && (
        <button type="button" onClick={disconnect} className="w-full border border-danger/30 text-danger text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2">
          <LogOut size={16} />Disconnect
        </button>
      )}
    </form>
    <div className="px-5 pb-4 space-y-3 border-t border-line">
      <p className="text-xs font-semibold text-ink-2 pt-4">About you</p>
      <p className="text-xs text-ink-2">Pilot uses this on every call. What you type on a single call is only for that call.</p>
      <label className="block">
        <span className="text-xs font-medium text-ink-2">Your name</span>
        <input
          value={settings.callerName ?? ''}
          onChange={(e) => updateSettings({ callerName: e.target.value })}
          placeholder={settings.userName || 'Your name'}
          maxLength={80}
          className="mt-1 w-full text-sm bg-surface-2 rounded-xl px-3 py-2.5 outline-none border border-line focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-ink-2">Always okay to use</span>
        <textarea
          value={settings.callerAbout ?? ''}
          onChange={(e) => updateSettings({ callerAbout: e.target.value })}
          rows={4}
          maxLength={4000}
          placeholder="Name you go by, city, account names, times that usually work. Leave out anything that changes from call to call."
          className="mt-1 w-full text-sm bg-surface-2 rounded-xl px-3 py-2.5 outline-none border border-line focus:border-primary resize-y"
        />
      </label>
    </div>
    </div>
  )
}
