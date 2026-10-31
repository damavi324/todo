import { WebPlugin } from '@capacitor/core'

// The browser path is handled by timers in src/lib/notifications.js.
export class VoiceReminderWeb extends WebPlugin {
  async sync() {}

  // Browsers get reminders from the open tab instead of pushes.
  async getPushToken() {
    throw this.unavailable('Push reminders are for the Android app')
  }

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

  async getVoices() {
    if (!('speechSynthesis' in window)) return { voices: [] }
    let list = window.speechSynthesis.getVoices()
    if (list.length === 0) {
      // Browsers load the voice list in the background; wait briefly for it.
      await new Promise((resolve) => {
        window.speechSynthesis.addEventListener('voiceschanged', resolve, { once: true })
        setTimeout(resolve, 1000)
      })
      list = window.speechSynthesis.getVoices()
    }
    const language = (navigator.language || 'en').split('-')[0]
    return {
      voices: list
        .filter((v) => v.lang.split('-')[0] === language)
        .map((v) => ({ id: v.voiceURI, name: v.name, locale: v.lang })),
    }
  }

  async announce({ text, voice, pitch }) {
    if (!('speechSynthesis' in window)) throw new Error('This browser cannot speak')
    const utterance = new SpeechSynthesisUtterance(text)
    const chosen = voice && window.speechSynthesis.getVoices().find((v) => v.voiceURI === voice)
    if (chosen) utterance.voice = chosen
    utterance.pitch = pitch || 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }
}
