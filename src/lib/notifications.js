import { useTaskStore } from '../store/useTaskStore'

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function scheduleTaskNotification(task) {
  if (!task.dueDate) return
  const { settings } = useTaskStore.getState()

  const dueTime = new Date(task.dueDate)
  if (task.dueTime) {
    const [h, m] = task.dueTime.split(':')
    dueTime.setHours(parseInt(h), parseInt(m), 0, 0)
  }

  const now = Date.now()
  const delay = dueTime.getTime() - now
  if (delay < 0) return

  const timeoutId = setTimeout(() => {
    fireNotification(task, settings)
  }, delay)

  const stored = JSON.parse(localStorage.getItem('notif-timeouts') || '{}')
  stored[task.id] = timeoutId
  localStorage.setItem('notif-timeouts', JSON.stringify(stored))
}

export function cancelTaskNotification(taskId) {
  const stored = JSON.parse(localStorage.getItem('notif-timeouts') || '{}')
  if (stored[taskId]) {
    clearTimeout(stored[taskId])
    delete stored[taskId]
    localStorage.setItem('notif-timeouts', JSON.stringify(stored))
  }
}

function fireNotification(task, settings) {
  if (Notification.permission !== 'granted') return

  const options = {
    body: task.notes || `Due now`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: task.id,
    requireInteraction: settings.notificationStyle === 'sticky',
    actions: [
      { action: 'done', title: 'Mark Done' },
      { action: 'snooze', title: 'Snooze 10m' },
    ],
    data: { taskId: task.id },
  }

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(task.title, options)
    })
  } else {
    new Notification(task.title, options)
  }

  if (settings.notificationStyle === 'sticky' && settings.notificationRepeatMinutes > 0) {
    const { tasks } = useTaskStore.getState()
    const stillPending = tasks.find((t) => t.id === task.id && !t.completed)
    if (stillPending) {
      setTimeout(() => {
        const { tasks: current, settings: s } = useTaskStore.getState()
        const t = current.find((x) => x.id === task.id)
        if (t && !t.completed) fireNotification(t, s)
      }, settings.notificationRepeatMinutes * 60 * 1000)
    }
  }
}

export function rescheduleAll() {
  const { tasks } = useTaskStore.getState()
  const now = new Date()
  tasks.filter((t) => !t.completed && t.dueDate).forEach((t) => {
    const due = new Date(t.dueDate)
    if (due > now) scheduleTaskNotification(t)
  })
}
