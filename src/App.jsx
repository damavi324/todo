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
import { saveTask } from './lib/saveTask'
import { startCloudSync } from './lib/cloudSync'
import { dueDateTime, formatDue } from './lib/dates'
import VoiceReminder from './plugins/VoiceReminder'
import { LogsSheet } from './components/Calls'
import VoiceAssistant from './components/VoiceAssistant'
import { useCallStore } from './store/useCallStore'
import { normalizeServerUrl, wakeServer } from './lib/callpilot'

// Bring the app in line with what happened while it was closed or in the background.
async function refresh() {
  await applyNotificationCompletions()
  await autoImport()
  useTaskStore.getState().dropPastReminders()
  await syncReminders()
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const calendarError = useTaskStore((s) => s.calendarError)
  const setCalendarError = useTaskStore((s) => s.setCalendarError)
  const appView = useTaskStore((s) => s.appView)
  const setAppView = useTaskStore((s) => s.setAppView)
  const callpilotUrl = useTaskStore((s) => s.settings.callpilotUrl)
  const callpilotConnected = useTaskStore((s) => s.settings.callpilotConnected)
  const notice = useCallStore((s) => s.notice)
  const question = useCallStore((s) => s.question)

  // Calls is the live CallPilot page, which owns the phone line. Wake the server, but
  // do not open a second line from this app.
  useEffect(() => {
    useCallStore.getState().disconnect()
    if (callpilotConnected && callpilotUrl) wakeServer().catch(() => {})
  }, [callpilotUrl, callpilotConnected])

  useEffect(() => {
    if (!callpilotConnected || !callpilotUrl) return
    const onVisible = () => { if (document.visibilityState === 'visible') wakeServer().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [callpilotUrl, callpilotConnected])

  // Short-lived toast for call notices.
  const [toast, setToast] = useState(null)
  useEffect(() => {
    if (!notice) return
    setToast(notice)
    const t = setTimeout(() => setToast(null), notice.level === 'error' ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [notice])

  // Pilot asked something while you're on another screen: bring Calls forward.
  useEffect(() => {
    if (question) setAppView('calls')
  }, [question, setAppView])

  // A clear spoken task with a day and a time still ahead is saved straight away. Anything else,
  // anything with a call attached, or anything you asked to review is shown to check.
  const handleVoiceTask = async (task, { review = false } = {}) => {
    setVoiceOpen(false)
    if (!review && !task.parseWarning && !task.call && task.dueDate && task.dueTime && dueDateTime(task) > new Date()) {
      try {
        const saved = await saveTask({ ...task, listId: task.listId || 'inbox' })
        setToast({ level: 'info', message: `Reminder set: ${saved.title}, ${formatDue(saved.dueDate, saved.dueTime)}` })
        return
      } catch (e) {
        console.error(e)
      }
    }
    setDraft(task)
    setAddOpen(true)
  }

  // Follow the signed-in account so tasks match on every device.
  useEffect(() => startCloudSync(), [])

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

        {appView === 'calls'
          ? <CallPilotPage url={callpilotUrl} connected={callpilotConnected} onOpenSettings={() => setSettingsOpen(true)} />
          : <TaskList />}

        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          disabled={voiceOpen}
          aria-label="Speak a task or a call"
          className={`fixed bottom-8 ${appView === 'calls' ? 'right-6' : 'right-24'} w-14 h-14 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30 disabled:opacity-60`}>
          <Mic size={24} className={voiceOpen ? 'text-red-500' : 'text-primary'} />
        </button>
        {appView !== 'calls' && (
          <button
            onClick={() => { setDraft(null); setAddOpen(true) }}
            aria-label="Add a task"
            className="fixed bottom-8 right-6 w-14 h-14 bg-primary rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30"
            style={{ boxShadow: '0 4px 20px rgba(71,114,250,0.4)' }}>
            <Plus size={26} className="text-white" />
          </button>
        )}

        {toast && (
          <div role="status" className={`fixed top-12 left-4 right-4 z-[70] rounded-2xl px-4 py-3 text-sm shadow-lg ${toast.level === 'error' ? 'bg-red-600 text-white' : 'bg-[#1a1d2e] text-white'}`}>
            {toast.message}
          </div>
        )}
      </div>

      {voiceOpen && (
        <VoiceAssistant
          onClose={() => setVoiceOpen(false)}
          onTask={handleVoiceTask}
          onCall={(draft) => { setVoiceOpen(false); useCallStore.getState().setDraft(draft); setAppView('calls') }}
        />
      )}

      {addOpen && (
        <AddTaskModal
          draft={draft}
          onClose={() => { setAddOpen(false); setDraft(null) }}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <LogsSheet />
    </div>
  )
}

/** Calls opens the CallPilot site itself, so that page updates without a new app install. */
function CallPilotPage({ url, connected, onOpenSettings }) {
  const src = normalizeServerUrl(url)
  if (!connected || !src) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
        <p className="text-sm text-gray-600">Add your CallPilot address in Settings. Calls opens that page.</p>
        <button type="button" onClick={onOpenSettings} className="bg-primary text-white text-sm font-medium px-4 py-2.5 rounded-xl">Open settings</button>
      </div>
    )
  }
  return (
    <iframe
      title="Calls"
      src={src}
      className="flex-1 w-full min-h-0 border-0 bg-white"
      allow="microphone *; autoplay; speaker-selection"
    />
  )
}
