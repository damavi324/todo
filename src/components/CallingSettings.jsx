import { useState } from 'react'
import { Phone, Loader2, CheckCircle2, LogOut } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import { connectCallPilot, disconnectCallPilot, normalizeServerUrl } from '../lib/callpilot'

/** Settings → Calling: connect the app to your CallPilot server. */
export default function CallingSettings() {
  const settings = useTaskStore((s) => s.settings)
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
      setOk(`Connected. Calls will be made for ${health.owner || 'you'}.`)
      const calls = useCallStore.getState()
      calls.disconnect()
      calls.connect()
      calls.loadHistory()
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
    <form onSubmit={connect} className="px-5 py-4 space-y-3">
      <p className="text-xs text-gray-500 flex gap-2">
        <Phone size={14} className="flex-shrink-0 mt-0.5 text-emerald-600" />
        <span>Calls, Pilot and the smart voice button run through your CallPilot server. Use its permanent cloud address, or the link your PC prints after <code className="font-mono">npm run go</code>.</span>
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://callpilot.onrender.com" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2.5 outline-none border border-gray-200 focus:border-primary" />
      <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" placeholder={connected ? 'Passcode saved' : 'Server passcode'} autoComplete="current-password"
        className="w-full text-sm bg-gray-50 rounded-xl px-3 py-2.5 outline-none border border-gray-200 focus:border-primary" />
      {error && <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2.5">{error}</p>}
      {(ok || connected) && !error && (
        <p className="text-xs text-green-700 bg-green-50 rounded-xl px-3 py-2.5 flex gap-2"><CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />{ok || `Connected to ${settings.callpilotUrl}`}</p>
      )}
      <button type="submit" disabled={busy || !url.trim()} className="w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-40">
        {busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Connecting… (a sleeping server takes up to a minute)' : connected ? 'Reconnect' : 'Connect'}
      </button>
      {settings.callpilotConnected && (
        <button type="button" onClick={disconnect} className="w-full border border-red-200 text-red-500 text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2">
          <LogOut size={16} />Disconnect
        </button>
      )}
    </form>
  )
}
