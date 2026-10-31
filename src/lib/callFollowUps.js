import { useTaskStore } from '../store/useTaskStore'
import { saveTask } from './saveTask'
import { formatNumber, assistantName } from './callpilot'
import { toLocalYMD, toLocalHM, addDays } from './dates'

const digits = (phone) => String(phone || '').replace(/\D/g, '').slice(-10)

/** The saved contact for a phone number, matched on its last 10 digits. */
export function contactFor(phone) {
  const d = digits(phone)
  if (d.length < 7) return null
  return useTaskStore.getState().contacts.find((c) => digits(c.phone) === d) || null
}

/** Who a call was with: the contact's name, or the formatted number. */
export function callWith(call) {
  return contactFor(call?.to)?.name || formatNumber(call?.to) || call?.to || 'Unknown number'
}

const source = (call) => `From ${assistantName()}'s call with ${callWith(call)}`

/** Something booked on the call: it alerts once at its time and goes on the calendar like any dated task. */
export function addAppointment(appt, call) {
  return saveTask({
    title: appt.title,
    notes: source(call),
    dueDate: appt.date,
    dueTime: appt.time || '',
    priority: 'none',
    listId: 'inbox',
    kind: 'reminder',
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

/** When to try again: in an hour, tomorrow morning, or 9:00 on a given day. */
export function callbackTime(when) {
  const now = new Date()
  if (when === '1h') {
    const at = new Date(now.getTime() + 60 * 60 * 1000)
    at.setMinutes(Math.ceil(at.getMinutes() / 5) * 5, 0, 0)
    return { dueDate: toLocalYMD(at), dueTime: toLocalHM(at) }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return { dueDate: when, dueTime: '09:00' }
  return { dueDate: toLocalYMD(addDays(now, 1)), dueTime: '09:00' }
}

/**
 * A task to make the call again later. It carries the call, so when it comes due one tap hands it back to
 * the assistant with the same number and details.
 */
export function scheduleCallback(call, when) {
  const contact = contactFor(call.to)
  return saveTask({
    title: `Call ${callWith(call)} again`,
    notes: call.goal || '',
    ...callbackTime(when),
    priority: 'none',
    listId: 'inbox',
    kind: 'task',
    call: { to: call.to, contact: contact?.name || '', goal: call.goal || '', details: call.brief || '', mode: call.mode || 'agent' },
  })
}
