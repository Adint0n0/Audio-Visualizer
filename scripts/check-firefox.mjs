// Standalone Firefox ESR integration using its standard WebDriver BiDi endpoint.
// Run against npm run build output. Set FIREFOX_PATH to a Gecko executable.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { servePages } from './serve-pages.mjs'

const root = await mkdtemp(join(tmpdir(), 'formant-gecko-'))
const server = await servePages(0)
const base = 'http://127.0.0.1:' + server.address().port
let firefox,
  websocket,
  stopped = false
const stopServer = async () => {
  if (!stopped) {
    stopped = true
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
async function poll(action, timeout = 60000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await action()
    if (value) return value
    await delay(160)
  }
  throw Error('Timed out waiting for Firefox')
}
try {
  const profile = join(root, 'profile')
  for (const part of ['profile', 'config', 'cache', 'data', 'runtime'])
    await mkdir(join(root, part), { mode: 0o700 })
  const args = [
    ...(process.env.DISPLAY ? [] : ['--headless']),
    '--no-remote',
    '--profile',
    profile,
    '--remote-debugging-port',
    '0',
    base,
  ]
  firefox = spawn(process.env.FIREFOX_PATH || 'firefox-esr', args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      MOZ_CRASHREPORTER_DISABLE: '1',
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      XDG_RUNTIME_DIR: join(root, 'runtime'),
      XDG_CACHE_HOME: join(root, 'cache'),
    },
  })
  let spawnError
  firefox.on('error', (e) => {
    spawnError = e
  })
  if (process.env.FIREFOX_DEBUG) firefox.stderr.pipe(process.stderr)
  else firefox.stderr.resume()
  const port = await poll(async () => {
    if (spawnError) throw spawnError
    if (firefox.exitCode !== null) throw Error('Firefox exited: ' + firefox.exitCode)
    return readFile(join(profile, 'WebDriverBiDiServer.json'), 'utf8')
      .then((s) => JSON.parse(s).ws_port)
      .catch(() => 0)
  })
  websocket = new WebSocket('ws://127.0.0.1:' + port + '/session')
  await once(websocket, 'open')
  let seq = 0
  const pending = new Map()
  websocket.addEventListener('message', (e) => {
    const r = JSON.parse(e.data)
    pending.get(r.id)?.(r)
  })
  function bidi(method, params) {
    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(Error('Firefox timed out on ' + method))
      }, 60000)
      pending.set(id, (r) => {
        clearTimeout(timer)
        pending.delete(id)
        if (r.type === 'error') reject(Error(method + ' ' + r.message))
        else resolve(r.result)
      })
      websocket.send(JSON.stringify({ id, method, params }))
    })
  }
  const session = await bidi('session.new', { capabilities: { alwaysMatch: {} } })
  let context = (await bidi('browsingContext.getTree', {})).contexts[0].context
  const evaluate = async (expression) => {
    const tree = await bidi('browsingContext.getTree', {})
    context = tree.contexts.find((c) => c.url.startsWith(base))?.context ?? context
    const value = await bidi('script.evaluate', { expression, awaitPromise: true, target: { context } })
    if (value.type === 'exception') throw Error(value.exceptionDetails.text)
    return value.result.value
  }

  await poll(() => evaluate("document.querySelector('.export-btn')?.disabled === false"))
  const snapshot = () =>
    evaluate(`JSON.stringify({
    title:document.title, shell:!!document.querySelector('.viewport'), controlled:!!navigator.serviceWorker.controller,
    webgl2:!!document.createElement('canvas').getContext('webgl2'), webcodecs:typeof VideoEncoder,
    canvasError:document.querySelector('.stage-error')?.innerText??null, isolated:crossOriginIsolated
  })`).then(JSON.parse)
  const first = await snapshot()
  assert.ok(first.shell && first.isolated)
  await poll(() => evaluate('!!navigator.serviceWorker.controller'))
  await evaluate("document.querySelector('.export-btn').click()")
  await poll(() =>
    evaluate(
      "!!document.querySelector('.export-modal') && ![...document.querySelectorAll('.export-info')].some(e=>e.textContent.includes('Testing encoders'))",
    ),
  )
  const choices = JSON.parse(
    await evaluate(
      "JSON.stringify({codecs:[...document.querySelectorAll('.export-fields select')[1].options].map(x=>x.value).filter(Boolean),error:document.querySelector('.export-error')?.textContent??null})",
    ),
  )
  assert.ok(choices.codecs.length || choices.error)
  console.log('Firefox', session.capabilities.browserVersion, JSON.stringify(first), JSON.stringify(choices))
  if (first.webgl2 && !first.canvasError && choices.codecs.length) {
    await evaluate(`(()=>{
      const modal=document.querySelector('.export-modal')
      const end=[...modal.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith('End (s)'))?.querySelector('input')
      if(!end)throw Error('Missing range input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(end,'0.25')
      end.dispatchEvent(new Event('input',{bubbles:true}))
    })()`)
    await poll(() => evaluate("document.querySelector('.export-modal footer button')?.disabled === false"))
    await evaluate("document.querySelector('.export-modal footer button').click()")
    await poll(
      () =>
        evaluate(
          "!!document.querySelector('.export-modal a[download]') || !!document.querySelector('.export-error')",
        ),
      120000,
    )
    const file = JSON.parse(
      await evaluate(`(async()=>{
      const link=document.querySelector('.export-modal a[download]')
      if(!link)throw Error(document.querySelector('.export-error')?.innerText)
      const blob=await (await fetch(link.href)).blob()
      const video=document.createElement('video')
      video.preload='metadata'
      const metadata=new Promise((res,rej)=>{video.onloadedmetadata=()=>res({width:video.videoWidth,height:video.videoHeight,duration:video.duration});video.onerror=()=>rej(video.error.message)})
      video.src=link.href
      const result=await metadata
      video.removeAttribute('src');video.load()
      return JSON.stringify({...result,bytes:blob.size,mime:blob.type})
    })()`),
    )
    assert.equal(file.width, 1920)
    assert.equal(file.height, 1080)
    assert.ok(file.bytes > 1000 && Math.abs(file.duration - 0.25) < 0.06)
    console.log('PASS Gecko full 3D scene export', JSON.stringify(file))
  }
  // Disconnect the origin entirely. Firefox has to serve both the document and the audio from the installed PWA cache.
  await stopServer()
  await bidi('browsingContext.reload', { context, wait: 'complete' })
  await poll(() => evaluate("document.querySelector('.export-btn')?.disabled === false"))
  const offline = await snapshot()
  assert.ok(offline.shell && offline.controlled && offline.isolated)
  assert.equal(
    await evaluate(
      "(async()=>new TextDecoder().decode(new Uint8Array(await (await fetch('/demo/phase-drift.wav')).arrayBuffer()).subarray(0,4)))()",
    ),
    'RIFF',
  )
  console.log('PASS Firefox offline startup, cached WAV, COOP/COEP and runtime codec detection')
  await bidi('session.end', {})
} finally {
  websocket?.close()
  if (firefox?.pid && firefox.exitCode === null) {
    const exited = once(firefox, 'exit')
    firefox.kill('SIGTERM')
    await exited
  }
  await stopServer()
  await rm(root, { recursive: true, force: true, maxRetries: 2 })
}
