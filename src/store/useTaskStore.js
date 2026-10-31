import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseLocalDate, startOfToday, addDays, dueDateTime } from '../lib/dates'
import { isReminder } from '../lib/taskKind'

const DEFAULT_LISTS = [
  { id: 'inbox', name: 'Inbox', color: '#4772FA' },
  { id: 'personal', name: 'Personal', color: '#FF6B6B' },
  { id: 'work', name: 'Work', color: '#4ECDC4' },
]

const DEFAULT_SETTINGS = {
  notificationStyle: 'sticky',
  notificationRepeatMinutes: 10,
  voiceRemindersEnabled: true,
  userName: 'MK',
  // Empty means the phone's best voice for its language.
  voiceName: '',
  voicePitch: 1,
  // Standing facts Pilot may use on every call. The note on a single call stays on that call.
  callerName: '',
  callerAbout: '',
  googleCalendarEnabled: false,
  googleCalendarId: 'primary',
  // Android only: read upcoming events from the phone's calendar instead of from Google.
  phoneCalendarEnabled: false,
  phoneCalendarHiddenIds: [],
  // Calling server (CallPilot)
  callpilotUrl: '',
  callpilotToken: '',
  callpilotConnected: false,
  callpilotOwner: '',
  callpilotAssistant: 'Pilot',
  callpilotProblems: [],
}

export const useTaskStore = create(
  persist(
    (set, get) => ({
      tasks: [],
      lists: DEFAULT_LISTS,
      selectedList: 'today',
      // Which screen is showing: the task lists or Calls.
      appView: 'tasks',
      settings: DEFAULT_SETTINGS,
      // Calendar events the user removed from the app; never re-imported.
      dismissedEventIds: [],
      calendarError: '',

      addTask: (task) => {
        const created = {
          ...task,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          completed: false,
        }
        set((s) => ({ tasks: [created, ...s.tasks] }))
        return created
      },

      updateTask: (id, changes) => set((s) => ({
        tasks: s.tasks.map((t) => t.id === id ? { ...t, ...changes } : t),
      })),

      deleteTask: (id) => set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
      })),

      toggleTask: (id) => set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id
            ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : null }
            : t
        ),
      })),

      completeTask: (id) => set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id && !t.completed
            ? { ...t, completed: true, completedAt: new Date().toISOString() }
            : t
        ),
      })),

      // A reminder has nothing to finish, so once its day is over it is simply removed.
      dropPastReminders: () => set((s) => {
        const today = startOfToday()
        const kept = s.tasks.filter((t) => !(isReminder(t) && t.dueDate && parseLocalDate(t.dueDate) < today))
        return kept.length === s.tasks.length ? s : { tasks: kept }
      }),

      dismissCalendarEvent: (eventId) => set((s) => ({
        dismissedEventIds: [...s.dismissedEventIds.filter((e) => e !== eventId), eventId].slice(-500),
      })),

      setCalendarError: (message) => set({ calendarError: message || '' }),

      addList: (name, color) => set((s) => ({
        lists: [...s.lists, { id: crypto.randomUUID(), name, color }],
      })),

      deleteList: (id) => set((s) => ({
        lists: s.lists.filter((l) => l.id !== id),
        tasks: s.tasks.filter((t) => t.listId !== id),
        selectedList: s.selectedList === id ? 'inbox' : s.selectedList,
      })),

      setSelectedList: (id) => set({ selectedList: id, appView: 'tasks' }),

      setAppView: (view) => set({ appView: view }),

      updateSettings: (changes) => set((s) => ({
        settings: { ...s.settings, ...changes },
      })),

      getFilteredTasks: (listId) => {
        const { tasks } = get()
        const today = startOfToday()
        const tomorrow = addDays(today, 1)

        if (listId === 'today') {
          // Today's items, plus any task that is overdue and still open.
          return tasks.filter((t) => {
            const due = parseLocalDate(t.dueDate)
            return due && due < tomorrow && (due >= today || (!t.completed && !isReminder(t)))
          })
        }
        if (listId === 'scheduled') {
          return tasks
            .filter((t) => t.dueDate && !t.completed)
            .sort((a, b) => dueDateTime(a) - dueDateTime(b))
        }
        if (listId === 'all') {
          return tasks
        }
        return tasks.filter((t) => t.listId === listId)
      },
    }),
    {
      name: 'todo-store',
      partialize: (s) => ({
        tasks: s.tasks,
        lists: s.lists,
        selectedList: s.selectedList,
        settings: s.settings,
        dismissedEventIds: s.dismissedEventIds,
      }),
      // Keep defaults for settings added after the data was first saved.
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        settings: { ...current.settings, ...(persisted?.settings || {}) },
      }),
    }
  )
)
