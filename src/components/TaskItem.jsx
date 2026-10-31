import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTaskStore } from '../store/useTaskStore'
import { Trash2, Calendar, Flag, ChevronDown, ChevronUp, Volume2, Pencil, Check, Bell } from 'lucide-react'
import { syncReminders, announce } from '../lib/notifications'
import { deleteCalendarEvent, calendarActive, reportCalendarError } from '../lib/googleCalendar'
import { parseLocalDate, startOfToday, formatDue } from '../lib/dates'
import { isReminder } from '../lib/taskKind'

const PRIORITY_COLOR = { high: '#EF4444', medium: '#F97316', low: '#3B82F6', none: '#D1D5DB' }
const LONG_PRESS_MS = 500

export default function TaskItem({ task, onEdit }) {
  const { toggleTask, deleteTask, dismissCalendarEvent, settings } = useTaskStore()
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const reminder = isReminder(task)
  const press = useRef({ timer: null, x: 0, y: 0, held: false })

  const openMenu = () => {
    clearTimeout(press.current.timer)
    press.current.held = true
    setMenuOpen(true)
  }
  const startPress = (e) => {
    clearTimeout(press.current.timer)
    press.current = { timer: setTimeout(openMenu, LONG_PRESS_MS), x: e.clientX, y: e.clientY, held: false }
  }
  const endPress = () => clearTimeout(press.current.timer)
  // A finger that moves is scrolling the list, not holding the task.
  const movePress = (e) => {
    if (Math.abs(e.clientX - press.current.x) > 10 || Math.abs(e.clientY - press.current.y) > 10) endPress()
  }
  // Lifting the finger after a long press must not also tick, open or delete the task.
  const swallowHeldClick = (e) => {
    if (!press.current.held) return
    press.current.held = false
    e.stopPropagation()
    e.preventDefault()
  }
  const pick = (action) => () => {
    setMenuOpen(false)
    action()
  }

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

  const dueLabel = formatDue(task.dueDate, task.dueTime)
  const isOverdue = task.dueDate && !task.completed && parseLocalDate(task.dueDate) < startOfToday()

  return (
    <div className={`bg-white rounded-2xl mb-2 shadow-sm overflow-hidden task-enter ${task.completed ? 'opacity-60' : ''}`}>
      <div
        className="flex items-center gap-3 px-4 py-3.5 select-none"
        style={{ WebkitTouchCallout: 'none' }}
        onPointerDown={startPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => { e.preventDefault(); openMenu() }}
        onClickCapture={swallowHeldClick}>
        {reminder ? (
          <Bell size={18} className="w-5 text-gray-300 flex-shrink-0" aria-label="Reminder" />
        ) : (
          <button onClick={handleToggle}
            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
              task.completed ? 'bg-primary border-primary' : 'border-gray-300 hover:border-primary'
            }`}>
            {task.completed && <div className="w-2 h-2 bg-white rounded-full" />}
          </button>
        )}

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

      {/* Rendered on the body: this card is animated and dimmed, which would distort a sheet inside it. */}
      {menuOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="relative w-full bg-white rounded-t-3xl slide-up px-3 pt-4 pb-8">
            <p className="px-3 pb-2 text-sm font-semibold text-gray-800 truncate">{task.title}</p>
            <MenuItem icon={Volume2} label="Announce" onClick={pick(() => announce(task.title).catch(console.error))} />
            <MenuItem icon={Pencil} label="Edit" onClick={pick(() => onEdit(task))} />
            {!reminder && (
              <MenuItem icon={Check} label={task.completed ? 'Mark not done' : 'Mark done'} onClick={pick(handleToggle)} />
            )}
            <MenuItem icon={Trash2} label="Delete" danger onClick={pick(handleDelete)} />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function MenuItem({ icon: Icon, label, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm active:bg-gray-100 ${danger ? 'text-red-500' : 'text-gray-700'}`}>
      <Icon size={18} className={danger ? 'text-red-400' : 'text-gray-400'} />
      {label}
    </button>
  )
}
