import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import ts from 'typescript'
import { finalizeBuild } from './postbuild.mjs'
import { servePages } from './serve-pages.mjs'

const directory = await mkdtemp(join(tmpdir(), 'formant-update-'))
let browser, server
const appFile = join(directory, 'app.js')
async function stage(version) {
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><title>Formant ' +
      version +
      '</title><p id="v"></p><script type="module" src="/app.js"></script>',
  )
  await writeFile(
    appFile,
    `import {registerOffline,getOfflineState,subscribeOffline} from './status.js';
    window.observedOffline=[]; subscribeOffline(()=>{const state=getOfflineState();window.observedOffline.push(state);document.documentElement.dataset.state=state}); registerOffline();
    document.getElementById("v").textContent = "${version}";`,
  )
  await finalizeBuild(directory)
}
async function update(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker update timed out')), 30000)
      reg.addEventListener(
        'updatefound',
        () => {
          const worker = reg.installing
          const inspect = () => {
            if (worker.state === 'installed' || worker.state === 'redundant') {
              clearTimeout(timer)
              resolve(worker.state)
            }
          }
          worker.addEventListener('statechange', inspect)
          inspect()
        },
        { once: true },
      )
      reg.update().catch(reject)
    })
  })
}
async function version(page, letter) {
  await page.waitForFunction((v) => document.getElementById('v')?.textContent === v, letter)
}
try {
  await mkdir(join(directory, 'licenses'))
  await cp('public/_headers', join(directory, '_headers'))
  const runtime = (await readFile('src/pwa.ts', 'utf8')).replaceAll('import.meta.env.PROD', 'true')
  const compiled = ts.transpileModule(runtime, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  })
  await writeFile(join(directory, 'status.js'), compiled.outputText)
  await stage('A')
  // Sparse file checks the Pages size gate without allocating a large in-memory buffer.
  const big = join(directory, 'oversized.bin')
  await writeFile(big, '')
  await truncate(big, 25 * 1024 * 1024 + 1)
  await assert.rejects(finalizeBuild(directory), /file limit exceeded/)
  await rm(big)
  server = await servePages(0, directory)
  const base = 'http://127.0.0.1:' + server.address().port
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  })
  const context = await browser.newContext()
  const a = await context.newPage()
  await a.goto(base)
  await a.waitForFunction(() => !!navigator.serviceWorker.controller)
  await a.waitForFunction(() => document.documentElement.dataset.state === 'ready')
  assert((await a.evaluate(() => window.observedOffline)).includes('installing'))
  const b = await context.newPage()
  await b.goto(base)
  await version(b, 'A')
  const [alpha] = await a.evaluate(() => caches.keys())
  await stage('B-bad')
  await writeFile(appFile, '// response with stale bytes')
  assert.equal(await update(a), 'redundant')
  await a.waitForFunction(() => document.documentElement.dataset.state === 'updateFailed')
  assert.deepEqual(await a.evaluate(() => caches.keys()), [alpha])
  await b.reload()
  await version(b, 'A')
  await stage('B')
  assert.equal(await update(a), 'installed')
  await a.waitForFunction(() => document.documentElement.dataset.state === 'waiting')
  assert.equal((await a.evaluate(() => caches.keys())).length, 2)
  await a.reload()
  await version(a, 'A')
  await b.reload()
  await version(b, 'A')
  await a.close()
  await b.close()
  const c = await context.newPage()
  await c.goto(base)
  await version(c, 'B')
  const keys = await c.evaluate(() => caches.keys())
  assert.equal(keys.length, 1)
  assert.notEqual(keys[0], alpha)
  // Simulate storage corruption at rest and verify that the correct deployed bytes are fetched.
  await c.evaluate(
    async (key) => (await caches.open(key)).put('/app.js', new Response('incorrect bytes')),
    keys[0],
  )
  await c.reload()
  await version(c, 'B')
  assert(
    (
      await c.evaluate(async (key) => (await (await caches.open(key)).match('/app.js')).text(), keys[0])
    ).includes('textContent = "B"'),
  )
  // With the origin unavailable, a missing boot module must produce an intelligible recovery screen.
  await c.evaluate(async (key) => (await caches.open(key)).delete('/app.js'), keys[0])
  await context.setOffline(true)
  const failed = await c.reload()
  assert.equal(failed.status(), 503)
  assert((await c.locator('body').innerText()).includes('Reconnect'))
  await context.setOffline(false)
  await c.reload()
  await version(c, 'B')
  await writeFile(join(directory, 'optional.txt'), 'expected bytes')
  await stage('First-install-failure')
  await writeFile(join(directory, 'optional.txt'), 'stale bytes')
  const fresh = await browser.newContext()
  const first = await fresh.newPage()
  await first.goto(base)
  await first.waitForFunction(() => document.documentElement.dataset.state === 'failed')
  assert.deepEqual(await first.evaluate(() => caches.keys()), [])
  await fresh.close()
  console.log(
    `Chromium ${browser.version()}: broken update rolled back, two old tabs remained usable, activation retired old cache, corrupt bytes repaired, offline loss showed recovery, online retry recovered. 25 MiB gate passed.`,
  )
} finally {
  await browser?.close()
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  await rm(directory, { recursive: true, force: true })
}
