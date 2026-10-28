import { WebPlugin } from '@capacitor/core'

// Browser fallback: no foreground service; alerts use the Notification API when allowed.
export class CallSessionWeb extends WebPlugin {
  async start() {}
  async update() {}
  async stop() {}
  async setSpeaker() { return { on: false } }
  async clearAlert() {}
  async alert({ title, text }) {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') await Notification.requestPermission().catch(() => {})
    if (Notification.permission === 'granted' && document.hidden) new Notification(title, { body: text })
  }
}
