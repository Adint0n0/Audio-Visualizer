// Run with --write to refresh the gallery thumbnails after a design change.
import { build, preview } from 'vite'
import { chromium } from 'playwright'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const outDir = await mkdtemp(join(tmpdir(), 'formant-templates-'))
const write = process.argv.includes('--write')
let server, browser
try {
  await build({
    configFile: false,
    logLevel: 'error',
    publicDir: false,
    build: { outDir, emptyOutDir: false, rollupOptions: { input: 'tests/templates.html' } },
  })
  server = await preview({
    configFile: false,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  })
  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await access('/usr/bin/chromium')
      .then(() => '/usr/bin/chromium')
      .catch(() => undefined))
  browser = await chromium.launch({
    executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text())
  })
  await page.goto(server.resolvedUrls.local[0] + 'tests/templates.html')
  await page.waitForFunction(() => window.ids?.length === 60)
  const ids = await page.evaluate(() => window.ids)
  if (write) await mkdir('public/templates', { recursive: true })
  let count = 0
  for (const [w, h] of [
    [320, 180],
    [256, 256],
    [180, 320],
  ]) {
    for (const id of ids) {
      const save = write && w === 320
      const { luminanceVariation, brightPixels, uri } = await page.evaluate(
        (args) => window.renderTemplate(...args),
        [id, w, h, save],
      )
      assert.ok(
        luminanceVariation > 16 && brightPixels >= 12,
        id + ' ' + w + '×' + h + ' produced insufficient visible geometry: ' + brightPixels + ' pixels',
      )
      if (save) {
        assert.ok(uri.startsWith('data:image/webp;base64,'))
        await writeFile('public/templates/' + id + '.webp', Buffer.from(uri.split(',')[1], 'base64'))
      }
      count++
    }
    console.log('PASS', ids.length + ' designs', w + '×' + h)
  }
  await page.evaluate(() => window.finishRenderer())
  assert.deepEqual(errors, [])
  console.log('PASS', count + ' rendered and read-back frames, Chromium ' + browser.version())
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.httpServer.close(resolve))
  await rm(outDir, { recursive: true, force: true })
}
