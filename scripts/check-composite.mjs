// End-to-end local video import, Three.js composition, WebM download and independent decoding.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { servePages } from './serve-pages.mjs'

const work = await mkdtemp(join(tmpdir(), 'formant-composite-'))
let browser, server, page
try {
  const source = join(work, 'Color switch.mp4')
  execFileSync('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=red:size=320x180:rate=12:duration=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:sample_rate=48000:duration=1',
    '-vf',
    "drawbox=c=blue:t=fill:enable='gte(t,0.5)',select='eq(n,0)+eq(n,1)+eq(n,6)+eq(n,11)'",
    '-fps_mode',
    'vfr',
    '-output_ts_offset',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ])
  server = await servePages(0, process.env.FORMANT_TEST_DIST ?? 'dist')
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    acceptDownloads: true,
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByText('Phase Drift.wav', { exact: true }).waitFor({ timeout: 90000 })
  await page.locator('input[type=file][accept^="audio"]').setInputFiles(source)
  await page.getByText('Color switch.mp4', { exact: true }).waitFor({ timeout: 90000 })
  const playhead = page.getByRole('slider', { name: 'Playhead' })
  const rect = await playhead.boundingBox()
  const preview = []
  for (const [fraction, dominant] of [
    [0.25, 0],
    [0.75, 2],
    [0.25, 0],
  ]) {
    await playhead.click({ position: { x: rect.width * fraction, y: rect.height / 2 } })
    await page.waitForFunction(
      ({ fraction, dominant }) => {
        const native = document.querySelector('video'),
          clock = document.querySelector('.track-region')
        const t = Number(clock.getAttribute('aria-valuenow'))
        const el = document.querySelector('.stage-frame canvas'),
          gl = el.getContext('webgl2')
        const pixel = new Uint8Array(4)
        gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        return (
          !native.seeking &&
          Math.abs(t - fraction) < 0.06 &&
          Math.abs(native.currentTime - t - 1.978) < 0.05 &&
          pixel[dominant] > pixel[dominant === 0 ? 2 : 0] + 80
        )
      },
      { fraction, dominant },
      { timeout: 20000 }
    )
    preview.push(
      await page.evaluate(() => ({
        native: document.querySelector('video').currentTime,
        project: +document.querySelector('.track-region').getAttribute('aria-valuenow'),
      }))
    )
  }
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Export video' })
  await panel.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webm')
  await panel.getByRole('combobox', { name: 'Resolution', exact: true }).selectOption('custom')
  await panel.getByLabel('Width (px)').fill('320')
  await panel.getByLabel('Height (px)').fill('180')
  await panel.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('0')
  await panel.getByRole('button', { name: 'Render video', exact: true }).click({ timeout: 90000 })
  const link = panel.getByRole('link', { name: 'Download video' })
  await Promise.race([
    link.waitFor({ timeout: 90000 }),
    panel
      .locator('.export-error')
      .waitFor({ timeout: 90000 })
      .then(async () => {
        throw Error(await panel.locator('.export-error').innerText())
      }),
  ])
  const pending = page.waitForEvent('download')
  await link.click()
  const file = join(work, 'composite.webm')
  await (await pending).saveAs(file)
  const streams = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file])
  ).streams
  assert.deepEqual(streams.map((s) => s.codec_type).sort(), ['audio', 'video'])
  const frames = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:v',
      '-fps_mode',
      'passthrough',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  )
  const stride = 320 * 180 * 3
  assert.equal(frames.length / stride, 25)
  const rows = []
  for (const [n, channel] of [
    [6, 0],
    [18, 2],
  ]) {
    const frame = frames.subarray(n * stride, (n + 1) * stride)
    assert.equal(frame.length, stride)
    let background = 0,
      overlay = 0
    for (let i = 0; i < frame.length; i += 3) {
      if (
        frame[i + channel] > 2 * frame[i + (channel === 0 ? 2 : 0)] &&
        frame[i + channel] > 2 * frame[i + 1]
      )
        background++
      if (frame[i + 1] > 80) overlay++
    }
    assert.ok(background > (320 * 180) / 3, 'Expected source background at frame ' + n)
    assert.ok(overlay > 80, 'Missing rendered scene at frame ' + n)
    rows.push({ n, backgroundPixels: background, overlayPixels: overlay })
  }
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a', '-f', 'f32le', 'pipe:1'])
  let square = 0
  for (let i = 0; i < pcm.length; i += 4) square += pcm.readFloatLE(i) ** 2
  const rms = Math.sqrt(square / (pcm.length / 4))
  assert.ok(rms > 0.05 && rms < 0.15)
  assert.deepEqual(errors, [])
  console.log(
    'Imported VFR video and original audio, composed through Three.js and downloaded via the editor.',
    { codecs: streams.map((s) => s.codec_name), rows, rms, preview }
  )
} catch (error) {
  if (page)
    console.error(
      await page
        .locator('body')
        .ariaSnapshot()
        .then((s) => s.slice(-3500))
        .catch(() => '')
    )
  throw error
} finally {
  await browser?.close()
  server?.close()
  await rm(work, { recursive: true, force: true })
}
