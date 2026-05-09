import { useState } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { Trash2, Calendar, Flag, ChevronDown, ChevronUp } from 'lucide-react'
import { cancelTaskNotification } from '../lib/notifications'
import { deleteCalendarEvent, isSignedIn } from '../lib/googleCalendar'

const PRIORITY_COLOR = { high: '#EF4444', medium: '#F97316', low: '#3B82F6', none: '#D1D5DB' }
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low', none: '' }

export default function TaskItem({ task, onEdit }) {
  const { toggleTask, deleteTask, settings } = useTaskStore()
  const [expanded, setExpanded] = useState(false)

  const handleToggle = () => {
    toggleTask(task.id)
    cancelTaskNotification(task.id)
  }

  const handleDelete = async () => {
    cancelTaskNotification(task.id)
    if (settings.googleCalendarEnabled && task.googleEventId && isSignedIn()) {
      await deleteCalendarEvent(task.googleEventId, settings.googleCalendarId).catch(() => {})
    }
    deleteTask(task.id)
  }

  const formatDue = (date, time) => {
    if (!date) return null
    const d = new Date(date)
    const today = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    let label
    if (d >= today && d < tomorrow) label = 'Today'
    else if (d >= tomorrow && d < new Date(tomorrow.getTime() + 86400000)) label = 'Tomorrow'
    else label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return time ? `${label} ${time}` : label
  }

  const dueLabel = formatDue(task.dueDate, task.dueTime)
  const isOverdue = task.dueDate && !task.completed && new Date(task.dueDate) < new Date(new Date().setHours(0,0,0,0))

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
