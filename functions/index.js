import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'
import { reminderMessage } from './reminder.js'

initializeApp()

// Tokens FCM says are gone for good (app uninstalled, data cleared).
const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

/**
 * When a task is added, changed, finished or deleted on any device, tell the account's phones, so their
 * alarms match even while the app is closed. Each phone gets the due time in its own time zone.
 */
export const pushReminder = onDocumentWritten(
  { document: 'users/{uid}/tasks/{taskId}', region: 'us-central1' },
  async (event) => {
    const { uid, taskId } = event.params
    const before = event.data?.before?.data()
    const after = event.data?.after?.data()
    // Nothing a phone cares about changed (e.g. only the list moved).
    if (before && after && ['title', 'notes', 'dueDate', 'dueTime', 'completed', 'kind'].every((k) => before[k] === after[k])) return
    // Never had a reminder and still doesn't.
    if (!before?.dueDate && !after?.dueDate) return

    const devices = await getFirestore().collection(`users/${uid}/devices`).get()
    if (devices.empty) return

    await Promise.all(devices.docs.map(async (device) => {
      const data = reminderMessage(taskId, after, device.get('timeZone'))
      if (!data) return
      try {
        await getMessaging().send({ token: device.id, data, android: { priority: 'high', ttl: 24 * 60 * 60 * 1000 } })
      } catch (err) {
        if (DEAD_TOKEN.has(err?.code)) await device.ref.delete()
        else logger.warn('Reminder push failed', { uid, code: err?.code, message: err?.message })
      }
    }))
  }
)
