import { useState, useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import { CalendarClock, CalendarDays, LayoutList, Mic, Phone, Plus, Settings as SettingsIcon, X } from 'lucide-react'
import Sidebar, { Navigation } from './components/Sidebar'
import TaskList from './components/TaskList'
import TaskEditor from './components/TaskEditor'
import Settings from './components/Settings'
import Calls, { LogsSheet } from './components/Calls'
import VoiceAssistant from './components/VoiceAssistant'
import { IconButton } from './components/ui'
import { useTaskStore } from './store/useTaskStore'
import { useCallStore } from './store/useCallStore'
import { syncReminders, applyNotificationCompletions } from './lib/notifications'
import { autoImport } from './lib/googleCalendar'
import { saveTask } from './lib/saveTask'
import { startCloudSync } from './lib/cloudSync'
import { dueDateTime, formatDue } from './lib/dates'
import VoiceReminder from './plugins/VoiceReminder'

// Bring the app in line with what happened while it was closed or in the background.
async function refresh() {
  await applyNotificationCompletions()
  await autoImport()
  useTaskStore.getState().dropPastReminders()
  await syncReminders()
}

export default function App() {
  // The task being edited, or a new task's starting values. null when the editor is closed.
  const [editor, setEditor] = useState(null)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Phones only: the Lists tab, which shows every view and list to pick from.
  const [browsing, setBrowsing] = useState(false)
  const calendarError = useTaskStore((s) => s.calendarError)
  const setCalendarError = useTaskStore((s) => s.setCalendarError)
  const appView = useTaskStore((s) => s.appView)
  const setAppView = useTaskStore((s) => s.setAppView)
  const callpilotUrl = useTaskStore((s) => s.settings.callpilotUrl)
  const callpilotConnected = useTaskStore((s) => s.settings.callpilotConnected)
  const question = useCallStore((s) => s.question)

  // Stay connected to the calling server (waking it if it sleeps), so the assistant's questions and
  // live calls reach you on any screen.
  useEffect(() => {
    const calls = useCallStore.getState()
    if (callpilotConnected && callpilotUrl) calls.connect()
    else calls.disconnect()
  }, [callpilotUrl, callpilotConnected])

  useEffect(() => {
    if (!callpilotConnected || !callpilotUrl) return
    const onVisible = () => { if (document.visibilityState === 'visible') useCallStore.getState().wake().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [callpilotUrl, callpilotConnected])

  // Short-lived toast for call notices and voice-saved tasks.
  const [toast, setToast] = useState(null)
  useEffect(() => useCallStore.subscribe((s, prev) => {
    if (s.notice && s.notice !== prev.notice) setToast(s.notice)
  }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.level === 'error' ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])

  // The assistant asked something while you're on another screen: bring Calls forward.
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
    setEditor({ draft: task })
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

  const openTask = (task) => setEditor({ task })
  const newTask = () => setEditor({ draft: null })
  const showCalls = appView === 'calls'

  return (
    <div className="flex h-dvh bg-bg text-ink overflow-hidden">
      <aside className="hidden md:block w-64 flex-shrink-0">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative pb-16 md:pb-0">
        {calendarError && (
          <div className="mx-3 md:mx-6 mt-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-[13px] text-danger safe-top">
            <span className="flex-1">{calendarError}</span>
            <button onClick={() => setCalendarError('')} aria-label="Dismiss" className="flex-shrink-0">
              <X size={15} />
            </button>
          </div>
        )}

        {browsing && !showCalls ? (
          <BrowseLists onPick={() => setBrowsing(false)} onOpenSettings={() => setSettingsOpen(true)} />
        ) : showCalls ? (
          <Calls onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <TaskList
            onOpenTask={openTask}
            onNewTask={newTask}
            onVoice={() => setVoiceOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* Phone: speak and add, above the tab bar. */}
        {!showCalls && !browsing && (
          <div className="md:hidden fixed right-4 bottom-[84px] z-30 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setVoiceOpen(true)}
              disabled={voiceOpen}
              aria-label="Speak a task or a call"
              className="w-12 h-12 rounded-full bg-surface shadow-pop flex items-center justify-center text-accent active:scale-95 transition-transform"
            >
              <Mic size={20} />
            </button>
            <button
              type="button"
              onClick={newTask}
              aria-label="New task"
              className="w-14 h-14 rounded-2xl bg-accent text-accent-ink shadow-pop flex items-center justify-center active:scale-95 transition-transform"
            >
              <Plus size={24} />
            </button>
          </div>
        )}

        {toast && (
          <div role="status" className="fixed z-[70] left-4 right-4 bottom-24 md:left-auto md:right-6 md:bottom-6 md:w-96 rounded-xl px-4 py-3 text-sm shadow-pop fade-in bg-ink text-bg">
            {toast.message}
          </div>
        )}
      </main>

      <TabBar
        browsing={browsing}
        onBrowse={() => { setBrowsing(true) }}
        onPick={() => setBrowsing(false)}
      />

      {voiceOpen && (
        <VoiceAssistant
          onClose={() => setVoiceOpen(false)}
          onTask={handleVoiceTask}
          onCall={(draft) => { setVoiceOpen(false); useCallStore.getState().setDraft(draft); setAppView('calls') }}
        />
      )}

      {editor && (
        <TaskEditor
          key={editor.task?.id || 'new'}
          editTask={editor.task}
          draft={editor.draft}
          onClose={() => setEditor(null)}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <LogsSheet />
    </div>
  )
}

/** Phone navigation. On wider screens the sidebar does this. */
function TabBar({ browsing, onBrowse, onPick }) {
  const { selectedList, setSelectedList, appView, setAppView } = useTaskStore()
  const tabs = [
    { id: 'today', label: 'Today', icon: CalendarDays, active: appView === 'tasks' && !browsing && selectedList === 'today', go: () => setSelectedList('today') },
    { id: 'scheduled', label: 'Upcoming', icon: CalendarClock, active: appView === 'tasks' && !browsing && selectedList === 'scheduled', go: () => setSelectedList('scheduled') },
    { id: 'lists', label: 'Lists', icon: LayoutList, active: appView === 'tasks' && (browsing || !['today', 'scheduled'].includes(selectedList)), go: onBrowse },
    { id: 'calls', label: 'Calls', icon: Phone, active: appView === 'calls', go: () => setAppView('calls') },
  ]
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line safe-bottom">
      <div className="flex h-16">
        {tabs.map(({ id, label, icon: Icon, active, go }) => (
          <button
            key={id}
            onClick={() => { if (id !== 'lists') onPick(); go() }}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-accent' : 'text-ink-3'}`}
          >
            <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}

function BrowseLists({ onPick, onOpenSettings }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="safe-top px-5 pt-6 pb-4 flex items-end">
        <h1 className="flex-1 text-[28px] leading-tight font-semibold tracking-tight">Lists</h1>
        <IconButton label="Settings" onClick={onOpenSettings} className="-mr-2 mb-0.5">
          <SettingsIcon size={20} />
        </IconButton>
      </div>
      <div className="px-3 pb-28">
        <Navigation onPick={onPick} large />
      </div>
    </div>
  )
}
