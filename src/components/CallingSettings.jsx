import { useState } from 'react'
import { Loader2, CheckCircle2, LogOut } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import { connectCallPilot, disconnectCallPilot, normalizeServerUrl } from '../lib/callpilot'
import { Button, ErrorNote, Section, fieldClass } from './ui'
import CallVoicePicker from './CallVoicePicker'
import CallerIdPicker from './CallerIdPicker'

/**
 * Settings → Calling: which number and voice calls use, and the connection to your CallPilot server
 * (folded away once connected, since it's set once).
 */
export default function CallingSettings({ onOpenProfile }) {
  const settings = useTaskStore((s) => s.settings)
  const [url, setUrl] = useState(settings.callpilotUrl || '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(!settings.callpilotConnected)
  const connected = settings.callpilotConnected && normalizeServerUrl(url) === settings.callpilotUrl

  const connect = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectCallPilot(url, passcode)
      setPasscode('')
      useCallStore.getState().connect()
      setEditing(false)
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
    setEditing(true)
  }

  return (
    <>
      {settings.callpilotConnected && (
        <Section title="On your calls">
          <CallerIdPicker />
          <CallVoicePicker />
        </Section>
      )}
      <Section title="Calling server">
        {!editing && settings.callpilotConnected ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 min-h-[56px]">
            <p className="min-w-0 text-xs text-success flex items-center gap-1.5">
              <CheckCircle2 size={14} className="flex-shrink-0" /><span className="truncate">Connected to {settings.callpilotUrl}</span>
            </p>
            <Button size="sm" onClick={() => setEditing(true)}>Change</Button>
          </div>
        ) : (
          <form onSubmit={connect} className="p-4 space-y-3">
            <p className="text-xs text-ink-3">Your CallPilot server’s address and passcode. The same connection works on all your devices.</p>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://callpilot-….run.app" inputMode="url"
              autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${fieldClass} w-full`} />
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" autoComplete="current-password"
              placeholder={connected ? 'Passcode saved' : 'Server passcode'} className={`${fieldClass} w-full`} />
            {error && <ErrorNote>{error}</ErrorNote>}
            {busy && <p className="text-xs text-ink-3">A sleeping server takes up to a minute to wake.</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={busy || !url.trim()} className="flex-1">
                {busy && <Loader2 size={15} className="animate-spin" />}
                {busy ? 'Connecting…' : connected ? 'Reconnect' : 'Connect'}
              </Button>
              {settings.callpilotConnected && (
                <Button size="sm" variant="ghost" onClick={disconnect}><LogOut size={15} />Disconnect</Button>
              )}
            </div>
          </form>
        )}
      </Section>
      <p className="px-1 text-xs text-ink-3">
        The assistant calls on behalf of the name and details in your{' '}
        <button type="button" onClick={onOpenProfile} className="text-accent hover:underline">profile</button>.
      </p>
    </>
  )
}
