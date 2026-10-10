import http from 'http'
import { execSync } from 'child_process'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function adb(cmd) {
  return execSync(`adb -s emulator-5554 ${cmd}`, { encoding: 'utf8' })
}

const pages = await getJson('http://127.0.0.1:9222/json')
const page = pages[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) rej(new Error(JSON.stringify(msg.error)))
    else res(msg.result)
  }
})

await new Promise((r, j) => {
  ws.addEventListener('open', r)
  ws.addEventListener('error', j)
})
await send('Runtime.enable')
await send('Page.enable')

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

const at = Date.now() + 70_000
const taskId = 'e2e-' + Date.now()
const title = 'E2E Voice Alarm'

const seeded = await evaluate(`(() => {
  const task = {
    id: ${JSON.stringify(taskId)},
    title: ${JSON.stringify(title)},
    notes: 'Emulator alarm test',
    dueDate: new Date(${at}).toISOString().slice(0,10),
    dueTime: (() => { const d=new Date(${at}); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0') })(),
    priority: 'high',
    listId: 'inbox',
    completed: false,
    createdAt: new Date().toISOString(),
    googleEventId: null
  }
  const payload = {
    state: {
      tasks: [task],
      lists: [
        { id: 'inbox', name: 'Inbox', color: '#4772FA' },
        { id: 'personal', name: 'Personal', color: '#FF6B6B' },
        { id: 'work', name: 'Work', color: '#4ECDC4' }
      ],
      selectedList: 'all',
      settings: {
        notificationStyle: 'sticky',
        notificationRepeatMinutes: 10,
        voiceRemindersEnabled: true,
        googleCalendarEnabled: false,
        googleCalendarId: 'primary'
      }
    },
    version: 0
  }
  localStorage.setItem('todo-store', JSON.stringify(payload))
  return { ok: true, task }
})()`)
console.log('SEEDED', seeded)

await send('Page.reload', { ignoreCache: true })
await sleep(3500)

const ui = await evaluate(`({
  body: (document.body.innerText||'').slice(0,1000),
  storeLen: (localStorage.getItem('todo-store')||'').length,
  taskTitle: (() => { try { return JSON.parse(localStorage.getItem('todo-store')).state.tasks[0].title } catch { return null } })()
})`)
console.log('UI_AFTER_RELOAD', ui)

const notifId = Math.abs([...taskId].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) || 1
const schedule = await evaluate(`(async () => {
  const P = Capacitor.Plugins.VoiceReminder
  const perms = await P.requestPermissions()
  await P.cancelAll()
  await P.schedule({
    id: ${notifId % 2147483647},
    taskId: ${JSON.stringify(taskId)},
    at: ${at},
    title: ${JSON.stringify(title)},
    body: 'Emulator alarm test',
    speak: true
  })
  return { ok: true, perms, at: new Date(${at}).toISOString(), id: ${notifId % 2147483647} }
})()`)
console.log('SCHEDULED', schedule)

const plugins = await evaluate(`Object.keys(Capacitor.Plugins||{})`)
console.log('PLUGINS', plugins)

const settingsOpen = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')]
  if (buttons[0]) buttons[0].click()
  return true
})()`)
await sleep(400)
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Settings/i.test(x.textContent||''))
  if (b) b.click()
  return !!b
})()`)
await sleep(500)
const settings = await evaluate(`(document.body.innerText||'').slice(0,1200)`)
console.log('SETTINGS_SNIPPET', settings.slice(0, 900))

ws.close()

const waitMs = Math.max(5000, at - Date.now() + 8000)
console.log('WAITING_MS', waitMs)
await sleep(waitMs)

console.log('--- NOTIFICATION DUMP ---')
try {
  const dump = adb('shell dumpsys notification --noredact')
  const lines = dump.split(/\\r?\\n/).filter((l) =>
    /com\\.todo\\.voice|E2E Voice|voice_reminders|Emulator alarm/i.test(l)
  )
  console.log(lines.slice(0, 60).join('\\n') || '(no matching notification lines)')
} catch (e) {
  console.log('dumpsys failed', e.message)
}

try {
  const log = adb('logcat -d -t 200')
  const lines = log.split(/\\r?\\n/).filter((l) =>
    /VoiceReminder|TextToSpeech|TTS|FIRE_REMINDER|com\\.todo\\.voice/i.test(l)
  )
  console.log('--- LOGCAT ---')
  console.log(lines.slice(-40).join('\\n') || '(no matching log lines)')
} catch (e) {
  console.log('logcat failed', e.message)
}

console.log('DONE')
