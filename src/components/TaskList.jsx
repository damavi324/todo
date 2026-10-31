import { useState } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import TaskItem from './TaskItem'
import AddTaskModal from './AddTaskModal'
import { CheckCircle2 } from 'lucide-react'
import { dueDateTime, startOfToday, addDays } from '../lib/dates'
import { isReminder } from '../lib/taskKind'

const VIEW_LABELS = {
  today: 'Today',
  scheduled: 'Scheduled',
  all: 'All Tasks',
}

export default function TaskList() {
  const { selectedList, lists, getFilteredTasks, tasks: allTasks } = useTaskStore()
  const [editTask, setEditTask] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const tasks = getFilteredTasks(selectedList)
  const pending = tasks.filter((t) => !t.completed)
  // Reminders are listed with everything else but aren't something left to do.
  const remaining = pending.filter((t) => !isReminder(t)).length
  const done = tasks.filter((t) => t.completed)
  const [showDone, setShowDone] = useState(false)

  // Today also lists what is coming next, soonest first, so future tasks and calendar events aren't hidden.
  const tomorrow = addDays(startOfToday(), 1)
  const upcoming = selectedList !== 'today' ? [] : allTasks
    .filter((t) => !t.completed && dueDateTime(t) >= tomorrow)
    .sort((a, b) => dueDateTime(a) - dueDateTime(b))
  const openEdit = (t) => { setEditTask(t); setShowModal(true) }

  const listLabel =
    VIEW_LABELS[selectedList] ||
    lists.find((l) => l.id === selectedList)?.name ||
    'Tasks'

  const listColor =
    selectedList === 'today' ? '#4772FA'
    : selectedList === 'scheduled' ? '#FF6B6B'
    : lists.find((l) => l.id === selectedList)?.color || '#6B7280'

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 pb-28">
        <div className="pt-12 pb-4">
          <h1 className="text-2xl font-bold" style={{ color: listLabel === 'All Tasks' ? '#1F2937' : listColor }}>
            {listLabel}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {remaining} task{remaining !== 1 ? 's' : ''} remaining
          </p>
        </div>

        {pending.length === 0 && done.length === 0 && upcoming.length > 0 && (
          <p className="text-sm text-gray-400 pb-2">Nothing due today.</p>
        )}

        {pending.length === 0 && done.length === 0 && upcoming.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 size={48} className="text-gray-200 mb-3" />
            <p className="text-gray-400 font-medium">All clear!</p>
            <p className="text-gray-300 text-sm mt-1">Tap + to add a task</p>
          </div>
        )}

        {pending.map((task) => (
          <TaskItem key={task.id} task={task} onEdit={openEdit} />
        ))}

        {upcoming.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 font-medium mb-2">Upcoming ({upcoming.length})</p>
            {upcoming.map((task) => (
              <TaskItem key={task.id} task={task} onEdit={openEdit} />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowDone(!showDone)}
              className="text-xs text-gray-400 font-medium mb-2 flex items-center gap-1">
              {showDone ? '▾' : '▸'} Completed ({done.length})
            </button>
            {showDone && done.map((task) => (
              <TaskItem key={task.id} task={task} onEdit={openEdit} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddTaskModal
          editTask={editTask}
          onClose={() => { setShowModal(false); setEditTask(null) }}
        />
      )}
    </>
  )
}
