self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event
  const taskId = notification.data?.taskId

  notification.close()

  if (action === 'done' && taskId) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'COMPLETE_TASK', taskId }))
        if (clients.length > 0) clients[0].focus()
        else self.clients.openWindow('/')
      })
    )
  } else if (action === 'snooze' && taskId) {
    setTimeout(() => {
      self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon,
        tag: notification.tag,
        requireInteraction: true,
        actions: notification.actions,
        data: notification.data,
      })
    }, 10 * 60 * 1000)
  } else {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) clients[0].focus()
        else self.clients.openWindow('/')
      })
    )
  }
})

self.addEventListener('notificationclose', (event) => {
  // Intentionally empty — closing notification does NOT complete the task
})
