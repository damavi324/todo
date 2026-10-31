import { useState } from 'react'
import { useTaskStore } from '../store/useTaskStore'
import { useCallStore, isBadStatus } from '../store/useCallStore'
import { useSyncStore } from '../lib/cloudSync'
import { SMART_VIEWS, openCount } from '../lib/views'
import { CalendarDays, CalendarClock, Inbox, Layers, Phone, Plus, Settings, CheckCircle2 } from 'lucide-react'

const VIEW_ICONS = { today: CalendarDays, scheduled: CalendarClock, all: Layers }
const LIST_COLORS = ['#2563EB', '#E5484D', '#12A594', '#F59E0B', '#8E4EC6', '#E54D9E', '#0090FF', '#71717A']

/** Desktop sidebar. */
export default function Sidebar({ onOpenSettings }) {
  const sync = useSyncStore()
  return (
    <div className="flex flex-col h-full bg-surface border-r border-line">
      <div className="flex items-center gap-2.5 px-5 h-16 flex-shrink-0">
        <span className="w-7 h-7 rounded-lg bg-accent text-accent-ink flex items-center justify-center">
          <CheckCircle2 size={16} strokeWidth={2.5} />
        </span>
        <span className="font-semibold text-[15px] tracking-tight">ToDo</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <Navigation />
      </div>

      <button
        onClick={onOpenSettings}
        className="flex items-center gap-3 mx-3 mb-3 px-3 h-11 rounded-lg hover:bg-surface-2 transition-colors text-left"
      >
        <Settings size={17} className="text-ink-3" />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-ink-2">Settings</span>
          {sync.email && <span className="block text-[11px] text-ink-3 truncate">{sync.email}</span>}
        </span>
        {sync.status !== 'off' && sync.status !== 'signed-out' && (
          <span className={`w-2 h-2 rounded-full ${SYNC_DOT[sync.status] || 'bg-ink-3'}`} title={sync.status} />
        )}
      </button>
    </div>
  )
}

const SYNC_DOT = { synced: 'bg-success', pending: 'bg-warn', connecting: 'bg-warn', offline: 'bg-ink-3', error: 'bg-danger' }

/** Views, lists and Calls. Used by the desktop sidebar and the phone's Lists tab. */
export function Navigation({ onPick, large = false }) {
  const { lists, tasks, selectedList, setSelectedList, addList, appView, setAppView } = useTaskStore()
  const callStatus = useCallStore((s) => s.status)
  const callSession = useCallStore((s) => s.session)
  const onCall = callSession && callStatus && callStatus !== 'ended' && !isBadStatus(callStatus)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [color, setColor] = useState(LIST_COLORS[0])

  const pick = (id) => { setSelectedList(id); onPick?.() }
  const active = (id) => appView === 'tasks' && selectedList === id

  const handleAdd = () => {
    if (!newName.trim()) return
    addList(newName.trim(), color)
    setNewName('')
    setAdding(false)
  }

  return (
    <nav className="space-y-6">
      <div className="space-y-0.5">
        {SMART_VIEWS.map(({ id, name }) => (
          <NavItem key={id} large={large} active={active(id)} onClick={() => pick(id)} count={openCount(id, tasks)}
            icon={(() => { const Icon = VIEW_ICONS[id]; return <Icon size={17} /> })()}>
            {name}
          </NavItem>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between px-3 mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Lists</span>
          <button onClick={() => setAdding(true)} aria-label="New list"
            className="w-6 h-6 -mr-1.5 rounded-md flex items-center justify-center text-ink-3 hover:bg-surface-2 hover:text-ink">
            <Plus size={15} />
          </button>
        </div>
        <div className="space-y-0.5">
          {lists.map((list) => (
            <NavItem key={list.id} large={large} active={active(list.id)} onClick={() => pick(list.id)} count={openCount(list.id, tasks)}
              icon={list.id === 'inbox'
                ? <Inbox size={17} />
                : <span className="w-[17px] flex justify-center"><span className="w-2.5 h-2.5 rounded-full" style={{ background: list.color }} /></span>}>
              {list.name}
            </NavItem>
          ))}
        </div>

        {adding && (
          <div className="mt-2 mx-1 p-3 rounded-xl bg-surface-2 space-y-3">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="List name"
              className="w-full h-9 rounded-lg bg-surface px-3 text-sm outline-none border border-line focus:border-accent/50"
            />
            <div className="flex gap-1.5">
              {LIST_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} aria-label="List color"
                  className={`w-5 h-5 rounded-full ring-offset-2 ring-offset-surface-2 ${color === c ? 'ring-2 ring-ink-3' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} className="flex-1 h-8 rounded-lg bg-accent text-accent-ink text-[13px] font-medium">Add list</button>
              <button onClick={() => setAdding(false)} className="flex-1 h-8 rounded-lg text-[13px] text-ink-2 hover:bg-surface">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div>
        <span className="block px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Assistant</span>
        <NavItem large={large} active={appView === 'calls'} onClick={() => { setAppView('calls'); onPick?.() }} icon={<Phone size={17} />}
          badge={onCall && <span className="text-[10px] font-semibold uppercase text-white bg-danger rounded px-1.5 py-0.5">Live</span>}>
          Calls
        </NavItem>
      </div>
    </nav>
  )
}

function NavItem({ active, onClick, icon, count, badge, large, children }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-3 px-3 rounded-lg text-left transition-colors ${large ? 'h-12 text-[15px]' : 'h-9 text-sm'} ${
        active ? 'bg-surface-2 text-ink font-medium' : 'text-ink-2 hover:bg-surface-2/70 hover:text-ink'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-ink-3'}>{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {badge}
      {!!count && <span className="text-xs tabular-nums text-ink-3">{count}</span>}
    </button>
  )
}
