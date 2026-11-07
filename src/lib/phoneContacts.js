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

/**
 * A US (North American, +1) number: 10 digits, or 11 starting with 1. A number written with another country
 * code (+977…, 00 44…) is not. Calls only go to these, so contact matching ignores every other number.
 */
export function isUSNumber(phone) {
  const raw = String(phone || '').trim()
  let d = raw.replace(/\D/g, '')
  if (raw.startsWith('00')) d = d.slice(2)
  // Written with a country code: only +1 is ours.
  if (/^(\+|00)/.test(raw) && !(d.length === 11 && d.startsWith('1'))) return false
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  // North American numbers: neither the area code nor the exchange starts with 0 or 1 (so a Nepali 984-123…
  // mobile saved without +977 isn't taken for one).
  return d.length === 10 && /^[2-9]\d{2}[2-9]/.test(d)
}
const usOnly = (contacts) => contacts.filter((c) => isUSNumber(c.phone))

/** The app's own contacts, then the phone's, without listing a number twice. */
export function mergeContacts(appContacts, phone) {
  const known = new Set(appContacts.map((c) => digits(c.phone)))
  return [...appContacts, ...phone.filter((c) => !known.has(digits(c.phone)))]
}

// Words people say around a name ("my wife Pooja", "Pooja (wife)") that aren't part of it.
const RELATIONS = new Set(['my', 'the', 'wife', 'husband', 'mom', 'mum', 'mother', 'mommy', 'mama', 'dad', 'father', 'daddy', 'papa', 'son', 'daughter',
  'brother', 'sister', 'friend', 'boss', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'miss', 'aunt', 'uncle', 'grandma', 'grandpa',
  'cousin', 'partner', 'girlfriend', 'boyfriend', 'hubby', 'office', 'call', 'phone', 'ring'])

// "Call my mother" and "call Mom" are the same contact.
const SAME_PERSON = { mum: 'mom', mother: 'mom', mommy: 'mom', mama: 'mom', father: 'dad', daddy: 'dad', papa: 'dad', hubby: 'husband' }
const relationToken = (w) => SAME_PERSON[w] || w

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

// Nepali forms of address said with a name ("Parshu Dai", "Sita Di"). They tell people apart, so they are never
// treated as the same: Dai (older brother) is not Di (older sister). Spellings of one form share a key.
const HONORIFICS = { dai: 'dai', daai: 'dai', daju: 'dai', dajyu: 'dai', dajoo: 'dai', di: 'di', didi: 'di', didee: 'di',
  bhai: 'bhai', bahini: 'bahini', baini: 'bahini', ji: 'ji', jee: 'ji', kaka: 'kaka', kaki: 'kaki', bhauju: 'bhauju',
  bhinaju: 'bhinaju', bhena: 'bhinaju', sir: 'sir', aunty: 'aunty', auntie: 'aunty', anti: 'aunty' }
const honorific = (w) => HONORIFICS[w] || ''

/**
 * How a name word sounds, roughly: its first letter, then its consonants. Speech-to-text gets vowels wrong far more
 * than consonants ("Pursue" for "Parshu": both p-r-s).
 */
export function soundKey(word) {
  const k = nameKey(word)
  return (k[0] || '') + k.slice(1).replace(/[aeiouy]/g, '')
}

const words = (text) => String(text || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z\u00c0-\u024f]+/).filter(Boolean)
/** The words of what was said that could be part of a name. */
const nameWords = (text) => words(text).filter((w) => !RELATIONS.has(w) && !honorific(w)).map(nameKey).filter((k) => k.length >= 2)
/** The forms of address in a name or in what was said, as keys (dai, di, ...). */
const honorifics = (text) => words(text).map(honorific).filter(Boolean)

// Titles and filler. A contact can actually be named Mom or Wife, so those stay available as names.
const NOT_A_NAME = new Set(['my', 'the', 'call', 'phone', 'ring', 'office', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'miss'])

/** A contact whose whole name is a word like Mom or Wife, when that word was said. */
function namedByRelation(contacts, text) {
  const said = words(text).filter((w) => RELATIONS.has(w) && !NOT_A_NAME.has(w)).map(relationToken)
  if (!said.length) return []
  const hits = contacts.filter((c) => {
    const name = words(c.name).filter((w) => !NOT_A_NAME.has(w))
    return name.length === 1 && said.includes(relationToken(name[0]))
  })
  const people = [...new Set(hits.map((c) => c.name.toLowerCase()))]
  if (people.length !== 1) return []
  return hits.filter((c) => c.name.toLowerCase() === people[0])
}

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
  if (max > 0 && edits(a, b, max) <= max) return true
  // Same consonants in the same order, vowels misheard: Pursue = Parshu, Kesab = Keshav. Needs three consonants,
  // so short names (Ram, Rima) don't all sound alike.
  const sa = soundKey(a)
  const sb = soundKey(b)
  return sa.length >= 3 && (sa === sb || (sa.length >= 4 && sb.length >= 4 && edits(sa, sb, 1) <= 1))
}

/** Relationship words said with the name ("wife") that a contact's notes or label mention. */
const relationHint = (text, c) => String(text || '').toLowerCase().split(/[^a-z]+/).some((w) => RELATIONS.has(w) && w.length > 3 && new RegExp(`\\b${w}\\b`, 'i').test(`${c.notes || ''} ${c.label || ''}`))

