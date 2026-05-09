import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_LISTS = [
  { id: 'inbox', name: 'Inbox', color: '#4772FA' },
  { id: 'personal', name: 'Personal', color: '#FF6B6B' },
  { id: 'work', name: 'Work', color: '#4ECDC4' },
]

export const useTaskStore = create(
  persist(
    (set, get) => ({
      tasks: [],
      lists: DEFAULT_LISTS,
      selectedList: 'today',
      settings: {
        notificationStyle: 'sticky',
        notificationRepeatMinutes: 10,
        googleCalendarEnabled: false,
        googleClientId: '',
        googleCalendarId: 'primary',
      },

      addTask: (task) => set((s) => ({
        tasks: [{ ...task, id: crypto.randomUUID(), createdAt: new Date().toISOString(), completed: false }, ...s.tasks],
      })),

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

      addList: (name, color) => set((s) => ({
        lists: [...s.lists, { id: crypto.randomUUID(), name, color }],
      })),

      deleteList: (id) => set((s) => ({
        lists: s.lists.filter((l) => l.id !== id),
        tasks: s.tasks.filter((t) => t.listId !== id),
        selectedList: s.selectedList === id ? 'inbox' : s.selectedList,
      })),

      setSelectedList: (id) => set({ selectedList: id }),

      updateSettings: (changes) => set((s) => ({
        settings: { ...s.settings, ...changes },
      })),

      getFilteredTasks: (listId) => {
        const { tasks } = get()
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)

        if (listId === 'today') {
          return tasks.filter((t) => {
            if (!t.dueDate) return false
            const due = new Date(t.dueDate)
            return due >= today && due < tomorrow
          })
        }
        if (listId === 'scheduled') {
          return tasks.filter((t) => t.dueDate && !t.completed)
        }
        if (listId === 'all') {
          return tasks
        }
        return tasks.filter((t) => t.listId === listId)
      },
    }),
    { name: 'todo-store' }
  )
)
