import { useState } from 'react'
import { Loader2, CheckCircle2, LogOut, History, X, Play } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore } from '../store/useCallStore'
import { connectCallPilot, disconnectCallPilot, normalizeServerUrl, assistantName } from '../lib/callpilot'
import { speakOut } from '../lib/voiceChat'
import { Button, ErrorNote, IconButton, Section, Switch, fieldClass } from './ui'
import CallVoicePicker from './CallVoicePicker'
import CallerIdPicker from './CallerIdPicker'

// Calling servers this device has connected to, newest first. Addresses only (never the passcode), and only on
// this device, so a forgotten address is one tap away after a sign-in or a reinstall of the server.
const RECENT_KEY = 'callpilotRecentServers'
const MAX_RECENT = 6
function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY))
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string') : []
  } catch { return [] }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* storage blocked; the list just isn't kept */ }
  return list
}

/**
 * Settings → Calling: which number and voice calls use, and the connection to your CallPilot server
 * (folded away once connected, since it's set once).
 */
export default function CallingSettings({ onOpenProfile }) {
  const settings = useTaskStore((s) => s.settings)
  const updateSettings = useTaskStore((s) => s.updateSettings)
  // Not connected (say, after signing in on a new device): start from the server used last.
  const [url, setUrl] = useState(() => settings.callpilotUrl || readRecent()[0] || '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(!settings.callpilotConnected)
  // The server already connected counts too, so it's on the list before the next reconnect.
  const [recent, setRecent] = useState(() => {
    const list = readRecent()
    const current = settings.callpilotConnected && settings.callpilotUrl
    return current && !list.includes(current) ? writeRecent([current, ...list].slice(0, MAX_RECENT)) : list
  })
  const forget = (u) => setRecent(writeRecent(recent.filter((x) => x !== u)))
  const others = recent.filter((u) => u !== normalizeServerUrl(url))
  const connected = settings.callpilotConnected && normalizeServerUrl(url) === settings.callpilotUrl

  const connect = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectCallPilot(url, passcode)
      const saved = normalizeServerUrl(url)
      setRecent(writeRecent([saved, ...readRecent().filter((u) => u !== saved)].slice(0, MAX_RECENT)))
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
          <div className="flex items-center justify-between gap-3 px-4 py-3 min-h-[56px]">
            <div className="min-w-0">
              <p className="text-sm text-ink">Talk back in voice mode</p>
              <p className="text-xs text-ink-3 mt-0.5">When you ask by voice, {assistantName()} speaks in a natural voice and you can answer out loud. About 2¢ for a short back-and-forth. Off: voice mode stays quiet.</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {settings.voiceTalkBack !== false && (
                <IconButton label="Hear the voice" onClick={() => speakOut(`Hi, it’s ${assistantName()}. Who should I call?`)}><Play size={16} /></IconButton>
              )}
              <Switch label="Talk back in voice mode" checked={settings.voiceTalkBack !== false} onChange={(on) => updateSettings({ voiceTalkBack: on })} />
            </div>
          </div>
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
            {others.length > 0 && (
              <div>
                <p className="text-xs text-ink-3 mb-1 flex items-center gap-1"><History size={12} />Used before on this device</p>
                <ul className="rounded-lg border border-line divide-y divide-line overflow-hidden">
                  {others.map((u) => (
                    <li key={u} className="flex items-center">
                      <button type="button" onClick={() => setUrl(u)}
                        className="flex-1 min-w-0 px-3 py-2 text-left text-[13px] text-ink truncate hover:bg-surface-2">
                        {u.replace(/^https:\/\//, '')}
                      </button>
                      <IconButton label={`Forget ${u}`} onClick={() => forget(u)} className="w-8 h-8 mr-0.5 flex-shrink-0 hover:text-danger">
                        <X size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
