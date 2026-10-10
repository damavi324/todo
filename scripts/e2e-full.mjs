import http from 'http'

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

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}

const setReactInput = `
function setReactInput(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  const tracker = el._valueTracker
  if (tracker) tracker.setValue('')
  desc.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
`

// Close settings if open
await evaluate(`(() => {
  const close = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim()==='' && b.querySelector('svg'))
  // click X in settings header if present
  const xs = [...document.querySelectorAll('button')].filter(b => b.closest('.fixed') || true)
  const settingsTitle = [...document.querySelectorAll('h1')].find(h => /Settings/i.test(h.textContent||''))
  if (settingsTitle) {
    const btn = settingsTitle.parentElement.querySelector('button')
    if (btn) btn.click()
  }
  return true
})()`)
await sleep(400)

// Open add modal via FAB (fixed bottom-right button)
const opened = await evaluate(`(() => {
  const fabs = [...document.querySelectorAll('button')].filter(b => getComputedStyle(b).position === 'fixed')
  const fab = fabs[fabs.length - 1]
  if (!fab) return { ok:false, fabs: fabs.length }
  fab.click()
  return { ok:true }
})()`)
console.log('OPEN_ADD', opened)
await sleep(500)

const due = new Date(Date.now() + 75_000)
const yyyy = due.getFullYear()
const mm = String(due.getMonth() + 1).padStart(2, '0')
const dd = String(due.getDate()).padStart(2, '0')
const hh = String(due.getHours()).padStart(2, '0')
const mi = String(due.getMinutes()).padStart(2, '0')

const filled = await evaluate(`(() => {
  ${setReactInput}
  const title = document.querySelector('input[placeholder="Task title"]')
  if (!title) return { ok:false, body:(document.body.innerText||'').slice(0,400) }
  setReactInput(title, 'E2E Emulator Voice Task')
  const date = document.querySelector('input[type=date]')
  if (date) setReactInput(date, '${yyyy}-${mm}-${dd}')
  return { ok:true, title: title.value, date: date && date.value }
})()`)
console.log('FILLED', filled)
await sleep(400)

const saved = await evaluate(`(() => {
  ${setReactInput}
  const time = document.querySelector('input[type=time]')
  if (time) setReactInput(time, '${hh}:${mi}')
  const save = [...document.querySelectorAll('button')].find(b => /Add Task/i.test(b.textContent||''))
  if (!save) return { ok:false, disabled:null, body:(document.body.innerText||'').slice(0,500) }
  const disabled = save.disabled
  save.click()
  return { ok:true, disabled, time: time && time.value }
})()`)
console.log('SAVED', saved)
await sleep(1000)

const listState = await evaluate(`({
  body: (document.body.innerText||'').slice(0,800),
  store: localStorage.getItem('todo-store')
})`)
console.log('LIST_BODY', listState.body)
const store = listState.store ? JSON.parse(listState.store) : null
const tasks = store?.state?.tasks || []
console.log('TASK_COUNT', tasks.length)
console.log('LATEST_TASK', tasks[0] ? { title: tasks[0].title, dueDate: tasks[0].dueDate, dueTime: tasks[0].dueTime, id: tasks[0].id } : null)

// Ensure native schedule for latest task
const schedule = await evaluate(`(async () => {
  const raw = localStorage.getItem('todo-store')
  if (!raw) return { ok:false, reason:'no store' }
  const tasks = JSON.parse(raw).state.tasks || []
  const t = tasks[0]
  if (!t) return { ok:false, reason:'no task' }
  const P = window.Capacitor.Plugins.VoiceReminder
  const due = new Date(t.dueDate)
  if (t.dueTime) {
    const [h,m] = t.dueTime.split(':')
    due.setHours(+h, +m, 0, 0)
  }
  // if due already passed or far, reschedule 70s from now for test
  let at = due.getTime()
  if (at < Date.now() + 30000) at = Date.now() + 70000
  const id = Math.abs([...String(t.id)].reduce((h,c)=>((h<<5)-h)+c.charCodeAt(0)|0,0)) || 1
  await P.requestPermissions()
  await P.schedule({
    id: id % 2147483647,
    taskId: t.id,
    at,
    title: t.title,
    body: t.notes || 'Due now',
    speak: true
  })
  return { ok:true, at: new Date(at).toISOString(), notifId: id % 2147483647, title: t.title }
})()`)
console.log('NATIVE_SCHEDULE', schedule)

// Settings / Google UI checks
await evaluate(`(() => {
  const menuButtons = [...document.querySelectorAll('button')]
  // mobile menu is first button in top bar
  if (menuButtons[0]) menuButtons[0].click()
  return true
})()`)
await sleep(500)
await evaluate(`(() => {
  const settingsBtn = [...document.querySelectorAll('button')].find(b => /Settings/i.test(b.textContent||''))
  if (settingsBtn) settingsBtn.click()
  return !!settingsBtn
})()`)
await sleep(500)
const settingsText = await evaluate(`(document.body.innerText||'')`)
console.log('HAS_VOICE_SETTINGS', /Voice reminders/i.test(settingsText))
console.log('HAS_GOOGLE_SIGNIN', /Sign in with Google/i.test(settingsText))
console.log('GOOGLE_NEEDS_ENV', /VITE_GOOGLE_WEB_CLIENT_ID/i.test(settingsText))
console.log('HAS_SOCIAL_LOGIN_PLUGIN', await evaluate(`!!(window.Capacitor && Capacitor.Plugins.SocialLogin)`))
console.log('HAS_VOICE_PLUGIN', await evaluate(`!!(window.Capacitor && Capacitor.Plugins.VoiceReminder)`))

ws.close()

if (schedule?.ok) {
  const waitMs = Math.max(0, new Date(schedule.at).getTime() - Date.now()) + 5000
  console.log('WAITING_FOR_ALARM_MS', waitMs)
}
