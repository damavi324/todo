import { create } from 'zustand'
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut } from 'firebase/auth'
import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { cloud, isCloudConfigured } from './firebase'
import { useTaskStore, DEFAULT_LISTS, DEFAULT_SETTINGS } from '../store/useTaskStore'
import { syncReminders } from './notifications'

/**
 * Keeps tasks, lists and shared settings the same on every device signed in to the same Google account.
 *
 * The local store stays the app's working copy, so everything works offline and while signed out.
 * While signed in, every local change is written to Firestore (queued in its offline cache when there is
 * no connection), and every change from another device is applied to the local store.
 *
 * Data lives under users/{uid}/: tasks/{id}, lists/{id} and meta/profile.
 */

// Settings that follow the person. The rest describe this device (its voices, its calendar, its Google
// Calendar sign-in) and stay local.
const SHARED_SETTINGS = [
  'notificationStyle',
  'notificationRepeatMinutes',
  'voiceRemindersEnabled',
  'userName',
  'callerName',
  'callerAbout',
  'googleCalendarId',
  'callpilotUrl',
  'callpilotToken',
  'callpilotConnected',
  'callpilotOwner',
  'callpilotAssistant',
]

const pickShared = (settings) =>
  Object.fromEntries(SHARED_SETTINGS.filter((k) => k in settings).map((k) => [k, settings[k]]))

// The account whose data is on this device. Local items are only uploaded into that same account, so
// signing in with a different account never mixes two people's tasks.
const LAST_UID_KEY = 'cloud-last-uid'
const knownKey = (uid, name) => `cloud-known:${uid}:${name}`

/** What the account screen shows: 'off' | 'signed-out' | 'connecting' | 'synced' | 'pending' | 'offline' | 'error'. */
export const useSyncStore = create(() => ({ status: isCloudConfigured() ? 'signed-out' : 'off', email: '', error: '' }))
const setStatus = (status, extra = {}) => useSyncStore.setState({ status, error: '', ...extra })

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full or blocked */ }
}

// Firestore takes plain data only.
const plain = (value) => JSON.parse(JSON.stringify(value))

let applyingRemote = false
let remindersTimer = null

/** Apply a change that came from the cloud without echoing it back. */
function applyRemote(changes) {
  applyingRemote = true
  try {
    useTaskStore.setState(changes)
  } finally {
    applyingRemote = false
  }
  // Another device may have added, moved or finished something with a reminder.
  clearTimeout(remindersTimer)
  remindersTimer = setTimeout(() => syncReminders().catch(console.error), 500)
}

function reportError(error) {
  console.error(error)
  setStatus('error', { email: useSyncStore.getState().email, error: error?.message || 'Sync failed' })
}

/**
 * Mirror one array of the store (tasks or lists) to a Firestore collection.
 * Returns a function that stops it.
 */
function mirrorCollection(db, uid, name, { select, order, mayUpload, starter = [] }) {
  const ref = collection(db, 'users', uid, name)
  let known = new Set(readJSON(knownKey(uid, name)) || [])
  let merged = false
  let skipped = false

  const stopCloud = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    updateStatus(snap.metadata)
    // Until the server has answered once, the cache may be empty or stale, so the local copy stands.
    if (!merged && snap.metadata.fromCache) return
    // This device's own writes, not yet confirmed. Applying them could undo a newer local change, so
    // wait for the server's copy, which always follows.
    if (merged && snap.metadata.hasPendingWrites) { skipped = true; return }
    if (merged && !skipped && snap.docChanges().length === 0) return
    skipped = false

    const cloudItems = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]))

    if (!merged) {
      merged = true
      // Items made on this device before it synced go up. Items the cloud once had but no longer has
      // were deleted on another device, so they are dropped here too.
      const batch = writeBatch(db)
      let uploads = 0
      for (const item of select(useTaskStore.getState())) {
        if (cloudItems.has(item.id) || known.has(item.id) || !mayUpload) continue
        batch.set(doc(ref, item.id), plain(item))
        cloudItems.set(item.id, item)
        uploads += 1
      }
      // A brand-new account gets the starter items (the default lists).
      if (cloudItems.size === 0) {
        for (const item of starter) {
          batch.set(doc(ref, item.id), plain(item))
          cloudItems.set(item.id, item)
          uploads += 1
        }
      }
      if (uploads) batch.commit().catch(reportError)
    }

    known = new Set(cloudItems.keys())
    writeJSON(knownKey(uid, name), [...known])
    applyRemote({ [name]: order([...cloudItems.values()]) })
  }, reportError)

  const stopLocal = useTaskStore.subscribe((state, prev) => {
    if (applyingRemote) return
    const next = select(state)
    const before = select(prev)
    if (next === before) return
    const beforeById = new Map(before.map((i) => [i.id, i]))
    const ids = new Set()
    for (const item of next) {
      ids.add(item.id)
      // Store updates replace only the objects they change, so an unchanged object is the same object.
      if (beforeById.get(item.id) !== item) setDoc(doc(ref, item.id), plain(item)).catch(reportError)
    }
    for (const id of beforeById.keys()) {
      if (!ids.has(id)) deleteDoc(doc(ref, id)).catch(reportError)
    }
  })

  return () => { stopCloud(); stopLocal() }
}

