import { useState } from 'react'
import { ChevronRight, Loader2, Mic, Plus, Settings, CornerDownLeft } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { groupView, openCount, viewName } from '../lib/views'
import { parseSpokenTask } from '../lib/voiceTask'
import { saveTask } from '../lib/saveTask'
import { formatDue, toLocalYMD } from '../lib/dates'
import TaskItem from './TaskItem'
import { Button, IconButton } from './ui'

const EMPTY = {
  today: ['Nothing due today', 'Enjoy the space, or plan something below.'],
  scheduled: ['Nothing scheduled', 'Tasks with a date show up here, grouped by day.'],
  all: ['No tasks yet', 'Add your first one below.'],
}

export default function TaskList({ onOpenTask, onNewTask, onVoice, onOpenSettings }) {
  const { selectedList, lists, tasks } = useTaskStore()
  const [showDone, setShowDone] = useState(false)
  const { groups, done } = groupView(selectedList, tasks)
  const smartView = ['today', 'scheduled', 'all'].includes(selectedList)
  const remaining = openCount(selectedList, tasks)
  const title = viewName(selectedList, lists)
  const subtitle = selectedList === 'today'
    ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : `${remaining} open`

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="safe-top flex-shrink-0">
        <div className="max-w-3xl mx-auto w-full px-5 md:px-10 pt-6 md:pt-10 pb-4 flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-[28px] md:text-[30px] leading-tight font-semibold tracking-tight text-ink truncate">{title}</h1>
            <p className="text-sm text-ink-3 mt-1">
              {subtitle}
              {selectedList === 'today' && remaining > 0 && <span> · {remaining} open</span>}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 pb-1">
            <Button variant="secondary" size="sm" onClick={onVoice}><Mic size={15} />Speak</Button>
            <Button variant="primary" size="sm" onClick={onNewTask}><Plus size={15} />New task</Button>
          </div>
          <IconButton label="Settings" onClick={onOpenSettings} className="md:hidden -mr-2 mb-0.5">
            <Settings size={20} />
          </IconButton>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-3 md:px-10 pb-36 md:pb-16">
          <QuickAdd viewId={selectedList} />

          {groups.length === 0 && done.length === 0 && (
            <div className="text-center py-16 px-6">
              <p className="text-[15px] font-medium text-ink-2">{(EMPTY[selectedList] || ['This list is empty'])[0]}</p>
              <p className="text-sm text-ink-3 mt-1">{(EMPTY[selectedList] || [null, 'Add a task above to get started.'])[1]}</p>
            </div>
          )}

          {groups.map((g) => (
            <section key={g.key} className="mt-6">
              <h2 className={`px-2 mb-1.5 text-[13px] font-semibold ${g.tone === 'danger' ? 'text-danger' : 'text-ink-2'}`}>
                {g.label}
                <span className="ml-2 font-normal text-ink-3 tabular-nums">{g.items.length}</span>
              </h2>
              <div className="bg-surface rounded-xl shadow-card overflow-hidden divide-y divide-line">
                {g.items.map((task) => (
                  <TaskItem key={task.id} task={task} onOpen={onOpenTask} showList={smartView} />
                ))}
              </div>
            </section>
          ))}

          {done.length > 0 && (
            <section className="mt-6">
              <button
                onClick={() => setShowDone(!showDone)}
                className="flex items-center gap-1 px-2 mb-1.5 text-[13px] font-semibold text-ink-3 hover:text-ink-2"
              >
                <ChevronRight size={14} className={`transition-transform ${showDone ? 'rotate-90' : ''}`} />
                Completed
                <span className="ml-1 font-normal tabular-nums">{done.length}</span>
              </button>
              {showDone && (
                <div className="bg-surface rounded-xl shadow-card overflow-hidden divide-y divide-line">
                  {done.map((task) => (
                    <TaskItem key={task.id} task={task} onOpen={onOpenTask} showList={smartView} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * One line to add a task in plain words: "Call mom tomorrow at 5pm". The date and time are read out of
 * the text. Added in Today, a task without a date is due today; added in a list, it goes in that list.
 */
function QuickAdd({ viewId }) {
  const lists = useTaskStore((s) => s.lists)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState('')

  const submit = async () => {
    const words = text.trim()
    if (!words || busy) return
    setBusy(true)
    try {
      const parsed = await parseSpokenTask(words)
      delete parsed.parseWarning
      const listId = lists.some((l) => l.id === viewId) ? viewId : parsed.listId || 'inbox'
      if (!parsed.dueDate && viewId === 'today') parsed.dueDate = toLocalYMD(new Date())
      const task = await saveTask({ notes: '', priority: 'none', dueTime: '', ...parsed, listId })
      setText('')
      const due = formatDue(task.dueDate, task.dueTime)
      setLast(`Added “${task.title}”${due ? ` · ${due}` : ''}`)
      setTimeout(() => setLast(''), 3500)
    } catch (e) {
      console.error(e)
      setLast('Could not add that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 h-12 px-4 rounded-xl bg-surface shadow-card focus-within:ring-2 focus-within:ring-accent/30 transition-shadow">
        {busy ? <Loader2 size={18} className="text-ink-3 animate-spin" /> : <Plus size={18} className="text-accent" />}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add a task, e.g. “Pay rent Friday 9am”"
          aria-label="Add a task"
          className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px] text-ink"
        />
        {text && (
          <span className="hidden md:inline-flex items-center gap-1 text-xs text-ink-3">
            <CornerDownLeft size={12} />Enter
          </span>
        )}
      </div>
      <p className={`px-2 pt-2 text-xs text-ink-3 transition-opacity ${last ? 'opacity-100' : 'opacity-0'}`} aria-live="polite">
        {last || ' '}
      </p>
    </div>
  )
}
