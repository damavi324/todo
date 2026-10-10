import { WebPlugin } from '@capacitor/core'

// The browser path is handled by timers in src/lib/notifications.js.
export class VoiceReminderWeb extends WebPlugin {
  async sync() {}

  async consumeCompleted() {
    return { taskIds: [] }
  }

  async requestPermissions() {
    if (!('Notification' in window)) {
      return { notifications: 'denied', exactAlarms: 'denied' }
    }
    const result = await Notification.requestPermission()
    return {
      notifications: result === 'granted' ? 'granted' : 'denied',
      exactAlarms: 'granted',
    }
  }

  async checkPermissions() {
    const notifications =
      !('Notification' in window)
        ? 'denied'
        : Notification.permission === 'granted'
          ? 'granted'
          : Notification.permission === 'denied'
            ? 'denied'
            : 'prompt'
    return { notifications, exactAlarms: 'granted' }
  }

  async openExactAlarmSettings() {}
}