/** Mirror the shared settings and the dismissed calendar events to users/{uid}/meta/profile. */
function mirrorProfile(db, uid, { mayUpload }) {
  const ref = doc(db, 'users', uid, 'meta', 'profile')
  const pick = pickShared
  const upload = (s) => setDoc(ref, plain({ settings: pick(s.settings), dismissedEventIds: s.dismissedEventIds }), { merge: true })
  let merged = false

  const stopCloud = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    if (!merged && snap.metadata.fromCache) return
    // Our own unconfirmed write: applying it mid-typing could drop letters. The server's copy follows.
    if (merged && snap.metadata.hasPendingWrites) return
    const first = !merged
    merged = true
    const data = snap.data()
    if (!data) {
      if (first && mayUpload) upload(useTaskStore.getState()).catch(reportError)
      return
    }
    const s = useTaskStore.getState()
    applyRemote({
      settings: { ...s.settings, ...pick(data.settings || {}) },
      dismissedEventIds: data.dismissedEventIds || s.dismissedEventIds,
    })
  }, reportError)

  const stopLocal = useTaskStore.subscribe((state, prev) => {
    if (applyingRemote || !merged) return
    const settingsChanged = SHARED_SETTINGS.some((k) => state.settings[k] !== prev.settings[k])
    if (settingsChanged || state.dismissedEventIds !== prev.dismissedEventIds) upload(state).catch(reportError)
  })

  return () => { stopCloud(); stopLocal() }
}

function updateStatus(metadata) {
  const { status, email } = useSyncStore.getState()
  if (status === 'error') return
  const next = metadata.fromCache ? 'offline' : metadata.hasPendingWrites ? 'pending' : 'synced'
  if (next !== status) setStatus(next, { email })
}

const byNewest = (items) => items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
// Inbox first, then lists in the order they were made.
const listOrder = (items) => items.sort((a, b) =>
  (a.id === 'inbox' ? -1 : b.id === 'inbox' ? 1 : 0) ||
  String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
  a.name.localeCompare(b.name)
)

let stopSync = null

function begin(user) {
  stopSync?.()
  const { db } = cloud()
  const lastUid = localStorage.getItem(LAST_UID_KEY)
  const mayUpload = !lastUid || lastUid === user.uid
  if (!mayUpload) {
    // A different account: start from its data, not the previous account's, including its name and
    // calling setup.
    const { settings } = useTaskStore.getState()
    applyRemote({ tasks: [], lists: [], dismissedEventIds: [], settings: { ...settings, ...pickShared(DEFAULT_SETTINGS) } })
  }
  try { localStorage.setItem(LAST_UID_KEY, user.uid) } catch { /* ignore */ }
  setStatus('connecting', { email: user.email || '' })

  const stops = [
    mirrorCollection(db, user.uid, 'tasks', { select: (s) => s.tasks, order: byNewest, mayUpload }),
    mirrorCollection(db, user.uid, 'lists', { select: (s) => s.lists, order: listOrder, mayUpload, starter: DEFAULT_LISTS }),
    mirrorProfile(db, user.uid, { mayUpload }),
  ]
  stopSync = () => { stops.forEach((stop) => stop()); stopSync = null }
}

/** Start following the signed-in account. Call once when the app starts. */
export function startCloudSync() {
  if (!isCloudConfigured()) return () => {}
  const { auth } = cloud()
  return onAuthStateChanged(auth, (user) => {
    if (user) begin(user)
    else {
      stopSync?.()
      setStatus('signed-out')
    }
  })
}

/** Sign in to sync with the Google account the app just signed in with. */
export async function cloudSignIn({ idToken, accessToken }) {
  if (!isCloudConfigured()) return
  if (!idToken && !accessToken) throw new Error('Google did not return a sign-in token for sync')
  const { auth } = cloud()
  await signInWithCredential(auth, GoogleAuthProvider.credential(idToken || null, accessToken || null))
}

export async function cloudSignOut() {
  if (!isCloudConfigured()) return
  await signOut(cloud().auth)
}

export function cloudSignedIn() {
  return isCloudConfigured() && !!cloud().auth.currentUser
}
