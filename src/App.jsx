import { useState, useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import Sidebar from './components/Sidebar'
import TaskList from './components/TaskList'
import AddTaskModal from './components/AddTaskModal'
import Settings from './components/Settings'
import { Menu, Plus, X } from 'lucide-react'
import { useTaskStore } from './store/useTaskStore'
import { syncReminders, applyNotificationCompletions } from './lib/notifications'
import { autoImport } from './lib/googleCalendar'
import VoiceReminder from './plugins/VoiceReminder'

// Bring the app in line with what happened while it was closed or in the background.
async function refresh() {
  await applyNotificationCompletions()
  await autoImport()
  await syncReminders()
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const calendarError = useTaskStore((s) => s.calendarError)
  const setCalendarError = useTaskStore((s) => s.setCalendarError)

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

        {/* FAB */}
        <button
          onClick={() => setAddOpen(true)}
          className="fixed bottom-8 right-6 w-14 h-14 bg-primary rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform z-30"
          style={{ boxShadow: '0 4px 20px rgba(71,114,250,0.4)' }}>
          <Plus size={26} className="text-white" />
        </button>
      </div>

      {addOpen && <AddTaskModal onClose={() => setAddOpen(false)} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
