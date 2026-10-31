import { test } from 'node:test'
import assert from 'node:assert/strict'
import { notificationIdFor, reminderMessage, dueMillis } from './reminder.js'

const NOW = Date.parse('2026-10-30T20:00:00Z')

test('same notification id as the app', () => {
  // Values computed with the app's notificationIdFor (src/lib/notifications.js).
  assert.equal(notificationIdFor('abc'), 96355)
  assert.equal(notificationIdFor('cal-evt_1'), Math.abs(notificationIdFor('cal-evt_1')))
})

test('due time is read in the phone time zone; no time means 9:00', () => {
  assert.equal(dueMillis({ dueDate: '2026-11-03', dueTime: '09:00' }, 'America/Chicago'), Date.parse('2026-11-03T15:00:00Z'))
  assert.equal(dueMillis({ dueDate: '2026-11-03' }, 'America/Chicago'), Date.parse('2026-11-03T15:00:00Z'))
  assert.equal(dueMillis({ dueDate: 'next tuesday' }, 'America/Chicago'), null)
})

test('a future task becomes a reminder push with string values', () => {
  const m = reminderMessage('t1', { title: 'Dentist', notes: 'Bring card', dueDate: '2026-11-03', dueTime: '09:00', kind: 'reminder' }, 'America/Chicago', NOW)
  assert.deepEqual(m, {
    type: 'reminder', id: String(notificationIdFor('t1')), taskId: 't1', at: String(Date.parse('2026-11-03T15:00:00Z')),
    title: 'Dentist', body: 'Bring card', once: 'true', quiet: 'false',
  })
  assert.ok(Object.values(m).every((v) => typeof v === 'string'))
})

test('done, deleted, undated or past tasks remove the reminder', () => {
  const id = String(notificationIdFor('t1'))
  assert.deepEqual(reminderMessage('t1', undefined, 'UTC', NOW), { type: 'remove', id })
  assert.deepEqual(reminderMessage('t1', { dueDate: '2026-11-03', completed: true }, 'UTC', NOW), { type: 'remove', id })
  assert.deepEqual(reminderMessage('t1', { dueDate: '' }, 'UTC', NOW), { type: 'remove', id })
  assert.deepEqual(reminderMessage('t1', { dueDate: '2026-10-29', dueTime: '10:00' }, 'UTC', NOW), { type: 'remove', id })
})

test('all-day calendar reminders alert quietly, tasks keep alerting', () => {
  assert.equal(reminderMessage('c', { source: 'calendar', dueDate: '2026-11-05' }, 'UTC', NOW).quiet, 'true')
  const task = reminderMessage('t', { dueDate: '2026-11-05', dueTime: '08:00' }, 'UTC', NOW)
  assert.equal(task.once, 'false')
  assert.equal(task.quiet, 'false')
})
