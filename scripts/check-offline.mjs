import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { servePages } from './serve-pages.mjs'

const scene4k = process.argv.includes('--scene-4k')
const dimensions = scene4k ? [3840, 2160] : [320, 180]
const duration = scene4k ? 0.25 : 0.5
const renderTimeout = scene4k ? 360000 : 90000
const server = await servePages(0)
const base = 'http://127.0.0.1:' + server.address().port
const artifacts = await mkdtemp(join(tmpdir(), 'formant-offline-'))
let browser, page
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    window.__violations = []
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__violations.push(e.effectiveDirective + ' ' + e.blockedURI),
    )
  })
  const response = await page.goto(base)
  assert.equal(response.status(), 200)
  assert.match(response.headers()['content-security-policy'], /default-src 'self'/)
  assert.equal(await page.evaluate(() => crossOriginIsolated), true)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 60000 })
  const resources = await page.evaluate(async () => {
    const key = (await caches.keys()).find((k) => k.startsWith('av-studio-shell-'))
    if (!key) return []
    return (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)
  })
  assert(
    resources.includes('/') &&
      resources.some((u) => u.endsWith('.js')) &&
      resources.includes('/demo/phase-drift.wav'),
  )
  assert.equal(
    resources.filter((u) => u.startsWith('/templates/') && u.endsWith('.webp')).length >= 60,
    true,
  )
  await page.getByRole('button', { name: 'Guide', exact: true }).click()
  await page.locator('[data-offline-state="ready"]').waitFor()
  assert.equal(await page.locator('[data-offline-state]').textContent(), 'Ready for offline use.')
  await page.keyboard.press('Escape')
  const online = await page.title()
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Scene library' }).waitFor()
  await page.locator('canvas').first().waitFor()
  assert.equal(await page.title(), online)
  const offlineFetch = await page.evaluate(async () => {
    const response = await fetch('/demo/phase-drift.wav')
    return [
      response.ok,
      new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 4)),
    ]
  })
  assert.deepEqual(offlineFetch, [true, 'RIFF'])
  await page.getByRole('button', { name: 'Export', exact: true }).click({ timeout: 90000 })
  const dialog = page.getByRole('dialog', { name: 'Export video' })
  await dialog.getByLabel('Resolution').selectOption('custom')
  await dialog.getByLabel('Width (px)').fill(String(dimensions[0]))
  await dialog.getByLabel('Height (px)').fill(String(dimensions[1]))
  if (scene4k) {
    await dialog.getByRole('combobox', { name: /^Frame rate/ }).selectOption('6')
    await dialog.getByRole('combobox', { name: /^Quality preset/ }).selectOption('40000000')
  }
  await dialog.getByLabel('Start (s)').fill('2')
  await dialog.getByLabel('End (s)').fill(String(2 + duration))
  for (const format of scene4k ? ['webm'] : ['webm', 'mp4']) {
    await dialog.getByLabel(/^Format/).selectOption(format)
    const render = dialog.getByRole('button', { name: 'Render video' })
    const started = Date.now()
    await render.click({ timeout: 90000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: renderTimeout }),
      dialog.getByRole('link', { name: 'Download video' }).click({ timeout: renderTimeout }),
    ])
    const name = join(artifacts, format + '.' + format)
    await download.saveAs(name)
    const data = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', name],
        {
          encoding: 'utf8',
        },
      ),
    )
    const video = data.streams.find((s) => s.codec_type === 'video'),
      audio = data.streams.find((s) => s.codec_type === 'audio')
    assert.deepEqual([video.width, video.height], dimensions)
    assert.equal(Number(video.nb_read_frames), 15)
    if (scene4k) assert.equal(video.r_frame_rate, '60/1')
    assert.equal(audio.codec_name, format === 'mp4' ? 'aac' : 'opus')
    assert(Math.abs(Number(data.format.duration) - duration) < 0.09)
    const pixels = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      name,
      '-an',
      '-frames:v',
      '1',
      '-vf',
      'scale=80:45',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ])
    assert(Math.max(...pixels) - Math.min(...pixels) > 25, 'Rendered frame is visually empty')
    console.log(
      `Offline UI export: ${format} ${video.codec_name}/${audio.codec_name}, ${video.width}×${video.height}, ${video.r_frame_rate} fps, ${data.format.duration}s, ${video.nb_read_frames} frames; ${Date.now() - started} ms including codec trial, export and verification`,
    )
  }
  assert.deepEqual(await page.evaluate(() => window.__violations), [])
  assert.deepEqual(errors, [])
  console.log(
    `Chromium ${browser.version()}: offline editor reload, local demo, ${resources.length} cached resources, COOP/COEP and CSP passed`,
  )
} catch (error) {
  if (page)
    console.error(
      'Editor diagnostics:',
      await page
        .locator('[role="alert"], .export-info')
        .allTextContents()
        .catch(() => []),
    )
  throw error
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(artifacts, { recursive: true, force: true })
}
