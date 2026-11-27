import { chromium, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { servePages } from './serve-pages.mjs'

const server = await servePages(0, process.env.FORMANT_TEST_DIST ?? 'dist')
const url = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const artifacts = await mkdtemp(join(tmpdir(), 'formant-studio-'))
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
  page.on('pageerror', (err) => failures.push(String(err)))
  await page.goto(url)
  const source = page.getByText('Phase Drift.wav', { exact: true })
  await source.waitFor({ timeout: 90000 })
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.thumb img'))
      .slice(0, 6)
      .every((img) => img.complete && img.naturalWidth > 0),
  )
  await page.screenshot({ path: join(artifacts, 'studio.png') })
  const play = page.getByRole('button', { name: 'Play', exact: true })
  await play.click()
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Range', exact: true }).click()
  await page.getByLabel('Start (s)').fill('1.5')
  await page.getByLabel('End (s)').fill('4')
  await page.getByRole('button', { name: 'Start of range', exact: true }).click()
  assert.equal(await page.locator('video').evaluate((el) => el.currentTime), 1.5)
  const openExport = () => page.getByRole('button', { name: 'Export', exact: true }).click({ timeout: 90000 })
  const form = page.getByRole('dialog', { name: 'Export video' })
  await openExport()
  assert.equal(await form.getByLabel('Start (s)').inputValue(), '1.5')
  await form.getByRole('combobox', { name: /^Resolution/ }).selectOption('custom')
  await form.getByLabel('Width (px)').fill('512')
  await form.getByLabel('Height (px)').fill('288')
  await form.getByRole('combobox', { name: /^Frame rate/ }).selectOption('4')
  await form.getByLabel('End (s)').fill('3.5')
  await form.getByRole('button', { name: 'Close', exact: true }).click()
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const entry = (await indexedDB.databases()).find((db) => db.name === 'av-studio-projects')
          if (!entry) return false
          const db = await new Promise((resolve) => {
            const req = indexedDB.open(entry.name)
            req.onsuccess = () => resolve(req.result)
          })
          try {
            const project = await new Promise((resolve) => {
              const req = db.transaction('project').objectStore('project').get('current')
              req.onsuccess = () => resolve(req.result)
            })
            return project?.range?.[1] === 3.5 && project?.output?.width === 512
          } finally {
            db.close()
          }
        }),
      { timeout: 15000 },
    )
    .toBe(true)
  await page.reload()
  await source.waitFor({ timeout: 90000 })
  await openExport()
  assert.equal(await form.getByLabel('Start (s)').inputValue(), '1.5')
  assert.equal(await form.getByLabel('End (s)').inputValue(), '3.5')
  assert.equal(await form.getByLabel('Width (px)').inputValue(), '512')
  assert.equal(await form.getByLabel('Height (px)').inputValue(), '288')
  assert.equal(await form.getByRole('combobox', { name: /^Frame rate/ }).inputValue(), '4')
  await form.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByLabel('Search templates').fill('Prism Current')
  assert.equal(await page.locator('.template-card').count(), 1)
  await page.locator('.template-pick').click()
  await page.getByRole('button', { name: 'Append layers' }).click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  assert.ok((await page.locator('.ly-row').count()) >= 2)
  await page.getByTitle('Undo', { exact: true }).click()
  const layers = await page.locator('.ly-row').count()
  await page.getByTitle('Redo', { exact: true }).click()
  assert.ok((await page.locator('.ly-row').count()) > layers)
  await page.getByTitle('日本語に切り替え').click()
  await page.getByRole('button', { name: '書き出し', exact: true }).waitFor()
  await page.getByTitle('Switch to English').click()
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  await page.locator('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.project-menu').click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project with assets (.avproj)', exact: true }).click()
  assert.match((await download).suggestedFilename(), /\.avproj$/)
  await page.keyboard.press('Escape')
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
  })
  const phone = await mobile.newPage()
  phone.on('pageerror', (err) => failures.push(String(err)))
  await phone.goto(url)
  await phone.waitForFunction(() => !document.querySelector('.export-btn').disabled, {}, { timeout: 90000 })
  await phone.screenshot({ path: join(artifacts, 'mobile.png') })
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await phone.locator('.mobile-tabs button').first().tap()
  await phone.locator('.template-pick').first().tap()
  await phone.getByRole('button', { name: 'シーンを置換' }).tap()
  await phone.locator('.mobile-tabs button').last().tap()
  await phone.getByRole('button', { name: '詳細', exact: true }).tap()
  assert.equal(
    await phone.getByRole('button', { name: '詳細', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await phone.setViewportSize({ width: 844, height: 390 })
  await phone.locator('.mobile-tabs button').nth(1).tap()
  await phone.locator('.stage-frame canvas').waitFor({ state: 'visible' })
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page
    .locator('input[accept^="audio/"]')
    .setInputFiles({ name: 'malformed.wav', mimeType: 'audio/wav', buffer: Buffer.from('broken audio') })
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.track-label strong').textContent(), 'Phase Drift.wav')
  assert.deepEqual(failures, [])
  console.log(
    'Desktop play/seek/range, library, append, undo/redo, languages, full ZIP download and mobile touch UI passed. Screenshots:',
    artifacts,
  )
} finally {
  await browser.close()
  server.close()
}
