import { Capacitor } from '@capacitor/core'
import { useTaskStore } from '../store/useTaskStore'
import VoiceReminder from '../plugins/VoiceReminder'
import { dueDateTime } from './dates'

const isNative = () => Capacitor.isNativePlatform()

function notificationIdFor(taskId) {
  let hash = 0
  const s = String(taskId)
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 2147483646) + 1
}

export function spokenText(title, name, again = false) {
  const hey = name ? `Hey ${name}, ` : ''
  if (again) return `${hey}reminding you again: ${title} is still pending.`
  const lead = hey ? `${hey}you have a reminder` : 'You have a reminder'
  return `${lead}: ${title}.`
}

export async function requestNotificationPermission() {
  if (isNative()) {
    const result = await VoiceReminder.requestPermissions()
    return result.notifications === 'granted'
  }
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export async function requestVoiceReminderPermissions() {
  if (isNative()) return VoiceReminder.requestPermissions()
  const granted = await requestNotificationPermission()
  return { notifications: granted ? 'granted' : 'denied', exactAlarms: 'granted' }
}

/**
 * Single entry point: make the scheduled reminders match the current tasks and settings.
 * Call after any change to tasks or notification settings.
 */
export async function syncReminders() {
  const { tasks, settings } = useTaskStore.getState()
  const pending = tasks.filter((t) => !t.completed && t.dueDate)

  if (isNative()) {
    const reminders = pending.map((t) => ({
      id: notificationIdFor(t.id),
      taskId: t.id,
      at: dueDateTime(t).getTime(),
      title: t.title || 'Reminder',
      body: t.notes || '',
    }))
    await VoiceReminder.sync({
      reminders,
      sticky: settings.notificationStyle === 'sticky',
      repeatMinutes: Number(settings.notificationRepeatMinutes) || 0,
      speak: settings.voiceRemindersEnabled !== false,
      name: (settings.userName || '').trim(),
    })
    return
  }

  syncWebTimers(pending)
}

/** Apply "Mark Done" taps made on notifications while the app was closed or in the background. */
export async function applyNotificationCompletions() {
  if (!isNative()) return
  const { taskIds = [] } = await VoiceReminder.consumeCompleted()
  if (taskIds.length === 0) return
  const { completeTask } = useTaskStore.getState()
  taskIds.forEach((id) => completeTask(id))
  await syncReminders()
}

// ---- Browser fallback (only while the tab is open) ----

const webTimers = new Map()

function syncWebTimers(pending) {
  webTimers.forEach((timer) => clearTimeout(timer))
  webTimers.clear()
  const now = Date.now()
  for (const task of pending) {
    const delay = dueDateTime(task).getTime() - now
    if (delay <= 0 || delay > 2147483647) continue
    webTimers.set(task.id, setTimeout(() => fireWebNotification(task.id, false), delay))
  }
}

function fireWebNotification(taskId, again) {
  const { tasks, settings } = useTaskStore.getState()
  const task = tasks.find((t) => t.id === taskId)
  if (!task || task.completed) return

  if (settings.voiceRemindersEnabled !== false && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(
      new SpeechSynthesisUtterance(spokenText(task.title, (settings.userName || '').trim(), again))
    )
  }

  const sticky = settings.notificationStyle === 'sticky'
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(task.title, {
      body: task.notes || 'Due now',
      tag: task.id,
      requireInteraction: sticky,
    })
  }

  const repeat = Number(settings.notificationRepeatMinutes) || 0
  if (sticky && repeat > 0) {
    webTimers.set(task.id, setTimeout(() => fireWebNotification(taskId, true), repeat * 60 * 1000))
  }
}
