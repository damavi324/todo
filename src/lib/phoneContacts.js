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

/**
 * Spelling-tolerant form of a name word: Pooja = Puja, Shree = Shri, Bhattarai = Battarai, Matthew = Mathew,
 * Raj = Raz (speech-to-text often hears j as z), Keshav = Kesav.
 */
export function nameKey(word) {
  return String(word || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/([bcdgjkpst])h/g, '$1').replace(/w/g, 'v')
    .replace(/ck|q/g, 'k').replace(/c(?=[aou]|$)/g, 'k').replace(/z/g, 'j')
    .replace(/oo|ou/g, 'u').replace(/ee|ie|y$/g, 'i').replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1')
}

const words = (text) => String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z\u00c0-\u024f]+/).filter(Boolean)
/** The words of what was said that could be part of a name. */
const nameWords = (text) => words(text).filter((w) => !RELATIONS.has(w)).map(nameKey).filter((k) => k.length >= 2)

/** Letters added, dropped, changed or swapped to turn a into b (stops counting past max). */
function edits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (prev2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1)
    }
    if (Math.min(...row) > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

/** Two name words that are probably the same name, misheard or spelled differently. Longer words forgive more. */
function close(a, b) {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  const short = Math.min(a.length, b.length)
  // Three-letter words (Raj, Ram, Ana) get one slip only when the first letter agrees.
  const max = short >= 7 ? 2 : short >= 4 ? 1 : short === 3 && a[0] === b[0] ? 1 : 0
  return max > 0 && edits(a, b, max) <= max
}

/** Relationship words said with the name ("wife") that a contact's notes or label mention. */
const relationHint = (text, c) => String(text || '').toLowerCase().split(/[^a-z]+/).some((w) => RELATIONS.has(w) && w.length > 3 && new RegExp(`\\b${w}\\b`, 'i').test(`${c.notes || ''} ${c.label || ''}`))

/**
 * How well a contact's name fits the words said: how many of its words were heard (exact ones count more),
 * and what share of the name and of what was said they cover. 0 = no fit.
 */
function fit(c, said) {
  const name = nameWords(c.name)
  if (!name.length) return { score: 0 }
  const hit = name.filter((n) => said.some((w) => close(w, n))).length
  if (!hit) return { score: 0 }
  const exact = name.filter((n) => said.includes(n)).length
  const saidHit = said.filter((w) => name.some((n) => close(w, n))).length
  return { score: hit + exact * 0.5 + hit / name.length + saidHit / said.length, hit, exact, ofName: hit / name.length, ofSaid: saidHit / said.length, size: name.length, shortest: Math.min(...name.map((n) => n.length)) }
}

/**
 * The one person a name means, forgiving spelling, mishearing and extra words: "Pooja (wife)" finds
 * "Puja Khanal", "Kesar Raz Pandey" finds "Keshab Raj Pandey". An exact name wins; otherwise the contact whose
 * name best fits what was said, as long as it clearly beats anyone else. A person with several numbers counts
 * once (their mobile number is used).
 *
 * inSpeech: text is a whole spoken sentence ("call Keshab and ask..."), so most of it is not a name. Then a
 * contact needs at least two of its name words heard (or its one-word name heard exactly).
 */
export function pickByName(contacts, text, { inSpeech = false } = {}) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  let found = contacts.filter((c) => c.name.toLowerCase() === q)
  if (!found.length) {
    const said = nameWords(q)
    if (!said.length) return null
    const ok = (f) => f.score > 0 && (inSpeech
      ? (f.size === 1 ? f.exact === 1 && f.shortest >= 4 : f.hit >= 2 && f.ofName >= 0.6)
      // Most of the words said belong to the name ("Kesar Raz Pandey" -> 3 of 3), not just one common word.
      : f.ofSaid >= (said.length >= 3 ? 0.6 : 0.99) || (f.ofName === 1 && f.size >= 2))
    // Best fit per person (one name, possibly several numbers).
    const best = new Map()
    for (const c of contacts) {
      const f = fit(c, said)
      if (!ok(f)) continue
      const key = c.name.toLowerCase()
      if (!best.has(key) || best.get(key).score < f.score) best.set(key, { score: f.score, name: key })
    }
    let ranked = [...best.values()].sort((a, b) => b.score - a.score)
    // Two people fit about as well (two Poojas): the one whose notes say "wife", if you said that.
    if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.5) {
      const tied = ranked.filter((r) => ranked[0].score - r.score < 0.5)
      const hinted = tied.filter((r) => contacts.some((c) => c.name.toLowerCase() === r.name && relationHint(q, c)))
      if (hinted.length !== 1) return null
      ranked = hinted
    }
    if (!ranked.length) return null
    found = contacts.filter((c) => c.name.toLowerCase() === ranked[0].name)
  }
  if (new Set(found.map((c) => c.name.toLowerCase())).size !== 1) return null
  return found.find((c) => /mobile|cell/i.test(c.label || '')) || found[0]
}

/** Contacts whose names sound like words in what was said, best fit first, for the assistant to choose from (names only). */
export function likelyContacts(contacts, text, max = 12) {
  const said = nameWords(text)
  if (!said.length) return []
  const best = new Map()
  for (const c of contacts) {
    const { score } = fit(c, said)
    if (score > (best.get(c.name) || 0)) best.set(c.name, score)
  }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name)
}

/** Contacts for a name typed in the call form: names containing it first, then ones that sound like it. */
export function searchContacts(contacts, text, max = 8) {
  const q = String(text || '').trim().toLowerCase()
  const direct = contacts.filter((c) => c.name.toLowerCase().includes(q))
  if (direct.length >= max) return direct.slice(0, max)
  const sounds = new Set(likelyContacts(contacts, q, max))
  return [...direct, ...contacts.filter((c) => sounds.has(c.name) && !direct.includes(c))].slice(0, max)
}
