import { Capacitor } from '@capacitor/core'
import PhoneContacts from '../plugins/PhoneContacts'

// The phone's contacts, once read: [{ id, name, phone, label }].
let cache = []
let loading = null

/**
 * The phone's contacts. Asks for permission the first time; empty in a browser or when it isn't allowed.
 */
export function loadPhoneContacts() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve([])
  if (!loading) {
    loading = (async () => {
      try {
        const perm = await PhoneContacts.requestPermissions()
        if (perm?.contacts !== 'granted') {
          loading = null // ask again next time
          return []
        }
        const { contacts = [] } = await PhoneContacts.list()
        cache = contacts
        return contacts
      } catch (e) {
        console.warn('Phone contacts unavailable:', e?.message || e)
        loading = null
        return []
      }
    })()
  }
  return loading
}

/** What has been read so far, without asking. */
export const phoneContacts = () => cache

const digits = (phone) => String(phone || '').replace(/\D/g, '').slice(-10)

/** The app's own contacts, then the phone's, without listing a number twice. */
export function mergeContacts(appContacts, phone) {
  const known = new Set(appContacts.map((c) => digits(c.phone)))
  return [...appContacts, ...phone.filter((c) => !known.has(digits(c.phone)))]
}

/**
 * The one person a name means: an exact name, or the only person whose name contains it. A person with
 * several numbers counts once; their mobile number is used.
 */
export function pickByName(contacts, text) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  const exact = contacts.filter((c) => c.name.toLowerCase() === q)
  const found = exact.length ? exact : contacts.filter((c) => c.name.toLowerCase().includes(q))
  if (new Set(found.map((c) => c.name.toLowerCase())).size !== 1) return null
  return found.find((c) => /mobile|cell/i.test(c.label || '')) || found[0]
}
