import { useState, useRef } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { saveTask } from '../lib/saveTask'
import { dueDateTime } from '../lib/dates'
import { isReminder } from '../lib/taskKind'
import { X, Flag, Calendar, Clock, AlignLeft, List } from 'lucide-react'

const KINDS = [
  { value: 'task', label: 'Task', hint: 'Keeps reminding you until you mark it done.' },
  { value: 'reminder', label: 'Reminder', hint: 'Alerts once at its time. Nothing to mark done.' },
]

const PRIORITIES = [
  { value: 'high', label: 'High', color: '#EF4444' },
  { value: 'medium', label: 'Medium', color: '#F97316' },
  { value: 'low', label: 'Low', color: '#3B82F6' },
  { value: 'none', label: 'None', color: '#D1D5DB' },
]

export default function AddTaskModal({ onClose, editTask, draft }) {
  const { lists } = useTaskStore()
  const isEdit = !!editTask
  const seed = editTask || draft || {}

  const [title, setTitle] = useState(seed.title || '')
  const [notes, setNotes] = useState(seed.notes || '')
  const [dueDate, setDueDate] = useState(seed.dueDate || '')
  const [dueTime, setDueTime] = useState(seed.dueTime || '')
  const [priority, setPriority] = useState(seed.priority || 'none')
  const [listId, setListId] = useState(editTask?.listId || 'inbox')
  const [kind, setKind] = useState(isReminder(editTask) ? 'reminder' : 'task')
  const [saving, setSaving] = useState(false)
  // Guards against a second Enter press creating the task twice before the first save finishes.
  const savingRef = useRef(false)

  // Reminders only fire for future times, so say so instead of saving a reminder that never goes off.
  const due = dueDateTime({ dueDate, dueTime })
  const whenChanged = !isEdit || dueDate !== (editTask.dueDate || '') || dueTime !== (editTask.dueTime || '')
  const alreadyPassed = whenChanged && due && due <= new Date()

  const handleSave = async () => {
    if (!title.trim() || savingRef.current) return
    savingRef.current = true
    setSaving(true)

    // The time field is hidden without a date, so don't keep a leftover time behind it.
    const taskData = { title: title.trim(), notes, dueDate, dueTime: dueDate ? dueTime : '', priority, listId, kind }

    try {
      await saveTask(taskData, editTask)
    } catch (e) {
      console.error(e)
    } finally {
      savingRef.current = false
      setSaving(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-3xl slide-up max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{isEdit ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full bg-gray-100 text-gray-500">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="Task title"
            className="w-full text-base font-medium text-gray-800 outline-none placeholder-gray-300 border-b border-gray-100 pb-2"
          />

          <div>
            <div className="flex gap-2">
              {KINDS.map((k) => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${
                    kind === k.value ? 'border-2 border-primary text-primary bg-primary/10' : 'border border-gray-100 bg-gray-50 text-gray-500'
                  }`}>
                  {k.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{KINDS.find((k) => k.value === kind).hint}</p>
          </div>

          <div className="flex items-start gap-3">
            <AlignLeft size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="flex-1 text-sm text-gray-600 outline-none placeholder-gray-300 resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <Calendar size={16} className="text-gray-400 flex-shrink-0" />
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="flex-1 text-sm text-gray-600 outline-none bg-gray-50 rounded-lg px-3 py-2"
            />
          </div>

          {dueDate && (
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-gray-400 flex-shrink-0" />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="flex-1 text-sm text-gray-600 outline-none bg-gray-50 rounded-lg px-3 py-2"
              />
            </div>
          )}

          {alreadyPassed && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5">
              {dueTime ? 'That time has already passed' : 'Tasks without a time remind at 9:00 AM, and that has passed'},
              so no reminder will go off.
            </p>
          )}
          {draft?.parseWarning && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5">
              Gemini couldn&apos;t read that, so the basic parser filled this in. Check the date and time.
            </p>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Flag size={16} className="text-gray-400" />
              <span className="text-sm text-gray-500">Priority</span>
            </div>
            <div className="flex gap-2">
              {PRIORITIES.map((p) => (
                <button key={p.value} onClick={() => setPriority(p.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${
                    priority === p.value ? 'border-2' : 'border border-gray-100 bg-gray-50'
                  }`}
                  style={priority === p.value ? { borderColor: p.color, color: p.color, background: p.color + '15' } : { color: '#6B7280' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <List size={16} className="text-gray-400 flex-shrink-0" />
            <select value={listId} onChange={(e) => setListId(e.target.value)}
              className="flex-1 text-sm text-gray-600 outline-none bg-gray-50 rounded-lg px-3 py-2">
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-5 pb-8 pt-2">
          <button onClick={handleSave} disabled={!title.trim() || saving}
            className="w-full bg-primary text-white font-semibold py-3.5 rounded-2xl disabled:opacity-40 transition-opacity">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
