// Due dates are stored as 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` parses as UTC,
// which lands on the previous day in timezones behind UTC, so always parse locally.
export function parseLocalDate(ymd) {
  if (!ymd) return null
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function toLocalYMD(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toLocalHM(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Moment a task is due. Tasks with a date but no time are due at 9:00 AM. */
export function dueDateTime(task) {
  const due = parseLocalDate(task?.dueDate)
  if (!due) return null
  if (task.dueTime) {
    const [h, m] = task.dueTime.split(':').map(Number)
    due.setHours(h, m, 0, 0)
  } else {
    due.setHours(9, 0, 0, 0)
  }
  return due
}

/** Short label for a due date: "Today 17:00", "Tomorrow", "Oct 14 09:30". */
export function formatDue(date, time) {
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
