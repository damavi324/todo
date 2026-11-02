/**
 * Web OAuth client ID from Google Cloud Console (public; safe to ship in the app).
 * Set in `.env.local` as VITE_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
 *
 * You still create an Android OAuth client in the same project (package
 * com.todo.voice + SHA-1) — that ID is NOT pasted into the app; Google matches it
 * via the signing certificate.
 */
// The Web client of the todo-88bb6 project, the same one android/app/google-services.json lists.
// Used when .env.local doesn't set one, so builds without .env.local (like GitHub's) can still sign in.
const APP_PROJECT_WEB_CLIENT_ID = '1045816829488-ntelsjmkgkacjhdm219p28nodme5vrun.apps.googleusercontent.com'
export const GOOGLE_PROJECT_NUMBER = '1045816829488'

// Firebase only accepts Google tokens from its own project's clients, and Android sign-in needs the Web
// and Android clients in one project. A Web client ID from another project (an old .env.local) can never
// work, so it is ignored in favour of this project's.
const envWebClientId = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim()
if (envWebClientId && !envWebClientId.startsWith(`${GOOGLE_PROJECT_NUMBER}-`)) {
  console.warn(`VITE_GOOGLE_WEB_CLIENT_ID is not from project ${GOOGLE_PROJECT_NUMBER} (todo-88bb6); using that project's Web client instead.`)
}
export const GOOGLE_WEB_CLIENT_ID = envWebClientId.startsWith(`${GOOGLE_PROJECT_NUMBER}-`)
  ? envWebClientId
  : APP_PROJECT_WEB_CLIENT_ID

export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
]

export function isGoogleAuthConfigured() {
  return GOOGLE_WEB_CLIENT_ID.length > 0
}

/**
 * Google only signs in an Android app when the Web client and the Android client (package + SHA-1)
 * live in the same Cloud project. A client ID starts with its project number, so a mismatch shows here.
 */
export function webClientMatchesAppProject() {
  return GOOGLE_WEB_CLIENT_ID.startsWith(`${GOOGLE_PROJECT_NUMBER}-`)
}
