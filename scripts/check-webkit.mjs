// Requires WebKitGTK WebDriver and MiniBrowser on Linux with an active display.
// Run after npm run build. This checks the GTK port independently of Chromium.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { servePages } from './serve-pages.mjs'

const port = Number(process.env.WEBKIT_DRIVER_PORT || 9759)
const driver = spawn(process.env.WEBKIT_DRIVER_PATH || 'WebKitWebDriver', ['--port=' + port], {
  stdio: ['ignore', 'ignore', 'inherit'],
})
let startupError
driver.on('error', (e) => {
  startupError = e
})
const base = 'http://127.0.0.1:' + port
const temp = await mkdtemp(join(tmpdir(), 'formant-webkit-smoke-'))
let session, server
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  })
  const { value } = await response.json()
  if (value?.error) throw Error(value.error + ' ' + value.message)
  return value
}
async function waitFor(fn, ms = 90000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (startupError) throw startupError
    const result = await fn()
    if (result) return result
    await delay(250)
  }
  throw Error('WebKitGTK condition timed out')
}
try {
  await waitFor(() => request('/status').catch(() => null), 6000)
  const options = { args: ['--automation'] }
  if (process.env.WEBKIT_BROWSER_PATH) options.binary = process.env.WEBKIT_BROWSER_PATH
  session = await request('/session', {
    capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': options } },
  })
  const path = '/session/' + session.sessionId
  const js = (script, args = []) => request(path + '/execute/sync', { script, args })
  const asyncJS = (script) => request(path + '/execute/async', { script, args: [] })
  await request(path + '/timeouts', { script: 90000 })
  server = await servePages(0, process.env.FORMANT_BUILD || 'dist')
  await request(path + '/url', { url: 'http://127.0.0.1:' + server.address().port })
  await waitFor(() => js("return !!document.querySelector('.export-btn:enabled')"))
  const report = await js(
    "return {app:document.title,videoEncoder:typeof VideoEncoder,webgl2:!!document.createElement('canvas').getContext('webgl2'),error:document.querySelector('.stage-error')?.textContent||null,isolated:window.crossOriginIsolated}",
  )
  assert.ok(report.isolated && report.app.includes('Formant'))
  await waitFor(() => js('return !!navigator.serviceWorker.controller'))
  await js("document.querySelector('.export-btn').click()")
  const ready =
    "return document.querySelector('.export-modal footer button')?.disabled===false || !!document.querySelector('.export-error')"
  await waitFor(() => js(ready))
  const candidates = await js(
    "return {codecs:[...document.querySelectorAll('.export-fields select')[1].options].map(o=>o.value).filter(Boolean),reason:document.querySelector('.export-error')?.textContent||null}",
  )
  console.log('WebKitGTK', session.capabilities.browserVersion, report, candidates)
  assert.ok(candidates.codecs.length || candidates.reason)
  if (report.webgl2 && !report.error && candidates.codecs.length) {
    // Use the same React-controlled edit paths as a typed/set select change.
    const fields = async (field, value) =>
      js(
        `
     const [name,value]=arguments
     const label=[...document.querySelectorAll('.export-fields label')].find(l=>l.firstChild.textContent.trim()===name)
     const el=label?.querySelector('input,select')
     if(!el)throw Error('No control '+name)
     Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value').set.call(el,value)
     el.dispatchEvent(new Event(el instanceof HTMLInputElement?'input':'change',{bubbles:true}))
   `,
        [field, value],
      )
    await fields('Resolution', 'custom')
    await fields('Width (px)', '320')
    await fields('Height (px)', '180')
    await fields('Start (s)', '2')
    await fields('End (s)', '2.25')
    await waitFor(() => js(ready))
    assert.equal(await js("return document.querySelector('.export-modal footer button')?.disabled"), false)
    await js("document.querySelector('.export-modal footer button').click()")
    await waitFor(() => js("return !!document.querySelector('.export-modal a[download],.export-error')"))
    const data = await asyncJS(`
     const done=arguments[arguments.length-1],a=document.querySelector('.export-modal a[download]')
     if(!a){done({error:document.querySelector('.export-error')?.textContent});return}
     fetch(a.href).then(r=>r.blob()).then(b=>{const fr=new FileReader();fr.onload=()=>done({bytes:fr.result.split(',')[1]});fr.onerror=()=>done({error:'FileReader'});fr.readAsDataURL(b)}).catch(e=>done({error:String(e)}))`)
    assert.ok(data.bytes, data.error)
    const file = join(temp, 'scene.mp4')
    await writeFile(file, Buffer.from(data.bytes, 'base64'))
    const info = JSON.parse(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-count_frames',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        file,
      ]),
    )
    const v = info.streams.find((s) => s.codec_type === 'video'),
      a = info.streams.find((s) => s.codec_type === 'audio')
    assert.ok(a)
    assert.deepEqual([v.width, v.height, Number(v.nb_read_frames)], [320, 180, 8])
    console.log(
      'WebKitGTK media inspection',
      info.streams.map((s) => ({
        codec: s.codec_name,
        start: s.start_time,
        duration: s.duration,
        frames: s.nb_read_frames,
      })),
      info.format.duration,
    )
    assert.ok(Math.abs(Number(a.start_time) - Number(v.start_time)) < 1 / 30)
    assert.ok(Math.abs(Number(info.format.duration) - 0.25) < 0.06)
    console.log('PASS WebKitGTK real scene export', v.codec_name, a.codec_name, info.format.duration, 's')
  }
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  server = null
  await request(path + '/refresh', {})
  await waitFor(() => js("return !!document.querySelector('.export-btn:enabled')"))
  assert.equal(await js('return !!navigator.serviceWorker.controller'), true)
  assert.equal(
    await asyncJS(
      "const done=arguments[arguments.length-1];fetch('/demo/phase-drift.wav').then(r=>r.arrayBuffer()).then(b=>done(new TextDecoder().decode(new Uint8Array(b,0,4)))).catch(e=>done(String(e)))",
    ),
    'RIFF',
  )
  console.log('PASS production shell and WAV recovered with HTTP origin shut down')
} finally {
  if (session) await request('/session/' + session.sessionId, undefined, 'DELETE').catch(() => null)
  driver.kill('SIGTERM')
  if (server) {
    server.closeAllConnections()
    server.close()
  }
  await rm(temp, { recursive: true, force: true })
}
