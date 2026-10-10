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
  if (msg.method === 'Runtime.consoleAPICalled') {
    const vals = (msg.params.args || []).map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(' ')
    console.log('CONSOLE', msg.params.type, vals)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    console.log('EXCEPTION', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description)
  }
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
await send('Network.enable')

// Reload to catch startup errors
await send('Page.reload', { ignoreCache: true })
await new Promise((r) => setTimeout(r, 4000))

const info = await send('Runtime.evaluate', {
  expression: `({
    rootLen: (document.getElementById('root')||{}).innerHTML?.length || 0,
    bodyText: (document.body&&document.body.innerText||'').slice(0,500),
    scripts: [...document.scripts].map(s=>s.src)
  })`,
  returnByValue: true,
})
console.log('AFTER_RELOAD', JSON.stringify(info.result.value, null, 2))

ws.close()
