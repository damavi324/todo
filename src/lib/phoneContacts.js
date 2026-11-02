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

// Words people say around a name ("my wife Pooja", "Pooja (wife)") that aren't part of it.
const RELATIONS = new Set(['my', 'the', 'wife', 'husband', 'mom', 'mum', 'mother', 'dad', 'father', 'son', 'daughter',
  'brother', 'sister', 'friend', 'boss', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'miss', 'aunt', 'uncle', 'grandma', 'grandpa',
  'cousin', 'partner', 'girlfriend', 'boyfriend', 'office', 'call', 'phone', 'ring'])

/** Spelling-tolerant form of a name word: Pooja = Puja, Shree = Shri, Bhattarai = Battarai, Matthew = Mathew. */
export function nameKey(word) {
  return String(word || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/([bcdgjkpst])h/g, '$1').replace(/w/g, 'v')
    .replace(/oo|ou/g, 'u').replace(/ee|ie|y$/g, 'i').replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1')
}

const words = (text) => String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z\u00c0-\u024f]+/).filter(Boolean)
/** The words of what was said that could be part of a name. */
const nameWords = (text) => words(text).filter((w) => !RELATIONS.has(w)).map(nameKey).filter((k) => k.length >= 2)

function close(a, b) {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false
  // One letter added, dropped or changed.
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/** Relationship words said with the name ("wife") that a contact's notes or label mention. */
const relationHint = (text, c) => String(text || '').toLowerCase().split(/[^a-z]+/).some((w) => RELATIONS.has(w) && w.length > 3 && new RegExp(`\\b${w}\\b`, 'i').test(`${c.notes || ''} ${c.label || ''}`))

/**
 * The one person a name means, forgiving spelling and extra words: "Pooja (wife)" finds "Puja Khanal".
 * An exact name wins; otherwise every name word said must match a word of the contact's name. A person with
 * several numbers counts once (their mobile number is used); two different people means no answer.
 */
export function pickByName(contacts, text) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  const exact = contacts.filter((c) => c.name.toLowerCase() === q)
  let found = exact
  if (!found.length) {
    const said = nameWords(q)
    if (!said.length) return null
    found = contacts.filter((c) => {
      const name = nameWords(c.name)
      return said.every((w) => name.some((n) => close(w, n)))
    })
    // Still two people (two Poojas): the one whose notes say "wife", if you said that.
    if (new Set(found.map((c) => c.name.toLowerCase())).size > 1) {
      const hinted = found.filter((c) => relationHint(q, c))
      if (hinted.length) found = hinted
    }
  }
  if (new Set(found.map((c) => c.name.toLowerCase())).size !== 1) return null
  return found.find((c) => /mobile|cell/i.test(c.label || '')) || found[0]
}

/** Contacts whose names sound like a word in what was said, for the assistant to choose from (names only). */
export function likelyContacts(contacts, text, max = 12) {
  const said = nameWords(text)
  if (!said.length) return []
  const names = new Set()
  for (const c of contacts) {
    if (nameWords(c.name).some((n) => said.some((w) => close(w, n)))) names.add(c.name)
    if (names.size >= max) break
  }
  return [...names]
}
