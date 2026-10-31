import { addDays, dueDateTime, parseLocalDate, startOfToday } from './dates'
import { isReminder } from './taskKind'

/** The fixed views. Lists are addressed by their own id. 'scheduled' is kept as the id for Upcoming. */
export const SMART_VIEWS = [
  { id: 'today', name: 'Today' },
  { id: 'scheduled', name: 'Upcoming' },
  { id: 'all', name: 'All tasks' },
]

export function viewName(viewId, lists) {
  return SMART_VIEWS.find((v) => v.id === viewId)?.name || lists.find((l) => l.id === viewId)?.name || 'Tasks'
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 }

// Soonest first; undated last; then the more important one.
function byDue(a, b) {
  const da = dueDateTime(a)
  const db = dueDateTime(b)
  if (da && db && da - db !== 0) return da - db
  if (!da !== !db) return da ? -1 : 1
  return (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
}

const dayLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

/**
 * The open items of a view, in labelled groups, plus its finished ones.
 * Reminders whose day has passed are left out: there is nothing left to do about them.
 */
export function groupView(viewId, tasks) {
  const today = startOfToday()
  const tomorrow = addDays(today, 1)
  const weekEnd = addDays(today, 7)
  const due = (t) => parseLocalDate(t.dueDate)
  const overdue = (t) => due(t) && due(t) < today && !isReminder(t)

  const inView = viewId === 'today' || viewId === 'scheduled' || viewId === 'all'
    ? tasks
    : tasks.filter((t) => t.listId === viewId)
  const open = inView.filter((t) => !t.completed && !(isReminder(t) && due(t) && due(t) < today)).sort(byDue)
  const done = inView
    .filter((t) => t.completed)
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))

  const groups = []
  const add = (key, label, items, tone) => { if (items.length) groups.push({ key, label, items, tone }) }

  if (viewId === 'today') {
    add('overdue', 'Overdue', open.filter(overdue), 'danger')
    add('today', 'Today', open.filter((t) => due(t) && due(t) >= today && due(t) < tomorrow))
    add('next', 'Next 7 days', open.filter((t) => due(t) && due(t) >= tomorrow && due(t) < weekEnd))
    return { groups, done: done.filter((t) => due(t) && due(t) >= today && due(t) < tomorrow) }
  }

  if (viewId === 'scheduled') {
    const dated = open.filter((t) => due(t))
    add('overdue', 'Overdue', dated.filter(overdue), 'danger')
    add('today', 'Today', dated.filter((t) => due(t) >= today && due(t) < tomorrow))
    add('tomorrow', 'Tomorrow', dated.filter((t) => due(t) >= tomorrow && due(t) < addDays(today, 2)))
    for (let i = 2; i < 7; i++) {
      const day = addDays(today, i)
      add(`d${i}`, dayLabel(day), dated.filter((t) => due(t) >= day && due(t) < addDays(day, 1)))
    }
    add('later', 'Later', dated.filter((t) => due(t) >= weekEnd))
    return { groups, done: [] }
  }

  add('overdue', 'Overdue', open.filter(overdue), 'danger')
  add('today', 'Today', open.filter((t) => due(t) && due(t) >= today && due(t) < tomorrow))
  add('upcoming', 'Upcoming', open.filter((t) => due(t) && due(t) >= tomorrow))
  add('someday', 'No date', open.filter((t) => !due(t)))
  return { groups, done }
}

/** How many things are left to do in a view (reminders aren't counted). */
export function openCount(viewId, tasks) {
  const tomorrow = addDays(startOfToday(), 1)
  const todo = tasks.filter((t) => !t.completed && !isReminder(t))
  if (viewId === 'today') return todo.filter((t) => t.dueDate && parseLocalDate(t.dueDate) < tomorrow).length
  if (viewId === 'scheduled') return todo.filter((t) => t.dueDate).length
  if (viewId === 'all') return todo.length
  return todo.filter((t) => t.listId === viewId).length
}

export const PRIORITY_COLOR = { high: '#E5484D', medium: '#F59E0B', low: '#3B82F6' }
