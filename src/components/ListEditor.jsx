import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTaskStore } from '../store/useTaskStore'
import { LIST_COLORS } from '../lib/views'
import { removeTask } from '../lib/taskActions'
import { Button, Sheet, fieldClass } from './ui'

/** Rename a list, change its color, or delete it with its tasks. The Inbox can't be deleted. */
export default function ListEditor({ list, onClose }) {
  const updateList = useTaskStore((s) => s.updateList)
  const taskCount = useTaskStore((s) => s.tasks.filter((t) => t.listId === list.id).length)
  const [name, setName] = useState(list.name || '')
  const [color, setColor] = useState(list.color || LIST_COLORS[0])
  const [confirming, setConfirming] = useState(false)
  const canDelete = list.id !== 'inbox'

  const save = () => {
    if (!name.trim()) return
    updateList(list.id, { name: name.trim(), color })
    onClose()
  }

  const remove = async () => {
    onClose()
    const { tasks, deleteList } = useTaskStore.getState()
    // One by one, so their calendar events and reminders go too.
    for (const task of tasks.filter((t) => t.listId === list.id)) await removeTask(task)
    deleteList(list.id)
  }

  return (
    <Sheet
      title="Edit list"
      onClose={onClose}
      footer={
        <div className="flex items-center gap-2">
          {canDelete && (
            confirming ? (
              <Button variant="danger" size="sm" onClick={remove} className="-ml-2">
                <Trash2 size={15} />{taskCount ? `Delete list and ${taskCount} task${taskCount === 1 ? '' : 's'}` : 'Really delete'}
              </Button>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirming(true)} className="-ml-2">
                <Trash2 size={15} />Delete
              </Button>
            )
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!name.trim()}>Save</Button>
        </div>
      }
    >
      <div className="p-5 space-y-5">
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1.5">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            maxLength={60}
            className={`${fieldClass} w-full`}
          />
        </label>
        {list.id !== 'inbox' && (
          <div>
            <span className="block text-sm font-medium text-ink mb-2">Color</span>
            <div className="flex gap-2">
              {LIST_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)} aria-label="List color" aria-pressed={color === c}
                  className={`w-6 h-6 rounded-full ring-offset-2 ring-offset-surface ${color === c ? 'ring-2 ring-ink-3' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
