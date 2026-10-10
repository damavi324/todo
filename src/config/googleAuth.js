/**
 * Web OAuth client ID from Google Cloud Console (public; safe to ship in the app).
 * Set in `.env.local` as VITE_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
 *
 * You still create an Android OAuth client in the same project (package
 * com.todo.voice + SHA-1) — that ID is NOT pasted into the app; Google matches it
 * via the signing certificate.
 */
export const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim()

export const CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
]

export function isGoogleAuthConfigured() {
  return GOOGLE_WEB_CLIENT_ID.length > 0
}
