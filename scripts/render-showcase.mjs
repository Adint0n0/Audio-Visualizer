// Render four consecutive excerpts of the original demo through the installed editor.
// Requires a production build, Chromium with WebGL 2, FFmpeg, and ffprobe.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import { servePages } from './serve-pages.mjs'

const destination = resolve(process.argv[2] || 'docs/touch-studio-demo.mp4')
const seconds = 2,
  fps = 30,
  width = 1280,
  height = 720
const scenes = ['Binary Stars', 'Halo Index', 'Level Meter', 'Liquid Pearl']
const work = await mkdtemp(join(tmpdir(), 'formant-showcase-'))
const server = await servePages(0, process.env.FORMANT_BUILD || 'dist')
const ffprobe = (path) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path],
      { encoding: 'utf8' },
    ),
  )
const clickButton = async (page, name) => page.getByRole('button', { name, exact: true }).click()
const pct = (numbers, p) =>
  numbers.toSorted((a, b) => a - b)[Math.min(numbers.length - 1, Math.floor(numbers.length * p))]
async function captureClip(page, file, start, length) {
  await clickButton(page, 'Export')
  const dialog = page.getByRole('dialog', { name: 'Export video' })
  await dialog.getByRole('combobox', { name: /^Resolution/ }).selectOption('0')
  await dialog.getByRole('combobox', { name: /^Frame rate/ }).selectOption('3')
  await dialog.getByRole('combobox', { name: /^Format$/ }).selectOption('mp4')
  await dialog.getByRole('combobox', { name: /^Audio format/ }).selectOption('compatible')
  // Lift the previous end first, so repeated scene exports can retain settings.
  await dialog.getByRole('spinbutton', { name: 'End (s)' }).fill(String(start + length))
  await dialog.getByRole('spinbutton', { name: 'Start (s)' }).fill(String(start))
  const render = dialog.getByRole('button', { name: 'Render video' })
  await render.waitFor()
  await page.waitForFunction(
    () => document.querySelector('.export-modal footer button')?.disabled === false,
    undefined,
    { timeout: 90000 },
  )
  const codecs = dialog.getByRole('combobox', { name: 'Video codec' })
  await codecs.selectOption('avc')
  const before = performance.now()
  await render.click()
  const link = dialog.getByRole('link', { name: 'Download video' })
  await link.waitFor({ timeout: 360000 })
  const renderMs = Math.round(performance.now() - before)
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  await download.saveAs(file)
  await dialog.getByRole('button', { name: 'Close' }).click()
  return renderMs
}

