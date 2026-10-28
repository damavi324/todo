import { registerPlugin } from '@capacitor/core'

/**
 * Native CallSession plugin (Android).
 * Keeps the app alive while a call is going (screen locked or app in the background),
 * shows an ongoing call notification with a Hang up button, routes call audio to the
 * earpiece or speaker, and raises a heads-up alert when Pilot needs an answer.
 */
const CallSession = registerPlugin('CallSession', {
  web: () => import('./CallSession.web').then((m) => new m.CallSessionWeb()),
})

export default CallSession
