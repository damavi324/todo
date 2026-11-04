import { useTaskStore } from '../store/useTaskStore'
import { saveTask } from './saveTask'
import { formatNumber, assistantName } from './callpilot'
import { toLocalYMD, toLocalHM, addDays } from './dates'
import { phoneContacts } from './phoneContacts'

const digits = (phone) => String(phone || '').replace(/\D/g, '').slice(-10)

/** The saved contact (or, failing that, the phone contact) for a phone number, matched on its last 10 digits. */
export function contactFor(phone) {
  const d = digits(phone)
  if (d.length < 7) return null
  return useTaskStore.getState().contacts.find((c) => digits(c.phone) === d)
    || phoneContacts().find((c) => digits(c.phone) === d)
    || null
}

/** Who a call was with: the contact's name, or the formatted number. */
export function callWith(call) {
  return contactFor(call?.to)?.name || formatNumber(call?.to) || call?.to || 'Unknown number'
}

const source = (call) => `From ${assistantName()}'s call with ${callWith(call)}`

/** Something booked on the call: it alerts once at its time, and stays in the list so you can look it up afterward. */
export function addAppointment(appt, call) {
  return saveTask({
    title: appt.title,
    notes: source(call),
    dueDate: appt.date,
    dueTime: appt.time || '',
    priority: 'none',
    listId: 'inbox',
    kind: 'reminder',
    retain: true,
  })
}

/** A follow-up the call left for the owner, due when the call said it was. */
export function addFollowUp(item, call) {
  return saveTask({
    title: item.title,
    notes: source(call),
    dueDate: item.date || '',
    dueTime: item.date ? item.time || '' : '',
    priority: 'none',
    listId: 'inbox',
    kind: 'task',
  })
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** When to try again: in an hour, tomorrow morning, or the day and time they named (9:00 when no hour was said). */
export function callbackTime(when, time) {
  const now = new Date()
  if (when === '1h') {
    const at = new Date(now.getTime() + 60 * 60 * 1000)
    at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0)
    return { dueDate: toLocalYMD(at), dueTime: toLocalHM(at) }
  }
  const clock = CLOCK.test(time) ? time : '09:00'
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return { dueDate: when, dueTime: clock }
  return { dueDate: toLocalYMD(addDays(now, 1)), dueTime: clock }
}

/**
 * A task to make the call again later. It carries the call, so when it comes due one tap hands it back to
 * the assistant with the same number and details.
 */
export function scheduleCallback(call, when, time) {
  const contact = contactFor(call.to)
  return saveTask({
    title: `Call ${callWith(call)} again`,
    notes: call.goal || '',
    ...callbackTime(when, time),
    priority: 'none',
    listId: 'inbox',
    kind: 'task',
    call: {
      to: call.to,
      contact: contact?.name || '',
      goal: call.goal || '',
      details: call.brief || '',
      mode: call.mode || 'agent',
      // The plan from this call, so the reminder dials with it instead of writing a new one.
      plan: call.plan || null,
    },
  })
}
