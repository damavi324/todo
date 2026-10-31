import { useTaskStore } from '../store/useTaskStore'
import { syncReminders, requestNotificationPermission } from './notifications'
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  calendarActive,
  reportCalendarError,
} from './googleCalendar'

/**
 * Create a task, or update `editTask`, then bring Google Calendar and the reminders in line with it.
 * Returns the saved task.
 */
export async function saveTask(taskData, editTask) {
  const { addTask, updateTask, settings } = useTaskStore.getState()

  let task
  if (editTask) {
    updateTask(editTask.id, taskData)
    task = { ...editTask, ...taskData }
  } else {
    task = addTask({ ...taskData, googleEventId: null })
  }

  // Tasks imported from Google Calendar follow the calendar; they are not pushed back.
  if (calendarActive() && task.source !== 'calendar') {
    try {
      if (!task.dueDate) {
        // Undated to-dos stay off the calendar. If the date was just removed, remove the event too.
        if (task.googleEventId) {
          await deleteCalendarEvent(task.googleEventId, settings.googleCalendarId).catch((e) => {
            if (!/not found|deleted/i.test(e?.message || '')) throw e
          })
          updateTask(task.id, { googleEventId: null })
        }
      } else if (task.googleEventId) {
        await updateCalendarEvent(task.googleEventId, task, settings.googleCalendarId)
      } else {
        const eventId = await createCalendarEvent(task, settings.googleCalendarId)
        updateTask(task.id, { googleEventId: eventId })
      }
    } catch (e) {
      reportCalendarError(e)
    }
  }

  if (task.dueDate) await requestNotificationPermission()
  await syncReminders()
  return task
}
