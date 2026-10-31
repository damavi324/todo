import { toLocalYMD } from './dates'

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim()
const GEMINI_MODEL = 'gemini-2.5-flash'
const TASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    notes: { type: 'STRING' },
    dueDate: { type: 'STRING' },
    dueTime: { type: 'STRING' },
    priority: { type: 'STRING', enum: ['none', 'low', 'medium', 'high'] },
  },
  required: ['title', 'notes', 'dueDate', 'dueTime', 'priority'],
}

export function isGeminiConfigured() {
  return GEMINI_API_KEY.length > 0
}

/**
 * Turn a spoken sentence into task fields.
 * Uses Gemini when an API key is built into the app, otherwise a small local parser.
 */
export async function parseSpokenTask(transcript) {
  const text = (transcript || '').trim()
  if (!text) throw new Error('Nothing was heard')
  if (isGeminiConfigured()) {
    try {
      return await parseWithGemini(text)
    } catch (error) {
      const fallback = localParse(text)
      fallback.notes = fallback.notes || `Heard: ${text}`
      fallback.parseWarning = error.message
      return fallback
    }
  }
  return localParse(text)
}

async function parseWithGemini(text) {
  const now = new Date()
  const prompt = [
    'Turn this spoken reminder into a task.',
    `Today is ${toLocalYMD(now)} (${now.toLocaleDateString('en-US', { weekday: 'long' })}).`,
    `The local time is ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}.`,
    'Return JSON only with keys title, notes, dueDate, dueTime, priority.',
    'dueDate is YYYY-MM-DD. When a time was mentioned but no day, use today, or tomorrow if that time has already passed today.',
    'dueDate is an empty string only when neither a day nor a time was mentioned.',
    'dueTime is HH:mm in 24-hour time or an empty string when no time was mentioned.',
    'priority is one of none, low, medium, high.',
    'title is the task itself, without the date and time words and without lead-ins like "remind me to".',
    `Spoken text: ${text}`,
  ].join('\n')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      // Sent as a header rather than ?key= so the key stays out of URLs and logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: TASK_SCHEMA,
        },
      }),
    }
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body.slice(0, 160) || `Gemini error ${res.status}`)
  }

  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
  const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, '').trim())
  return normalize(parsed, text)
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAY = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?'
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'

/**
 * Reads the usual ways of saying when: today, tomorrow, tonight, (next) Friday, this weekend, next week,
 * in 3 days, Nov 5, 5 Nov, 11/5; at 5, 9am, 5:30pm, noon. Each matched phrase is taken out of the title.
 */
