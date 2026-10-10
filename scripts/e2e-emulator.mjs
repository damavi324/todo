import http from 'http'
import { spawnSync } from 'child_process'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(d))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    // Prefer native WebSocket if available (Node 22+)
    const WS = globalThis.WebSocket
    if (!WS) {
      reject(new Error('No WebSocket in this Node runtime'))
      return
    }
    const ws = new WS(url)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () => {
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
      resolve({ ws, send })
    })
    ws.addEventListener('error', reject)
  })
}

async function main() {
  const pages = await getJson('http://127.0.0.1:9222/json')
  if (!pages.length) throw new Error('No WebView pages')
  const page = pages[0]
  console.log('PAGE', page.title, page.url)

  const { ws, send } = await connectWs(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails, null, 2))
    }
    return r.result?.value
  }

  const info = await evaluate(`({
    ready: document.readyState,
    rootLen: (document.getElementById('root')||{}).innerHTML?.length || 0,
    rootPreview: ((document.getElementById('root')||{}).innerHTML||'').slice(0,400),
    bodyText: (document.body && document.body.innerText || '').slice(0,1000),
    hasCapacitor: !!window.Capacitor,
    platform: window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : null,
    href: location.href,
    scripts: [...document.scripts].map(s => s.src).filter(Boolean).slice(0,8)
  })`)
  console.log('INFO', JSON.stringify(info, null, 2))

  // Inject a due-soon task + schedule voice reminder path via store if available
  const inject = await evaluate(`(async () => {
    try {
      const mod = await import('/assets/' + (document.querySelector('script[type=module]')?.src.split('/').pop() || ''))
      return { ok: false, reason: 'bundle import not practical' }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  })()`)
  console.log('INJECT_PROBE', inject)

  // UI interactions via DOM
  const clickPlus = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
    const fab = buttons.find(b => b.querySelector('svg') && b.className.includes('fixed'))
      || buttons.find(b => /plus|add/i.test(b.getAttribute('aria-label')||'') )
      || buttons[buttons.length-1]
    if (!fab) return { ok:false, buttons: buttons.length }
    fab.click()
    return { ok:true, text: (document.body.innerText||'').slice(0,500) }
  })()`)
  console.log('CLICK_PLUS', JSON.stringify(clickPlus, null, 2))

  await new Promise((r) => setTimeout(r, 500))

  const fillTask = await evaluate(`(() => {
    const input = document.querySelector('input[placeholder=\"Task title\"]')
      || document.querySelector('input[placeholder*=\"title\" i]')
      || document.querySelector('input')
    if (!input) return { ok:false, body: (document.body.innerText||'').slice(0,800) }
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    nativeSet.call(input, 'E2E Emulator Reminder')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    const date = document.querySelector('input[type=date]')
    const time = document.querySelector('input[type=time]')
    const now = new Date(Date.now() + 90*1000)
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth()+1).padStart(2,'0')
    const dd = String(now.getDate()).padStart(2,'0')
    const hh = String(now.getHours()).padStart(2,'0')
    const mi = String(now.getMinutes()).padStart(2,'0')
    if (date) {
      nativeSet.call(date, yyyy+'-'+mm+'-'+dd)
      date.dispatchEvent(new Event('input', { bubbles: true }))
      date.dispatchEvent(new Event('change', { bubbles: true }))
    }
    // time appears after date set — return and continue in next step
    return { ok:true, hasDate:!!date, due: yyyy+'-'+mm+'-'+dd, hh, mi, body:(document.body.innerText||'').slice(0,400) }
  })()`)
  console.log('FILL', JSON.stringify(fillTask, null, 2))

  await new Promise((r) => setTimeout(r, 400))

  const setTimeAndSave = await evaluate(`(() => {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const time = document.querySelector('input[type=time]')
    const now = new Date(Date.now() + 90*1000)
    const hh = String(now.getHours()).padStart(2,'0')
    const mi = String(now.getMinutes()).padStart(2,'0')
    if (time) {
      nativeSet.call(time, hh+':'+mi)
      time.dispatchEvent(new Event('input', { bubbles: true }))
      time.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const save = [...document.querySelectorAll('button')].find(b => /Add Task|Save/i.test(b.textContent||''))
    if (!save) return { ok:false, body:(document.body.innerText||'').slice(0,600) }
    save.click()
    return { ok:true, time: hh+':'+mi }
  })()`)
  console.log('SAVE', JSON.stringify(setTimeAndSave, null, 2))

  await new Promise((r) => setTimeout(r, 800))

  const afterSave = await evaluate(`({
    body: (document.body.innerText||'').slice(0,1000),
    store: localStorage.getItem('todo-store')?.slice(0,1500) || null
  })`)
  console.log('AFTER_SAVE', JSON.stringify(afterSave, null, 2))

  // Open settings and check Google / voice UI
  const openSettings = await evaluate(`(() => {
    // open sidebar on mobile via menu button
    const menu = [...document.querySelectorAll('button')].find(b => b.innerHTML.includes('lucide') || b.querySelector('svg'))
    const buttons = [...document.querySelectorAll('button')]
    // try click first header button (menu)
    if (buttons[0]) buttons[0].click()
    return { clicked: true, body: (document.body.innerText||'').slice(0,500) }
  })()`)
  console.log('MENU', JSON.stringify(openSettings, null, 2))
  await new Promise((r) => setTimeout(r, 500))

  const settingsClick = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button, span, div')].find(n => /Settings/i.test(n.textContent||'') && (n.textContent||'').trim().length < 20)
    if (el) { (el.closest('button') || el).click(); return { ok:true } }
    return { ok:false, body:(document.body.innerText||'').slice(0,800) }
  })()`)
  console.log('SETTINGS', JSON.stringify(settingsClick, null, 2))
  await new Promise((r) => setTimeout(r, 600))

  const settingsBody = await evaluate(`(document.body.innerText||'').slice(0,1500)`)
  console.log('SETTINGS_BODY', settingsBody)

  const googleConfigured = await evaluate(`!!(window.__vite_google || false)`)
  // Check env baked into bundle via a small marker — read from module by checking UI text
  const hasSetupWarning = /VITE_GOOGLE_WEB_CLIENT_ID|Developer setup needed/i.test(settingsBody || '')
  console.log('GOOGLE_SETUP_WARNING', hasSetupWarning)

  // Voice plugin presence
  const nativePlugins = await evaluate(`({
    plugins: window.Capacitor && window.Capacitor.Plugins ? Object.keys(window.Capacitor.Plugins) : [],
    isNative: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  })`)
  console.log('PLUGINS', JSON.stringify(nativePlugins, null, 2))

  // Try scheduling a native voice reminder ~75s out if plugin exists
  const schedule = await evaluate(`(async () => {
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.VoiceReminder
    if (!P) return { ok:false, reason:'no VoiceReminder plugin' }
    const at = Date.now() + 75000
    try {
      const perms = await P.requestPermissions()
      await P.schedule({
        id: 424242,
        taskId: 'e2e-test',
        at,
        title: 'E2E Voice Test',
        body: 'Emulator end-to-end reminder',
        speak: true
      })
      return { ok:true, at: new Date(at).toISOString(), perms }
    } catch (e) {
      return { ok:false, error: String(e && e.message || e) }
    }
  })()`)
  console.log('SCHEDULE', JSON.stringify(schedule, null, 2))

  ws.close()

  console.log('\\n=== SUMMARY HINTS ===')
  console.log('App rendered rootLen=', info.rootLen)
  console.log('Platform=', info.platform)
}

main().catch((e) => {
  console.error('E2E FAILED', e)
  process.exit(1)
})