/**
 * How well a contact's name fits the words said: how many of its words were heard (exact ones count more),
 * and what share of the name and of what was said they cover. 0 = no fit.
 */
function fit(c, said, saidForms = []) {
  const name = nameWords(c.name)
  if (!name.length) return { score: 0 }
  // A form of address said and saved agrees (Dai and Dai) or differs (Di said, Dai saved): a nudge, not a match.
  const forms = honorifics(c.name)
  const form = forms.length && saidForms.length ? (forms.some((x) => saidForms.includes(x)) ? 0.5 : -0.4) : 0
  const hit = name.filter((n) => said.some((w) => close(w, n))).length
  if (!hit) return { score: 0 }
  const exact = name.filter((n) => said.includes(n)).length
  const saidHit = said.filter((w) => name.some((n) => close(w, n))).length
  return { score: hit + exact * 0.5 + hit / name.length + saidHit / said.length + form, hit, exact, ofName: hit / name.length, ofSaid: saidHit / said.length, size: name.length, shortest: Math.min(...name.map((n) => n.length)) }
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
export function pickByName(allContacts, text, { inSpeech = false } = {}) {
  // Only US numbers can be called: a person with several numbers is matched on their US one, others not at all.
  const contacts = usOnly(allContacts)
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  let found = contacts.filter((c) => c.name.toLowerCase() === q)
  if (!found.length) {
    const said = nameWords(q)
    const forms = honorifics(q)
    if (!said.length) {
      const named = namedByRelation(contacts, q)
      if (!named.length) return null
      return named.find((c) => /mobile|cell/i.test(c.label || '')) || named[0]
    }
    const ok = (f) => f.score > 0 && (inSpeech
      ? (f.size === 1 ? f.exact === 1 && f.shortest >= 4 : f.hit >= 2 && f.ofName >= 0.6)
      // Most of the words said belong to the name ("Kesar Raz Pandey" -> 3 of 3), not just one common word.
      : f.ofSaid >= (said.length >= 3 ? 0.6 : 0.99) || (f.ofName === 1 && f.size >= 2))
    // Best fit per person (one name, possibly several numbers).
    const best = new Map()
    for (const c of contacts) {
      const f = fit(c, said, forms)
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
    if (!ranked.length) {
      const named = namedByRelation(contacts, q)
      if (!named.length) return null
      return named.find((c) => /mobile|cell/i.test(c.label || '')) || named[0]
    }
    found = contacts.filter((c) => c.name.toLowerCase() === ranked[0].name)
  }
  if (new Set(found.map((c) => c.name.toLowerCase())).size !== 1) return null
  return found.find((c) => /mobile|cell/i.test(c.label || '')) || found[0]
}

/** Contacts whose names sound like words in what was said, best fit first, for the assistant to choose from (names only). */
export function likelyContacts(allContacts, text, max = 12) {
  const contacts = usOnly(allContacts)
  const said = nameWords(text)
  const forms = honorifics(text)
  const best = new Map()
  for (const c of namedByRelation(contacts, text)) best.set(c.name, 10)
  if (said.length) {
    for (const c of contacts) {
      const { score } = fit(c, said, forms)
      if (score > (best.get(c.name) || 0)) best.set(c.name, score)
    }
  }
  if (!best.size) return []
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name)
}

/** Contacts for a name typed in the call form: names containing it first, then ones that sound like it. */
export function searchContacts(allContacts, text, max = 8) {
  const contacts = usOnly(allContacts)
  const q = String(text || '').trim().toLowerCase()
  const direct = contacts.filter((c) => c.name.toLowerCase().includes(q))
  if (direct.length >= max) return direct.slice(0, max)
  const sounds = new Set(likelyContacts(contacts, q, max))
  return [...direct, ...contacts.filter((c) => sounds.has(c.name) && !direct.includes(c))].slice(0, max)
}

/**
 * Another contact with the same name but a different form of address ("Parshu Di" for "Parshu Dai"). Speech-to-text
 * mixes these up, so a call to either is checked with you first.
 */
export function honorificTwin(allContacts, contact) {
  if (!contact) return null
  const core = nameWords(contact.name).join(' ')
  const forms = honorifics(contact.name).join(' ')
  const name = contact.name.trim().toLowerCase()
  return usOnly(allContacts).find((c) => c.name.trim().toLowerCase() !== name && nameWords(c.name).join(' ') === core && honorifics(c.name).join(' ') !== forms) || null
}

/** Every callable (US) contact name, once each: the best guesses for what was said first, then everyone else. */
export function contactNames(allContacts, text, max = 2000) {
  const first = likelyContacts(allContacts, text)
  return [...new Set([...first, ...usOnly(allContacts).map((c) => c.name.trim()).filter(Boolean)])].slice(0, max)
}

/** The key a heard name is remembered under: its words, spelling-tolerant, forms of address kept as said. */
export const heardKey = (text) => words(text).filter((w) => !NOT_A_NAME.has(w)).map((w) => honorific(w) || nameKey(w)).filter(Boolean).join(' ')
