// Names you corrected once: "Pursue Di" was Parshu Dai. The next time speech-to-text hears it the same way, it goes
// straight to that contact. Kept in settings, so every signed-in device learns it.
import { useTaskStore } from '../store/useTaskStore'
import { heardKey, isUSNumber } from './phoneContacts'

const MAX = 200

/** Remembers that `heard` meant the contact named `name` (nothing when they're the same). */
export function rememberAlias(heard, name) {
  const key = heardKey(heard)
  const to = String(name || '').trim()
  if (!key || !to || key === heardKey(to)) return
  const { settings, updateSettings } = useTaskStore.getState()
  const kept = Object.entries(settings.contactAliases || {}).filter(([k]) => k !== key).slice(-(MAX - 1))
  updateSettings({ contactAliases: Object.fromEntries([...kept, [key, to]]) })
}

/** The contact a heard name was corrected to before, if it still has a US number. */
export function aliasFor(contacts, heard) {
  const name = (useTaskStore.getState().settings.contactAliases || {})[heardKey(heard)]
  if (!name) return null
  const found = contacts.filter((c) => c.name.trim().toLowerCase() === name.toLowerCase() && isUSNumber(c.phone))
  return found.find((c) => /mobile|cell/i.test(c.label || '')) || found[0] || null
}

/** The corrections, as "heard = contact" lines for the assistant. */
export const aliasLines = () => Object.entries(useTaskStore.getState().settings.contactAliases || {}).slice(-50).map(([k, v]) => `${k} = ${v}`)
