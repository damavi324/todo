// Reads a spoken call request ("Call the dentist at 214 555 0100 and move my cleaning to next week")
// into the call form's fields: who to call, and what the call is for.

const WORD_DIGIT = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }
const TOKEN = '(?:\\d+|zero|oh|one|two|three|four|five|six|seven|eight|nine)'
// A run of digits and digit words, as speech-to-text writes a number: "(214) 555-0100", "214 555 0100",
// "two one four five five five...", "+44 20 7946 0958".
const RUN = new RegExp(`(?:\\+|\\bplus\\s+)?\\(?\\b${TOKEN}\\b(?:[\\s().,-]*\\b${TOKEN}\\b)*`, 'gi')
const TOKENS = new RegExp(`\\b${TOKEN}\\b`, 'gi')

const toDigits = (token) => WORD_DIGIT[token.toLowerCase()] ?? token

/** True for a number the server can dial: 10 digits, 11 starting with 1, or an international +number. */
function dialable(digits, international) {
  if (international) return digits.length >= 8 && digits.length <= 15
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

/**
 * The first phone number in the text, and where it was. Spoken numbers can run into what follows
 * ("... 0100 9 am"), so the longest leading part that dials is used.
 */
export function findPhoneNumber(text) {
  for (const m of String(text || '').matchAll(RUN)) {
    const international = /^(\+|plus)/i.test(m[0])
    const tokens = [...m[0].matchAll(TOKENS)]
    for (let n = tokens.length; n > 0; n--) {
      const digits = tokens.slice(0, n).map((t) => toDigits(t[0])).join('')
      if (!dialable(digits, international)) continue
      const last = tokens[n - 1]
      const end = m.index + last.index + last[0].length
      const number = international ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`
      return { number, start: m.index, end }
    }
  }
  return null
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const mentions = (lower, name) => new RegExp(`\\b${escape(name)}\\b`).test(lower)
// First words of contact names that are too common to mean one person.
const NOT_A_NAME = new Set(['the', 'my', 'and', 'for', 'call', 'mrs', 'miss', 'doctor', 'new', 'old', 'home', 'work', 'office'])

/**
 * The contact named in what was said: the longest full name that appears, or else a first name that
 * only one person has ("call John" when there's one John). Their mobile number is preferred.
 */
function contactNamed(text, contacts) {
  const lower = text.toLowerCase()
  const usable = contacts.filter((c) => c?.name && c.phone)
  const mobileFirst = (list) => list.find((c) => /mobile|cell/i.test(c.label || '')) || list[0]
  const full = usable.filter((c) => mentions(lower, c.name.toLowerCase()))
  if (full.length) {
    const longest = Math.max(...full.map((c) => c.name.length))
    return mobileFirst(full.filter((c) => c.name.length === longest))
  }
  const byFirst = usable.filter((c) => {
    const first = c.name.toLowerCase().split(/\s+/)[0]
    return first.length >= 3 && !NOT_A_NAME.has(first) && mentions(lower, first)
  })
  const people = new Set(byFirst.map((c) => c.name.toLowerCase()))
  return people.size === 1 ? mobileFirst(byFirst) : null
}

/**
 * Split a spoken request into { to, contact, note, mode }.
 * to: the number heard (E.164), or the number of a saved contact named in it. '' when neither.
 * note: what the call is about, with the number taken out.
 * mode: 'copilot' when you said you'll do the talking, otherwise null (leave it as it was).
 */
export function parseSpokenCall(text, contacts = []) {
  const said = String(text || '').trim()
  const found = findPhoneNumber(said)
  let note = said
  if (found) {
    note = `${said.slice(0, found.start)} ${said.slice(found.end)}`
      // "at <number> to move…" leaves a dangling "at": drop it, and the words naming the number.
      .replace(/\s+(?:at|on)\s+(?:the\s+)?(?:phone\s+)?(?:number\s+)?(?=(?:and|to|about|for)\b|[,.!?]|\s*$)/gi, ' ')
      .replace(/\b(?:the\s+)?(?:phone\s+)?number\s*(?=(?:and|to)\b|[,.!?]|\s*$)/gi, ' ')
      // "Call <number> and ask…" → "Ask…"
      .replace(/^\s*(?:please\s+)?(?:(?:can|could) you\s+)?(?:call|ring|phone|dial)\s+(?:up\s+)?(?:and|to)\s+/i, '')
      .replace(/^\s*(?:please\s+)?(?:call|ring|phone|dial)\s*[,.!?]*\s*$/i, '')
  }
  note = capitalize(note.replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.]+/, '').replace(/\s+/g, ' ').trim())

  const named = found ? null : contactNamed(said, contacts)

  const copilot = /\b(?:i(?:'ll| will)\s+(?:do the\s+)?talk(?:ing)?|let me (?:talk|speak)|i(?:'ll| will)\s+speak|i want to talk)\b/i.test(said)
  return {
    to: found?.number || named?.phone || '',
    contact: named?.name || '',
    note,
    mode: copilot ? 'copilot' : null,
  }
}
