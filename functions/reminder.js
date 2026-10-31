import { DateTime } from 'luxon'

// These mirror the app (src/lib/notifications.js, src/lib/dates.js, src/lib/taskKind.js), so a pushed
// reminder is the same one the phone would schedule itself.

/** The phone's notification id for a task: the same hash the app uses. */
export function notificationIdFor(taskId) {
  let hash = 0
  const s = String(taskId)
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 2147483646) + 1
}

export function isReminder(task) {
  if (task?.kind) return task.kind === 'reminder'
  return task?.source === 'calendar'
}

/** When the task is due, in the phone's own time zone. Tasks with a date but no time are due at 9:00. */
export function dueMillis(task, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task?.dueDate || '')) return null
  const time = /^\d{2}:\d{2}$/.test(task.dueTime || '') ? task.dueTime : '09:00'
  const at = DateTime.fromISO(`${task.dueDate}T${time}`, { zone: timeZone || 'UTC' })
  return at.isValid ? at.toMillis() : null
}

/**
 * The push for one task change: set this reminder, or remove it. FCM data values must be strings.
 * Returns null when there is nothing to tell the phone.
 */
export function reminderMessage(taskId, task, timeZone, now = Date.now()) {
  const id = String(notificationIdFor(taskId))
  if (!task || task.completed || !task.dueDate) return { type: 'remove', id }
  const at = dueMillis(task, timeZone)
  if (!at || at <= now) return { type: 'remove', id }
  return {
    type: 'reminder',
    id,
    taskId: String(taskId),
    at: String(at),
    title: String(task.title || 'Reminder').slice(0, 200),
    body: String(task.notes || '').slice(0, 1000),
    once: String(isReminder(task)),
    quiet: String(isReminder(task) && !task.dueTime),
  }
}
