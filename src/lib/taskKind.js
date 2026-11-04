/**
 * Every item is either a task or a reminder. A task stays, and keeps alerting, until it is marked done.
 * A reminder only tells you something is happening: it alerts once, has nothing to tick off, and goes
 * away when its day is over. Calendar events come in as reminders unless they've been changed to tasks.
 */
export function isReminder(task) {
  if (task?.kind) return task.kind === 'reminder'
  return task?.source === 'calendar'
}

// A booking kept after its day (one made on a call) stays this long to look up, then goes like any reminder.
const KEEP_DAYS = 14

/** A reminder whose time to show is over: the day after its date, or KEEP_DAYS later for a kept booking. */
export function reminderGone(task, today, due) {
  if (!isReminder(task) || !due) return false
  if (!task.retain) return due < today
  const until = new Date(due)
  until.setDate(until.getDate() + KEEP_DAYS)
  return until < today
}
