import { useState } from 'react'
import { Loader2, CheckCircle2, LogOut } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import { connectCallPilot, disconnectCallPilot, normalizeServerUrl } from '../lib/callpilot'
import { Button, Note, fieldClass } from './ui'

/** Settings → Calling: connect the app to your CallPilot server, and what the assistant knows about you. */
export default function CallingSettings() {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  const [url, setUrl] = useState(settings.callpilotUrl || '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connected = settings.callpilotConnected && normalizeServerUrl(url) === settings.callpilotUrl

  const connect = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectCallPilot(url, passcode)
      setPasscode('')
      useCallStore.getState().connect()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = () => {
    disconnectCallPilot()
    useCallStore.getState().disconnect()
    setError('')
  }

  return (
    <>
      <form onSubmit={connect} className="p-4 space-y-3">
        <div>
          <p className="text-sm text-ink">Calling server</p>
          <p className="text-xs text-ink-3 mt-0.5">Your CallPilot server’s address and passcode. The same connection works on all your devices.</p>
        </div>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://callpilot.onrender.com" inputMode="url"
          autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${fieldClass} w-full`} />
        <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" autoComplete="current-password"
          placeholder={connected ? 'Passcode saved' : 'Server passcode'} className={`${fieldClass} w-full`} />
        {error && <Note tone="danger">{error}</Note>}
        {connected && !error && (
          <p className="text-xs text-success flex items-center gap-1.5"><CheckCircle2 size={14} />Connected to {settings.callpilotUrl}</p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={busy || !url.trim()} className="flex-1">
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? 'Connecting… a sleeping server takes up to a minute' : connected ? 'Reconnect' : 'Connect'}
          </Button>
          {settings.callpilotConnected && (
            <Button size="sm" variant="ghost" onClick={disconnect}><LogOut size={15} />Disconnect</Button>
          )}
        </div>
      </form>
      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm text-ink">About you</p>
          <p className="text-xs text-ink-3 mt-0.5">The assistant uses this on every call. Details for one call go in that call.</p>
        </div>
        <input
          value={settings.callerName ?? ''}
          onChange={(e) => updateSettings({ callerName: e.target.value })}
          placeholder={settings.userName || 'Your name'}
          maxLength={80}
          aria-label="Your name"
          className={`${fieldClass} w-full`}
        />
        <textarea
          value={settings.callerAbout ?? ''}
          onChange={(e) => updateSettings({ callerAbout: e.target.value })}
          rows={4}
          maxLength={4000}
          aria-label="Always okay to share"
          placeholder="Always okay to share: the name you go by, your city, account names, times that usually work."
          className="w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface resize-y"
        />
      </div>
    </>
  )
}
