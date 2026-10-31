/**
 * Every item is either a task or a reminder. A task stays, and keeps alerting, until it is marked done.
 * A reminder only tells you something is happening: it alerts once, has nothing to tick off, and goes
 * away when its day is over. Calendar events come in as reminders unless they've been changed to tasks.
 */
export function isReminder(task) {
  if (task?.kind) return task.kind === 'reminder'
  return task?.source === 'calendar'
}
