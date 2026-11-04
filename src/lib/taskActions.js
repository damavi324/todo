import { useTaskStore } from '../store/useTaskStore'
import { syncReminders } from './notifications'
import { deleteCalendarEvent, calendarActive, reportCalendarError } from './googleCalendar'
import { useCallStore } from '../store/useCallStore'
import { saveTask } from './saveTask'

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

/** Delete a task, with an Undo button on the toast in case it was a mis-tap. */
export async function deleteWithUndo(task) {
  await removeTask(task)
  useCallStore.getState().notify(`Deleted “${task.title}”`, 'info', { label: 'Undo', run: () => restoreTask(task).catch(console.error) })
}

/** Put a deleted task back, with its reminder and (for the app's own tasks) a new calendar event. */
async function restoreTask(task) {
  if (task.source === 'calendar') {
    useTaskStore.getState().restoreTask(task)
    return syncReminders()
  }
  const restored = { ...task, googleEventId: null }
  useTaskStore.getState().restoreTask(restored)
  await saveTask({}, restored)
}

/** Hand the task's attached call to the assistant. A saved plan is dialed as-is, after a short countdown you can cancel. */
export function startTaskCall(task) {
  const c = task.call || {}
  const mode = c.mode || 'agent'
  const brief = [c.contact && `Calling: ${c.contact}`, c.details, task.notes].filter(Boolean).join('\n')
  const goal = c.goal || task.title
  const live = useCallStore.getState()
  if (live.view === 'active' && live.session) {
    live.notify('Finish the call you’re on, then start this one.')
    useTaskStore.getState().setAppView('calls')
    return
  }
  if (c.plan && mode === 'agent' && c.to) {
    useCallStore.setState({
      pending: { mode, to: c.to, goal, brief, plan: c.plan },
      view: 'plan',
      handsFree: true,
      summary: null,
      detail: null,
      session: null,
      question: null,
      status: null,
      lines: [],
      agentState: null,
    })
  } else {
    useCallStore.getState().setDraft({ mode, to: c.to || '', goal, brief })
  }
  useTaskStore.getState().setAppView('calls')
}
