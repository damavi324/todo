import { useState, useRef } from 'react'
import { Bell, CalendarDays, CheckCircle2, Clock, Flag, List, Phone, Trash2, X } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { saveTask } from '../lib/saveTask'
import { dueDateTime } from '../lib/dates'
import { isReminder } from '../lib/taskKind'
import { removeTask } from '../lib/taskActions'
import { formatNumber, assistantName } from '../lib/callpilot'
import { PRIORITY_COLOR } from '../lib/views'
import { Button, Note, Segmented, Sheet, fieldClass } from './ui'

const KINDS = [
  { value: 'task', label: 'Task', icon: <CheckCircle2 size={14} /> },
  { value: 'reminder', label: 'Reminder', icon: <Bell size={14} /> },
]
const KIND_HINT = {
  task: 'Keeps reminding you until you mark it done.',
  reminder: 'Alerts once at its time. Nothing to mark done.',
}
const PRIORITIES = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]
const SMART_VIEWS = ['today', 'scheduled', 'all']

/** Create or edit a task. A drawer on the right on desktop, a bottom sheet on phones. */
export default function TaskEditor({ onClose, editTask, draft }) {
  const { lists, selectedList } = useTaskStore()
  const isEdit = !!editTask
  const seed = editTask || draft || {}

  const [title, setTitle] = useState(seed.title || '')
  const [notes, setNotes] = useState(seed.notes || '')
  const [dueDate, setDueDate] = useState(seed.dueDate || '')
  const [dueTime, setDueTime] = useState(seed.dueTime || '')
  const [priority, setPriority] = useState(seed.priority || 'none')
  const [listId, setListId] = useState(
    editTask?.listId || (draft?.listId && lists.some((l) => l.id === draft.listId) ? draft.listId : null)
      || (!SMART_VIEWS.includes(selectedList) && lists.some((l) => l.id === selectedList) ? selectedList : 'inbox')
  )
  // A phone call the assistant should make for this task (from the voice assistant).
  const [call, setCall] = useState(seed.call || null)
  const [kind, setKind] = useState(isReminder(seed) ? 'reminder' : 'task')
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
    const taskData = {
      title: title.trim(), notes, dueDate, dueTime: dueDate ? dueTime : '', priority, listId, kind, call: call || null,
    }
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

  const handleDelete = async () => {
    onClose()
    await removeTask(editTask)
  }

  return (
    <Sheet
      side
      title={isEdit ? 'Edit task' : 'New task'}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {isEdit && (
            <Button variant="danger" size="sm" onClick={handleDelete} className="-ml-2">
              <Trash2 size={15} />Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!title.trim() || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Add task'}
          </Button>
        </div>
      }
    >
      <div className="px-5 pt-5 pb-6 space-y-5">
        <div>
          <input
            autoFocus={!isEdit}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="What needs doing?"
            className="w-full bg-transparent text-lg font-medium text-ink outline-none"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes"
            rows={notes ? Math.min(8, notes.split('\n').length + 1) : 2}
            className="w-full mt-2 bg-transparent text-sm text-ink-2 leading-relaxed outline-none resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <Segmented value={kind} onChange={setKind} options={KINDS} />
          <p className="text-xs text-ink-3 px-1">{KIND_HINT[kind]}</p>
        </div>

        <div className="rounded-xl border border-line divide-y divide-line">
          <Field icon={CalendarDays} label="Date">
            <div className="flex items-center gap-1">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${fieldClass} w-40`} />
              {dueDate && (
                <button onClick={() => { setDueDate(''); setDueTime('') }} aria-label="Clear date"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:bg-surface-2"><X size={14} /></button>
              )}
            </div>
          </Field>
          {dueDate && (
            <Field icon={Clock} label="Time">
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={`${fieldClass} w-40 mr-8`} />
            </Field>
          )}
          <Field icon={List} label="List">
            <select value={listId} onChange={(e) => setListId(e.target.value)} className={`${fieldClass} w-40 mr-8`}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <div className="px-4 py-3 space-y-2.5">
            <span className="flex items-center gap-2.5 text-sm text-ink-2">
              <Flag size={16} className="text-ink-3" />
              Priority
            </span>
            <Segmented
              size="sm"
              value={priority}
              onChange={setPriority}
              options={PRIORITIES.map((p) => ({
                ...p,
                icon: p.value !== 'none' && <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLOR[p.value] }} />,
              }))}
            />
          </div>
        </div>

        {alreadyPassed && (
          <Note tone="warn">
            {dueTime ? 'That time has already passed' : 'Tasks without a time remind at 9:00 AM, and that has passed'},
            so no reminder will go off.
          </Note>
        )}
        {draft?.parseWarning && (
          <Note>The assistant couldn&apos;t read that clearly, so a basic reader filled this in. Check the date and time.</Note>
        )}

        {call && (
          <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3">
            <Phone size={16} className="text-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-medium text-ink">{assistantName()} will make a call</p>
              <p className="text-ink-3 truncate">{call.contact || formatNumber(call.to) || 'Number to add'}{call.goal ? ` · ${call.goal}` : ''}</p>
            </div>
            <button type="button" onClick={() => setCall(null)} aria-label="Remove the call"
              className="w-7 h-7 -mr-1 rounded-md flex items-center justify-center text-ink-3 hover:bg-surface-2"><X size={14} /></button>
          </div>
        )}

        {editTask?.source === 'calendar' && (
          <p className="text-xs text-ink-3 px-1">Imported from your calendar. Changes there update this task.</p>
        )}
      </div>
    </Sheet>
  )
}

function Field({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 pl-4 pr-2 min-h-[52px]">
      <span className="flex items-center gap-2.5 text-sm text-ink-2">
        <Icon size={16} className="text-ink-3" />
        {label}
      </span>
      {children}
    </div>
  )
}
