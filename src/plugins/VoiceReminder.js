import { registerPlugin } from '@capacitor/core'

/**
 * Native VoiceReminder plugin (Android).
 * Schedules exact alarms that show a notification and speak via TTS.
 */
const VoiceReminder = registerPlugin('VoiceReminder', {
  web: () => import('./VoiceReminder.web').then((m) => new m.VoiceReminderWeb()),
})

export default VoiceReminder
