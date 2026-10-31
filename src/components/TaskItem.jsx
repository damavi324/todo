import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Check, MoreHorizontal, Pencil, Phone, StickyNote, Trash2, Volume2, CalendarDays } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { announce } from '../lib/notifications'
import { assistantName } from '../lib/callpilot'
import { formatDue, parseLocalDate, startOfToday } from '../lib/dates'
import { isReminder } from '../lib/taskKind'
import { PRIORITY_COLOR } from '../lib/views'
import { toggleDone, removeTask, startTaskCall } from '../lib/taskActions'

const LONG_PRESS_MS = 450

export default function TaskItem({ task, onOpen, showList = false }) {
  const list = useTaskStore((s) => (showList ? s.lists.find((l) => l.id === task.listId) : null))
  const [menuOpen, setMenuOpen] = useState(false)
  const reminder = isReminder(task)
  const press = useRef({ timer: null, x: 0, y: 0, held: false })

  const openMenu = () => {
    clearTimeout(press.current.timer)
    press.current.held = true
    setMenuOpen(true)
  }
  const startPress = (e) => {
    if (e.pointerType === 'mouse') return
    clearTimeout(press.current.timer)
    press.current = { timer: setTimeout(openMenu, LONG_PRESS_MS), x: e.clientX, y: e.clientY, held: false }
  }
  const endPress = () => clearTimeout(press.current.timer)
  // A finger that moves is scrolling the list, not holding the task.
  const movePress = (e) => {
    if (Math.abs(e.clientX - press.current.x) > 10 || Math.abs(e.clientY - press.current.y) > 10) endPress()
  }
  // Lifting the finger after a long press must not also tick or open the task.
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

  const dueLabel = formatDue(task.dueDate, task.dueTime)
  const overdue = task.dueDate && !task.completed && !reminder && parseLocalDate(task.dueDate) < startOfToday()
  const ring = PRIORITY_COLOR[task.priority]

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-3 select-none cursor-pointer hover:bg-surface-2/60 transition-colors task-enter ${task.completed ? 'opacity-55' : ''}`}
      style={{ WebkitTouchCallout: 'none' }}
      onClick={() => onOpen(task)}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => { e.preventDefault(); openMenu() }}
      onClickCapture={swallowHeldClick}
    >
      {reminder ? (
        <span className="mt-0.5 w-5 h-5 flex items-center justify-center flex-shrink-0 text-ink-3" aria-label="Reminder">
          <Bell size={16} />
        </span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); toggleDone(task) }}
          aria-label={task.completed ? 'Mark not done' : 'Mark done'}
          className={`mt-0.5 w-5 h-5 rounded-full border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${
            task.completed ? 'bg-accent border-accent text-accent-ink' : 'hover:bg-surface-2'
          }`}
          style={!task.completed ? { borderColor: ring || 'rgb(var(--ink-3))', background: ring ? `${ring}14` : undefined } : undefined}
        >
          {task.completed && <Check size={12} strokeWidth={3} />}
        </button>
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-[14.5px] leading-snug ${task.completed ? 'line-through text-ink-3' : 'text-ink'}`}>{task.title}</p>
        {(dueLabel || task.notes || task.call || (list && list.id !== 'inbox') || task.source === 'calendar') && (
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-ink-3">
            {dueLabel && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-danger font-medium' : ''}`}>
                <CalendarDays size={12} />
                {dueLabel}
              </span>
            )}
            {task.source === 'calendar' && (
              <span>From calendar</span>
            )}
            {task.notes && <StickyNote size={12} aria-label="Has notes" />}
            {task.call && <span className="inline-flex items-center gap-1"><Phone size={12} />Call</span>}
            {list && list.id !== 'inbox' && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: list.color }} />
                {list.name}
              </span>
            )}
          </div>
        )}
      </div>

      {task.call && !task.completed && (
        <button
          onClick={(e) => { e.stopPropagation(); startTaskCall(task) }}
          aria-label={`Have ${assistantName()} make this call`}
          className="h-7 px-2.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/15 inline-flex items-center gap-1.5 flex-shrink-0"
        >
          <Phone size={13} />Call
        </button>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); openMenu() }}
        aria-label="More actions"
        className="hidden md:flex w-7 h-7 -my-0.5 rounded-md items-center justify-center text-ink-3 hover:bg-surface-2 hover:text-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex-shrink-0"
      >
        <MoreHorizontal size={16} />
      </button>

      {menuOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/30 fade-in" />
          <div className="relative w-full md:w-80 bg-surface rounded-t-2xl md:rounded-xl shadow-pop slide-up md:fade-in p-2 pb-6 md:pb-2 safe-bottom"
            onClick={(e) => e.stopPropagation()}>
            <p className="px-3 pt-2 pb-2 text-[13px] font-medium text-ink-2 truncate">{task.title}</p>
            {!reminder && (
              <MenuItem icon={Check} label={task.completed ? 'Mark not done' : 'Mark done'} onClick={pick(() => toggleDone(task))} />
            )}
            <MenuItem icon={Pencil} label="Edit" onClick={pick(() => onOpen(task))} />
            <MenuItem icon={Volume2} label="Read aloud" onClick={pick(() => announce(task.title).catch(console.error))} />
            {task.call && <MenuItem icon={Phone} label={`Have ${assistantName()} call`} onClick={pick(() => startTaskCall(task))} />}
            <div className="my-1 border-t border-line" />
            <MenuItem icon={Trash2} label="Delete" danger onClick={pick(() => removeTask(task))} />
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
      className={`w-full flex items-center gap-3 px-3 h-11 md:h-9 rounded-lg text-sm hover:bg-surface-2 ${danger ? 'text-danger' : 'text-ink'}`}
    >
      <Icon size={16} className={danger ? '' : 'text-ink-3'} />
      {label}
    </button>
  )
}
