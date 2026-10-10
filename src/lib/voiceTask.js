import { toLocalYMD } from './dates'

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim()
const GEMINI_MODEL = 'gemini-2.5-flash'

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
    'dueDate is YYYY-MM-DD or an empty string when no day was mentioned.',
    'dueTime is HH:mm in 24-hour time or an empty string when no time was mentioned.',
    'priority is one of none, low, medium, high.',
    'title is the task itself, without the date and time words.',
    `Spoken text: ${text}`,
  ].join('\n')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
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

function localParse(text) {
  const now = new Date()
  let dueDate = ''
  const lower = text.toLowerCase()
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    dueDate = toLocalYMD(d)
  } else if (/\btoday\b/.test(lower)) {
    dueDate = toLocalYMD(now)
  }

  let dueTime = ''
  const at = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/)
  if (at) {
    let hour = Number(at[1])
    const minute = at[2] || '00'
    const meridiem = (at[3] || '').replace(/\./g, '')
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    if (!meridiem && hour >= 1 && hour <= 7) hour += 12
    if (hour >= 0 && hour <= 23) dueTime = `${String(hour).padStart(2, '0')}:${minute}`
  }

  const title = text
    .replace(/\b(today|tomorrow)\b/ig, '')
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/ig, '')
    .replace(/\s+/g, ' ')
    .trim()

  return normalize({ title: title || text, notes: '', dueDate, dueTime, priority: 'none' }, text)
}

function normalize(parsed, fallbackTitle) {
  const priority = ['none', 'low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'none'
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate || '') ? parsed.dueDate : ''
  const dueTime = /^\d{2}:\d{2}$/.test(parsed.dueTime || '') ? parsed.dueTime : ''
  return {
    title: String(parsed.title || fallbackTitle).trim() || fallbackTitle,
    notes: String(parsed.notes || '').trim(),
    dueDate,
    dueTime,
    priority,
  }
}
