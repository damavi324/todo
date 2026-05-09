import { useState, useEffect } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { loadGoogleApis, signIn, signOut, isSignedIn } from '../lib/googleCalendar'
import { X, Bell, Calendar, ChevronRight, LogOut, LogIn } from 'lucide-react'

export default function Settings({ onClose }) {
  const { settings, updateSettings } = useTaskStore()
  const [gcalSignedIn, setGcalSignedIn] = useState(isSignedIn())
  const [gApiReady, setGApiReady] = useState(false)
  const [clientIdInput, setClientIdInput] = useState(settings.googleClientId)

  useEffect(() => {
    if (settings.googleClientId) {
      loadGoogleApis(settings.googleClientId, () => setGApiReady(true))
    }
  }, [settings.googleClientId])

  const handleLoadApi = () => {
    const id = clientIdInput.trim()
    if (!id) return
    updateSettings({ googleClientId: id })
    loadGoogleApis(id, () => setGApiReady(true))
  }

  const handleSignIn = async () => {
    try {
      await signIn()
      updateSettings({ googleCalendarEnabled: true })
      setGcalSignedIn(true)
    } catch {}
  }

  const handleSignOut = () => {
    signOut()
    updateSettings({ googleCalendarEnabled: false })
    setGcalSignedIn(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 border-b border-gray-100">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
          <X size={20} className="text-gray-600" />
        </button>
        <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Notifications">
          <Row label="Notification Style">
            <select
              value={settings.notificationStyle}
              onChange={(e) => updateSettings({ notificationStyle: e.target.value })}
              className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none">
              <option value="sticky">Sticky (stays until dismissed)</option>
              <option value="normal">Normal (auto-dismiss)</option>
            </select>
          </Row>
          {settings.notificationStyle === 'sticky' && (
            <Row label="Re-alert every">
              <select
                value={settings.notificationRepeatMinutes}
                onChange={(e) => updateSettings({ notificationRepeatMinutes: Number(e.target.value) })}
                className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none">
                <option value={0}>Never</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </Row>
          )}
          <p className="text-xs text-gray-400 px-5 pb-3">
            Sticky notifications stay visible on your Android until you manually dismiss them.
            Dismissing a notification does <strong>not</strong> mark the task as done.
          </p>
        </Section>

        <Section title="Google Calendar">
          {!gcalSignedIn ? (
            <div className="px-5 pb-4 space-y-3">
              <p className="text-xs text-gray-500">
                Enter your Google OAuth Client ID to connect Google Calendar.
                You can get this from <span className="text-primary font-medium">console.cloud.google.com</span> → Credentials → OAuth 2.0.
              </p>
              <input
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="Paste your Client ID here"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 outline-none focus:border-primary"
              />
              <button onClick={handleLoadApi} disabled={!clientIdInput.trim()}
                className="w-full bg-gray-800 text-white text-sm font-medium py-2.5 rounded-xl disabled:opacity-40">
                Load API
              </button>
              {gApiReady && (
                <button onClick={handleSignIn}
                  className="w-full bg-primary text-white text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2">
                  <LogIn size={16} />
                  Sign in with Google
                </button>
              )}
            </div>
          ) : (
            <div className="px-5 pb-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2.5">
                <Calendar size={16} />
                <span>Connected to Google Calendar</span>
              </div>
              <Row label="Calendar">
                <input
                  value={settings.googleCalendarId}
                  onChange={(e) => updateSettings({ googleCalendarId: e.target.value })}
                  placeholder="primary"
                  className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 outline-none w-40"
                />
              </Row>
              <button onClick={handleSignOut}
                className="w-full border border-red-200 text-red-500 text-sm font-medium py-2.5 rounded-xl flex items-center justify-center gap-2">
                <LogOut size={16} />
                Disconnect Google Calendar
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mt-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider px-5 mb-2">{title}</p>
      <div className="bg-white border-y border-gray-100">{children}</div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      {children}
    </div>
  )
}
