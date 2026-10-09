// Screenshot the app via headless Chrome + DevTools protocol, optionally running a script first.
// usage: node scripts/shot.mjs URL OUT.png [width] [height] [dark] [script-file]
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const PORT = 9313
const [url, out, w = '1440', h = '900', dark, scriptFile] = process.argv.slice(2)
const script = scriptFile ? readFileSync(scriptFile, 'utf8') : ''
const chrome = spawn(process.env.CHROME ?? 'chromium', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 600 })
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await send('Page.navigate', { url })
  // wait for DuckDB to be ready: the Run button becomes enabled
  let ready = false
  for (let i = 0; i < 120 && !ready; i++) {
    await sleep(500)
    ready = (await evaluate("(() => { const b = document.querySelector('.runbar .primary'); return !!b && !b.disabled })()")) === true
  }
  if (script) {
    const r = await evaluate(script)
    if (r !== undefined) console.log('script →', r)
  }
  await sleep(800)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(ready ? 'engine ready' : 'TIMED OUT waiting for DuckDB', '→', out)
  if (errors.length) console.log('page errors:\n' + errors.join('\n'))
  ws.close()
} finally {
  chrome.kill()
}
