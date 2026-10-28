import { useState } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { Calendar, CalendarDays, List, Plus, X, Settings, CheckSquare, Phone } from 'lucide-react'
import { useCallStore, isBadStatus } from '../store/useCallStore'
import { parseLocalDate, startOfToday, addDays } from '../lib/dates'

const SMART_LISTS = [
  { id: 'today', name: 'Today', icon: Calendar, color: '#4772FA' },
  { id: 'scheduled', name: 'Scheduled', icon: CalendarDays, color: '#FF6B6B' },
  { id: 'all', name: 'All Tasks', icon: List, color: '#6B7280' },
]

export default function Sidebar({ onClose, onOpenSettings }) {
  const { lists, selectedList, setSelectedList, addList, tasks, appView, setAppView } = useTaskStore()
  const callStatus = useCallStore((s) => s.status)
  const callSession = useCallStore((s) => s.session)
  const onCall = callSession && callStatus && callStatus !== 'ended' && !isBadStatus(callStatus)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const colors = ['#4772FA', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
  const [pickedColor, setPickedColor] = useState(colors[0])

  const countFor = (id) => {
    const today = startOfToday()
    const tomorrow = addDays(today, 1)
    if (id === 'today') return tasks.filter(t => !t.completed && t.dueDate && parseLocalDate(t.dueDate) >= today && parseLocalDate(t.dueDate) < tomorrow).length
    if (id === 'scheduled') return tasks.filter(t => !t.completed && t.dueDate).length
    if (id === 'all') return tasks.filter(t => !t.completed).length
    return tasks.filter(t => !t.completed && t.listId === id).length
  }

  const select = (id) => { setSelectedList(id); onClose?.() }

  const handleAdd = () => {
    if (!newName.trim()) return
    addList(newName.trim(), pickedColor)
    setNewName('')
    setAdding(false)
  }

  return (
    <div className="flex flex-col h-full bg-[#1a1d2e] text-white">
      <div className="flex items-center justify-between px-5 pt-12 pb-4">
        <div className="flex items-center gap-2">
          <CheckSquare size={22} className="text-primary" />
          <span className="font-semibold text-lg">ToDo</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 md:hidden">
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <button
          onClick={() => { setAppView('calls'); onClose?.() }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-3 transition-colors ${appView === 'calls' ? 'bg-white/15' : 'hover:bg-white/8'}`}
        >
          <Phone size={18} className="text-emerald-400" />
          <span className="flex-1 text-left text-sm">Calls</span>
          {onCall && <span className="text-xs bg-red-500 rounded-full px-2 py-0.5">Live</span>}
        </button>

        <p className="text-xs text-gray-500 uppercase tracking-wider px-2 mb-2">Smart Lists</p>
        {SMART_LISTS.map(({ id, name, icon: Icon, color }) => (
          <button
            key={id}
            onClick={() => select(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-colors ${
              appView === 'tasks' && selectedList === id ? 'bg-white/15' : 'hover:bg-white/8'
            }`}
          >
            <Icon size={18} style={{ color }} />
            <span className="flex-1 text-left text-sm">{name}</span>
            {countFor(id) > 0 && (
              <span className="text-xs bg-white/15 rounded-full px-2 py-0.5">{countFor(id)}</span>
            )}
          </button>
        ))}

        <p className="text-xs text-gray-500 uppercase tracking-wider px-2 mb-2 mt-5">My Lists</p>
        {lists.map((list) => (
          <button
            key={list.id}
            onClick={() => select(list.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-colors ${
              appView === 'tasks' && selectedList === list.id ? 'bg-white/15' : 'hover:bg-white/8'
            }`}
          >
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: list.color }} />
            <span className="flex-1 text-left text-sm">{list.name}</span>
            {countFor(list.id) > 0 && (
              <span className="text-xs bg-white/15 rounded-full px-2 py-0.5">{countFor(list.id)}</span>
            )}
          </button>
        ))}

        {adding ? (
          <div className="mt-2 px-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="List name"
              className="w-full bg-white/10 rounded-lg px-3 py-2 text-sm outline-none text-white placeholder-gray-400 mb-2"
            />
            <div className="flex gap-1.5 flex-wrap mb-2">
              {colors.map((c) => (
                <button key={c} onClick={() => setPickedColor(c)}
                  className={`w-5 h-5 rounded-full border-2 ${pickedColor === c ? 'border-white' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} className="flex-1 bg-primary text-white text-xs py-1.5 rounded-lg">Add</button>
              <button onClick={() => setAdding(false)} className="flex-1 bg-white/10 text-xs py-1.5 rounded-lg">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/8 transition-colors mt-1">
            <Plus size={16} />
            <span className="text-sm">New List</span>
          </button>
        )}
      </nav>

      <button onClick={onOpenSettings}
        className="flex items-center gap-3 px-5 py-4 border-t border-white/10 hover:bg-white/5 transition-colors">
        <Settings size={18} className="text-gray-400" />
        <span className="text-sm text-gray-400">Settings</span>
      </button>
    </div>
  )
}
