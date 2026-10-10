import { useState, useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import Sidebar from './components/Sidebar'
import TaskList from './components/TaskList'
import AddTaskModal from './components/AddTaskModal'
import Settings from './components/Settings'
import { Menu, Plus, X, Mic } from 'lucide-react'
import { useTaskStore } from './store/useTaskStore'
import { syncReminders, applyNotificationCompletions } from './lib/notifications'
import { autoImport } from './lib/googleCalendar'
import { parseSpokenTask, isGeminiConfigured } from './lib/voiceTask'
import VoiceReminder from './plugins/VoiceReminder'
import SpeechCapture from './plugins/SpeechCapture'

// Bring the app in line with what happened while it was closed or in the background.
async function refresh() {
  await applyNotificationCompletions()
  await autoImport()
  await syncReminders()
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [listening, setListening] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const calendarError = useTaskStore((s) => s.calendarError)
  const setCalendarError = useTaskStore((s) => s.setCalendarError)

  const handleVoiceCapture = async () => {
    setVoiceStatus('')
    setListening(true)
    try {
      await SpeechCapture.requestPermissions()
      setVoiceStatus(isGeminiConfigured() ? 'Speak now. Gemini will fill in the task.' : 'Speak now.')
      const { text } = await SpeechCapture.listen()
      setVoiceStatus('Working out the task…')
      const parsed = await parseSpokenTask(text)
      setDraft(parsed)
      setVoiceStatus('')
      setAddOpen(true)
    } catch (error) {
      const message = error?.message || 'Could not hear a task'
      if (!/cancel/i.test(message)) setVoiceStatus(message)
    } finally {
      setListening(false)
    }
  }

  useEffect(() => {
    const run = () => refresh().catch(console.error)
    run()
    const handles = [
      CapApp.addListener('resume', run),
      VoiceReminder.addListener('tasksCompleted', run),
    ]
    return () => handles.forEach((h) => Promise.resolve(h).then((l) => l?.remove?.()))
  }, [])

  return (
    <div className="flex h-dvh bg-[#f7f8fc] overflow-hidden">
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="w-72 h-full shadow-2xl">
            <Sidebar
              onClose={() => setSidebarOpen(false)}
              onOpenSettings={() => { setSidebarOpen(false); setSettingsOpen(true) }}
            />
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Desktop sidebar (hidden on mobile) */}
      <div className="hidden md:block w-64 flex-shrink-0">
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Top bar */}
        <div className="flex items-center px-4 pt-12 pb-2 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl hover:bg-gray-200 transition-colors">
            <Menu size={22} className="text-gray-600" />
          </button>
        </div>

        {calendarError && (
          <div className="mx-4 mb-1 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <span className="flex-1">{calendarError}</span>
            <button onClick={() => setCalendarError('')} aria-label="Dismiss" className="flex-shrink-0">
              <X size={14} />
            </button>
          </div>
        )}

        <TaskList />

        {voiceStatus && !listening && (
          <div className="fixed bottom-28 left-4 right-28 z-30 bg-white border border-gray-200 text-sm text-gray-700 rounded-2xl px-3 py-2 shadow">
            {voiceStatus}
          </div>
        )}
        <button
          type="button"
          onClick={handleVoiceCapture}
          disabled={listening}
          aria-label="Create a task by speaking"
          className="fixed bottom-8 right-24 w-14 h-14 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30 disabled:opacity-60">
          <Mic size={24} className={listening ? 'text-red-500' : 'text-primary'} />
        </button>
        <button
          onClick={() => { setDraft(null); setAddOpen(true) }}
          className="fixed bottom-8 right-6 w-14 h-14 bg-primary rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30"
          style={{ boxShadow: '0 4px 20px rgba(71,114,250,0.4)' }}>
          <Plus size={26} className="text-white" />
        </button>
      </div>

      {listening && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="w-full bg-white rounded-t-3xl px-6 pt-6 pb-10">
            <p className="text-lg font-semibold text-gray-800">Listening…</p>
            <p className="text-sm text-gray-500 mt-1">{voiceStatus || 'Say the task, including the day and time.'}</p>
            <button
              type="button"
              onClick={() => { SpeechCapture.stop().catch(() => {}); setListening(false) }}
              className="mt-5 w-full bg-gray-100 text-gray-800 font-medium py-3 rounded-2xl">
              Cancel
            </button>
          </div>
        </div>
      )}

      {addOpen && (
        <AddTaskModal
          draft={draft}
          onClose={() => { setAddOpen(false); setDraft(null) }}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
