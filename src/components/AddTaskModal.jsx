import { useState, useEffect } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { scheduleTaskNotification, requestNotificationPermission } from '../lib/notifications'
import { createCalendarEvent, updateCalendarEvent, isSignedIn } from '../lib/googleCalendar'
import { X, Flag, Calendar, Clock, AlignLeft, List } from 'lucide-react'

const PRIORITIES = [
  { value: 'high', label: 'High', color: '#EF4444' },
  { value: 'medium', label: 'Medium', color: '#F97316' },
  { value: 'low', label: 'Low', color: '#3B82F6' },
  { value: 'none', label: 'None', color: '#D1D5DB' },
]

export default function AddTaskModal({ onClose, editTask }) {
  const { addTask, updateTask, lists, settings } = useTaskStore()
  const isEdit = !!editTask

  const [title, setTitle] = useState(editTask?.title || '')
  const [notes, setNotes] = useState(editTask?.notes || '')
  const [dueDate, setDueDate] = useState(editTask?.dueDate || '')
  const [dueTime, setDueTime] = useState(editTask?.dueTime || '')
  const [priority, setPriority] = useState(editTask?.priority || 'none')
  const [listId, setListId] = useState(editTask?.listId || 'inbox')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!title.trim()) return
    setSaving(true)

    const taskData = { title: title.trim(), notes, dueDate, dueTime, priority, listId }

    try {
      if (isEdit) {
        updateTask(editTask.id, taskData)
        if (settings.googleCalendarEnabled && editTask.googleEventId && isSignedIn()) {
          await updateCalendarEvent(editTask.googleEventId, { ...editTask, ...taskData }, settings.googleCalendarId).catch(() => {})
        }
        if (dueDate) scheduleTaskNotification({ ...editTask, ...taskData })
      } else {
        const newTask = { ...taskData, googleEventId: null }
        if (settings.googleCalendarEnabled && isSignedIn()) {
          try {
            const eventId = await createCalendarEvent(newTask, settings.googleCalendarId)
            newTask.googleEventId = eventId
          } catch {}
        }
        addTask(newTask)
        if (dueDate) {
          await requestNotificationPermission()
          scheduleTaskNotification({ ...newTask, id: 'pending' })
        }
      }
    } finally {
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
