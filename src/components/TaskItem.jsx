import { useState } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { Trash2, Calendar, Flag, ChevronDown, ChevronUp, Phone } from 'lucide-react'
import { useCallStore } from '../store/useCallStore'
import { assistantName } from '../lib/callpilot'
import { syncReminders } from '../lib/notifications'
import { deleteCalendarEvent, calendarActive, reportCalendarError } from '../lib/googleCalendar'
import { parseLocalDate, startOfToday, addDays } from '../lib/dates'

const PRIORITY_COLOR = { high: '#EF4444', medium: '#F97316', low: '#3B82F6', none: '#D1D5DB' }

export default function TaskItem({ task, onEdit }) {
  const { toggleTask, deleteTask, dismissCalendarEvent, settings, setAppView } = useTaskStore()

  // Hand the task's attached call (or the task itself) to Pilot.
  const handleCall = () => {
    const c = task.call || {}
    useCallStore.getState().setDraft({
      mode: c.mode || 'agent',
      to: c.to || '',
      goal: c.goal || task.title,
      brief: [c.contact && `Calling: ${c.contact}`, c.details, task.notes].filter(Boolean).join('\n'),
    })
    setAppView('calls')
  }
  const [expanded, setExpanded] = useState(false)

  const handleToggle = () => {
    toggleTask(task.id)
    syncReminders().catch(console.error)
  }

  const handleDelete = async () => {
    if (task.source === 'calendar') {
      // Came from Google Calendar: leave the event alone, just stop importing it.
      dismissCalendarEvent(task.googleEventId)
    } else if (task.googleEventId && calendarActive()) {
      await deleteCalendarEvent(task.googleEventId, settings.googleCalendarId).catch((e) => {
        if (!/not found|deleted/i.test(e?.message || '')) reportCalendarError(e)
      })
    }
    deleteTask(task.id)
    syncReminders().catch(console.error)
  }

  const formatDue = (date, time) => {
    const d = parseLocalDate(date)
    if (!d) return null
    const today = startOfToday()
    const tomorrow = addDays(today, 1)
    let label
    if (d >= today && d < tomorrow) label = 'Today'
    else if (d >= tomorrow && d < addDays(today, 2)) label = 'Tomorrow'
    else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return time ? `${label} ${time}` : label
  }

  const dueLabel = formatDue(task.dueDate, task.dueTime)
  const isOverdue = task.dueDate && !task.completed && parseLocalDate(task.dueDate) < startOfToday()

  return (
    <div className={`bg-white rounded-2xl mb-2 shadow-sm overflow-hidden task-enter ${task.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={handleToggle}
          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
            task.completed ? 'bg-primary border-primary' : 'border-gray-300 hover:border-primary'
          }`}>
          {task.completed && <div className="w-2 h-2 bg-white rounded-full" />}
        </button>

        <div className="flex-1 min-w-0" onClick={() => onEdit(task)}>
          <p className={`text-sm font-medium text-gray-800 truncate ${task.completed ? 'line-through text-gray-400' : ''}`}>
            {task.title}
          </p>
          {dueLabel && (
            <div className={`flex items-center gap-1 mt-0.5 ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
              <Calendar size={11} />
              <span className="text-xs">{dueLabel}</span>
            </div>
          )}
        </div>

        {task.call && !task.completed && (
          <button onClick={handleCall} aria-label={`Have ${assistantName()} make this call`}
            className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1 flex-shrink-0">
            <Phone size={12} />Call
          </button>
        )}

        {task.priority !== 'none' && (
          <Flag size={14} style={{ color: PRIORITY_COLOR[task.priority] }} className="flex-shrink-0" />
        )}

        {task.notes && (
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 flex-shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}

        <button onClick={handleDelete} className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 p-1">
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && task.notes && (
        <div className="px-4 pb-3 pt-0">
          <p className="text-xs text-gray-500 leading-relaxed">{task.notes}</p>
        </div>
      )}
    </div>
  )
}
