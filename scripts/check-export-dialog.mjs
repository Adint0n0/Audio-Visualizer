// Mobile-viewport check. Headless Chromium uses a software GPU, without physical mobile hardware.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { servePages } from './serve-pages.mjs'

const server = await servePages(0)
const url = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  })
  const context = await browser.newContext({
    locale: 'ja-JP',
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const heap = async () =>
    Math.round(
      (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value /
        1048576,
    )
  await page.goto(url)
  await page.locator('.export-btn:enabled').waitFor({ timeout: 90000 })
  await page.locator('.export-btn').tap()
  const modal = page.getByRole('dialog', { name: '動画を書き出す' })
  const render = modal.getByRole('button', { name: '書き出し開始' })
  await modal.getByRole('combobox', { name: '解像度', exact: true }).selectOption('custom')
  await modal.getByLabel('幅 (px)', { exact: true }).fill('4098')
  await modal.getByRole('alert').waitFor()
  assert.equal(await render.isDisabled(), true)
  await modal.getByRole('combobox', { name: '形式', exact: true }).selectOption('webm')
  const probeStart = Date.now()
  await modal.getByRole('combobox', { name: '解像度', exact: true }).selectOption('0')
  await page.waitForFunction(
    () => !!document.querySelector('.export-modal footer button:not(:disabled)'),
    undefined,
    { timeout: 90000 },
  )
  console.log(
    'Mobile viewport 720p encoder menu ready in',
    Date.now() - probeStart,
    'ms. JS heap',
    await heap(),
    'MiB',
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await modal.getByRole('combobox', { name: '映像コーデック' }).inputValue(), 'vp9')
  await render.tap()
  await modal.locator('progress').waitFor()
  await page.waitForFunction(() => document.querySelector('progress')?.value > 0, undefined, {
    timeout: 90000,
  })
  console.log('Rendering JS heap', await heap(), 'MiB')
  await modal.getByRole('button', { name: '書き出しをキャンセル' }).tap()
  await modal.getByRole('alert').filter({ hasText: 'キャンセルしました' }).waitFor({ timeout: 60000 })
  const files = await page.evaluate(async () => {
    const names = []
    for await (const [n] of await navigator.storage.getDirectory())
      if (n.startsWith('formant-export-')) names.push(n)
    return names
  })
  assert.deepEqual(files, [])
  await modal.getByRole('button', { name: '閉じる' }).tap()
  await cdp.send('HeapProfiler.collectGarbage')
  console.log('After cancel and GC JS heap', await heap(), 'MiB')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  server.close()
}
