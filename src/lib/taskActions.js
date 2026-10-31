import { useTaskStore } from '../store/useTaskStore'
import { syncReminders } from './notifications'
import { deleteCalendarEvent, calendarActive, reportCalendarError } from './googleCalendar'
import { useCallStore } from '../store/useCallStore'

export function toggleDone(task) {
  useTaskStore.getState().toggleTask(task.id)
  syncReminders().catch(console.error)
}

/** Delete a task, and its Google Calendar event when the app made one. */
export async function removeTask(task) {
  const { dismissCalendarEvent, deleteTask, settings } = useTaskStore.getState()
  if (task.source === 'calendar') {
    // Came from the calendar: leave the event alone, just stop importing it.
    dismissCalendarEvent(task.googleEventId)
  } else if (task.googleEventId && calendarActive()) {
    await deleteCalendarEvent(task.googleEventId, settings.googleCalendarId).catch((e) => {
      if (!/not found|deleted/i.test(e?.message || '')) reportCalendarError(e)
    })
  }
  deleteTask(task.id)
  syncReminders().catch(console.error)
}

/** Hand the task's attached call (or the task itself) to the assistant on the Calls screen. */
export function startTaskCall(task) {
  const c = task.call || {}
  useCallStore.getState().setDraft({
    mode: c.mode || 'agent',
    to: c.to || '',
    goal: c.goal || task.title,
    brief: [c.contact && `Calling: ${c.contact}`, c.details, task.notes].filter(Boolean).join('\n'),
  })
  useTaskStore.getState().setAppView('calls')
}