let browser, page
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  const errors = [],
    violations = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (/content security policy|THREE.WebGLProgram.*Error/i.test(m.text())) violations.push(m.text())
  })
  // Count actual draws in requestAnimationFrame callbacks, rather than assuming every callback
  // draws a scene or treating the requested preview FPS as measured performance.
  await page.addInitScript(() => {
    window.sceneSubmissions = null
    let current = null
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) =>
      raf((t) => {
        current = { time: t, calls: 0 }
        try {
          callback(t)
        } finally {
          if (window.sceneSubmissions && current.calls) {
            const previous = window.sceneSubmissions.at(-1)
            if (previous?.time === current.time) previous.calls += current.calls
            else window.sceneSubmissions.push(current)
          }
          current = null
        }
      })
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const draw = WebGL2RenderingContext.prototype[method]
      WebGL2RenderingContext.prototype[method] = function (...args) {
        if (current && window.sceneSubmissions && this.canvas.isConnected) current.calls++
        return draw.apply(this, args)
      }
    }
  })
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  await page.locator('.export-btn:enabled').waitFor({ timeout: 90000 })
  await context.setOffline(true)
  const measurement = []
  for (const [index, name] of scenes.entries()) {
    // New desktop layouts may default to another panel on a restored project.
    const search = page.getByRole('textbox', { name: 'Search templates' })
    if (!(await search.isVisible())) await clickButton(page, 'Library')
    await search.fill(name)
    await page.locator('.template-pick').first().click()
    await clickButton(page, 'Replace scene')
    await page.waitForFunction(() => !document.querySelector('.stage-error'))
    const timeline = page.locator('.timeline')
    await clickButton(page, 'Range')
    await timeline.getByRole('spinbutton', { name: 'End (s)' }).fill('16')
    await timeline.getByRole('spinbutton', { name: 'Start (s)' }).fill('0')
    await clickButton(page, 'Range')
    const video = page.locator('video').first()
    await video.evaluate(
      (el, time) => {
        el.currentTime = time
      },
      2 + index * seconds,
    )
    await clickButton(page, 'Play')
    await page.waitForFunction(() => !document.querySelector('video').paused)
    await page.evaluate(() => {
      window.sceneSubmissions = []
    })
    await page.waitForTimeout(2500)
    // In software rendering, a large first shader compilation can consume the initial
    // sample interval. Keep measuring enough submitted frames to compute meaningful deltas.
    await page.waitForFunction(() => window.sceneSubmissions.length >= 4, undefined, { timeout: 10000 })
    const submissions = await page.evaluate(() => {
      const samples = window.sceneSubmissions
      window.sceneSubmissions = null
      return samples
    })
    await clickButton(page, 'Pause')
    assert.ok(submissions.length >= 2, name + ' did not draw during playback')
    const frameTimes = submissions.slice(1).map((f, i) => f.time - submissions[i].time)
    const dims = await page
      .locator('.stage-frame canvas')
      .first()
      .evaluate((el) => [el.width, el.height])
    const file = join(work, index + '.mp4')
    const start = 2 + index * seconds
    const renderMs = await captureClip(page, file, start, seconds)
    const probe = ffprobe(file),
      v = probe.streams.find((s) => s.codec_type === 'video'),
      a = probe.streams.find((s) => s.codec_type === 'audio')
    assert.equal(Number(v.nb_read_frames), seconds * fps)
    assert.equal(v.width, width)
    assert.equal(v.height, height)
    assert.equal(a.codec_name, 'aac')
    assert.equal(v.codec_name, 'h264')
    // AAC priming can give each source MP4 a negative start timestamp. Demux the
    // visual track before concatenating to keep every video PTS relative to zero.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      join(work, 'visual-' + index + '.mp4'),
    ])
    // Sample decoded pixels from every sixth frame. Quantify change as mean absolute RGB delta.
    const bytes = execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      file,
      '-an',
      '-vf',
      'fps=5,scale=64:36',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-',
    ])
    const size = 64 * 36 * 3
    let difference = 0,
      visible = 0
    for (let i = 0; i < bytes.length; i++) {
      if (i >= size) difference += Math.abs(bytes[i] - bytes[i - size])
      if (bytes[i] > 20) visible++
    }
    const delta = Number((difference / (bytes.length - size)).toFixed(2)),
      lit = Number(((100 * visible) / bytes.length).toFixed(1))
    assert.ok(lit > 0.2 && delta > 0.1, 'Scene is blank or static: ' + name)
    measurement.push({
      name,
      preview: dims,
      framesSampled: submissions.length,
      previewFps: Number(((1000 * frameTimes.length) / frameTimes.reduce((a, b) => a + b, 0)).toFixed(2)),
      p95FrameMs: Number(pct(frameTimes, 0.95).toFixed(1)),
      medianDrawCalls: pct(
        submissions.map((x) => x.calls),
        0.5,
      ),
      renderMs,
      rgbDelta: delta,
      litRgbPercent: lit,
    })
    console.log('PASS', JSON.stringify(measurement.at(-1)))
    if (index === 0) {
      const reference = join(work, 'full-preview.mp4')
      await captureClip(page, reference, start, 0.1)
      const previewOptions = page.getByTitle('Preview settings', { exact: true })
      await previewOptions.click()
      const resolution = page.locator('.view-options').getByRole('combobox', { name: 'Resolution' })
      const original = await resolution.inputValue()
      await resolution.selectOption('0.5')
      await previewOptions.click()
      const repeat = join(work, 'low-preview.mp4')
      await captureClip(page, repeat, start, 0.1)
      await previewOptions.click()
      await resolution.selectOption(original)
      await previewOptions.click()
      const firstThree = (path) =>
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-i',
          path,
          '-an',
          '-frames:v',
          '3',
          '-vf',
          'scale=96:54',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          '-',
        ])
      const before = firstThree(reference),
        after = firstThree(repeat)
      assert.equal(before.length, 96 * 54 * 3 * 3)
      assert.equal(after.length, before.length)
      const rms = Math.sqrt(before.reduce((sum, n, i) => sum + (n - after[i]) ** 2, 0) / before.length)
      assert.ok(rms < 3, 'Preview quality altered offline output: ' + rms)
      console.log(
        'Preview 0.5× versus 1×, first three decoded export frames: RMS RGB difference',
        rms.toFixed(3),
        '/255',
      )
    }
  }
  const list = join(work, 'clips.txt')
  await writeFile(list, scenes.map((_, i) => `file 'visual-${i}.mp4'\nduration ${seconds}\n`).join(''))
  // Concatenate encoded editor video without another visual compression pass. Encode the
  // contiguous original music region once to avoid four separate AAC priming boundaries.
  await mkdir(dirname(destination), { recursive: true })
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '1',
    '-i',
    list,
    '-ss',
    '2',
    '-i',
    'public/demo/phase-drift.wav',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-t',
    String(scenes.length * seconds),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '256k',
    '-movflags',
    '+faststart',
    destination,
  ])
  const probe = ffprobe(destination),
    v = probe.streams.find((s) => s.codec_type === 'video'),
    a = probe.streams.find((s) => s.codec_type === 'audio')
  assert.ok(a && a.codec_name === 'aac')
  assert.equal(Number(v.nb_read_frames), scenes.length * seconds * fps)
  assert.ok(Math.abs(Number(probe.format.duration) - scenes.length * seconds) < 0.06)
  assert.ok(Math.abs(Number(v.start_time)) < 0.001)
  assert.deepEqual(errors, [])
  assert.deepEqual(violations, [])
  console.log(
    'Chromium',
    browser.version(),
    '1440×960 SwiftShader preview. Output:',
    destination,
    probe.format.size,
    'bytes',
    probe.format.duration,
    's',
  )
} catch (error) {
  if (page)
    console.error(
      await page
        .locator('[role=alert],.export-info')
        .allTextContents()
        .catch(() => []),
    )
  throw error
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(work, { recursive: true, force: true })
}
