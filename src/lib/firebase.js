import { initializeApp } from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore'

/**
 * Firebase web config from the Firebase console (Project settings → Your apps → Web app).
 * These values identify the project; they are not secrets. Access is limited by firestore.rules.
 */
const config = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
}

export function isCloudConfigured() {
  return !!(config.apiKey && config.projectId && config.appId)
}

let services = null

/** The Firebase app, auth and database, created on first use. */
export function cloud() {
  if (!isCloudConfigured()) throw new Error('Firebase is not set up: add the VITE_FIREBASE_* values to .env.local')
  if (!services) {
    const app = initializeApp(config)
    // Sign-in comes from a Google credential, so no popup or redirect handler is loaded. Those hang in
    // the Android WebView.
    const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
    // The local cache is what makes the app work offline: reads come from it and writes queue in it.
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    })
    // `npm run dev:emulator` points the app at the local Firebase emulators instead of the real project.
    const emulatorHost = (import.meta.env.VITE_FIREBASE_EMULATOR || '').trim()
    if (emulatorHost) {
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
      connectFirestoreEmulator(db, emulatorHost, 8080)
    }
    services = { app, auth, db }
  }
  return services
}