function localParse(text) {
  const now = new Date()
  let rest = ` ${text} `
  let date = null
  let dueTime = ''
  let priority = 'none'

  const take = (re, fn) => {
    const m = rest.match(re)
    if (!m) return false
    fn(m)
    rest = rest.replace(m[0], ' ')
    return true
  }
  const day = (offset) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d }

  // Priority words.
  take(/\s(!!!?|urgent(ly)?|asap|high priority|important)(?=[\s.,!?])/i, () => { priority = 'high' })
  take(/\s(medium priority)(?=[\s.,!?])/i, () => { priority = 'medium' })
  take(/\s(low priority)(?=[\s.,!?])/i, () => { priority = 'low' })

  // The day.
  take(/\s(?:on\s+)?(today|tonight|this evening)(?=[\s.,!?])/i, (m) => {
    date = day(0)
    if (/tonight|evening/i.test(m[1])) dueTime = '20:00'
  }) ||
  take(/\s(?:on\s+)?(tomorrow|tmrw?)(?=[\s.,!?])/i, () => { date = day(1) }) ||
  take(/\s(?:on\s+)?(?:this\s+)?weekend(?=[\s.,!?])/i, () => { date = day((6 - now.getDay() + 7) % 7 || 7) }) ||
  take(/\snext\s+week(?=[\s.,!?])/i, () => { date = day(((1 - now.getDay() + 7) % 7) || 7) }) ||
  take(/\sin\s+(\d+|a|an|one|two|three)\s+(day|week)s?(?=[\s.,!?])/i, (m) => {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase()] ?? Number(m[1])
    date = day(n * (/week/i.test(m[2]) ? 7 : 1))
  }) ||
  take(new RegExp(`\\s(?:on\\s+)?(next\\s+|this\\s+)?${WEEKDAY}(?=[\\s.,!?])`, 'i'), (m) => {
    const target = WEEKDAYS.findIndex((w) => w.startsWith(m[2].toLowerCase().slice(0, 3)))
    // The coming one; said on that same weekday, it means a week from today.
    date = day((target - now.getDay() + 7) % 7 || 7)
  }) ||
  take(new RegExp(`\\s(?:on\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=[\\s.,!?])`, 'i'), (m) => {
    date = dateFor(MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), now)
  }) ||
  take(new RegExp(`\\s(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}(?=[\\s.,!?])`, 'i'), (m) => {
    date = dateFor(MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1]), now)
  }) ||
  take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?=[\s.,!?])/, (m) => {
    date = dateFor(Number(m[1]) - 1, Number(m[2]), now)
  })

  // The time.
  take(/\s(?:at\s+)?(noon|midday)(?=[\s.,!?])/i, () => { dueTime = '12:00' }) ||
  take(/\s(?:at\s+)?midnight(?=[\s.,!?])/i, () => { dueTime = '00:00' }) ||
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s.,!?])/i, (m) => { dueTime = clock(m[1], m[2], m[3]) }) ||
  take(/\sat\s+(\d{1,2})(?::(\d{2}))?(?=[\s.,!?])/i, (m) => { dueTime = clock(m[1], m[2], '') }) ||
  take(/\s(?:in the\s+)?morning(?=[\s.,!?])/i, () => { dueTime = dueTime || '09:00' }) ||
  take(/\s(?:in the\s+)?afternoon(?=[\s.,!?])/i, () => { dueTime = dueTime || '15:00' })

  const cleaned = rest
    .replace(/^\s*(hey[,\s]+)?(please\s+)?(remind me( to)?|don'?t forget( to)?|i need to)\s+/i, '')
    .replace(/\s+(on|at|by)\s*$/i, '')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,!?]+$/, '')
    .trim()
  const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)

  return normalize({ title: title || text, notes: '', dueDate: date ? toLocalYMD(date) : '', dueTime, priority }, text)
}

/** 9 + 'pm' → '21:00'. A bare 1–7 means the afternoon: nobody sets "at 5" for 5 in the morning. */
function clock(hourText, minuteText, meridiemText) {
  let hour = Number(hourText)
  const minute = minuteText || '00'
  const meridiem = (meridiemText || '').toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12
  return hour <= 23 && Number(minute) < 60 ? `${String(hour).padStart(2, '0')}:${minute}` : ''
}

/** The next time that month and day come round: this year, or next year if it has passed. */
function dateFor(month, dayOfMonth, now) {
  if (month < 0 || month > 11 || dayOfMonth < 1 || dayOfMonth > 31) return null
  const d = new Date(now.getFullYear(), month, dayOfMonth)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (d < today) d.setFullYear(d.getFullYear() + 1)
  return d
}

/** The date (YYYY-MM-DD) of the next time the clock reads hh:mm: today, or tomorrow if that's passed. */
export function nextDayFor(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(':').map(Number)
  const at = new Date(now)
  at.setHours(h, m, 0, 0)
  if (at <= now) at.setDate(at.getDate() + 1)
  return toLocalYMD(at)
}

function normalize(parsed, fallbackTitle) {
  const priority = ['none', 'low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'none'
  const time = String(parsed.dueTime || '').trim().match(/^(\d{1,2}):(\d{2})$/)
  const dueTime = time && Number(time[1]) < 24 && Number(time[2]) < 60 ? `${time[1].padStart(2, '0')}:${time[2]}` : ''
  let dueDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate || '') ? parsed.dueDate : ''
  // "At 5pm" with no day means the next 5pm. Without a date the task would never get a reminder.
  if (!dueDate && dueTime) dueDate = nextDayFor(dueTime)
  return {
    title: String(parsed.title || fallbackTitle).trim() || fallbackTitle,
    notes: String(parsed.notes || '').trim(),
    dueDate,
    dueTime,
    priority,
  }
}
