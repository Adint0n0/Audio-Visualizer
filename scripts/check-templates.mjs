// Run with --write to refresh the gallery thumbnails after a design change.
import { build, preview } from 'vite'
import { chromium } from 'playwright'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const outDir = await mkdtemp(join(tmpdir(), 'formant-templates-'))
const write = process.argv.includes('--write')
const palettes = process.argv.includes('--palettes')
// Select a measured passage for the still. The comparison sweeps use the same input for every design.
const stereoScopes = new Set(['phase-portrait', 'stereo-window'])
const traces = new Set(['single-trace', 'oscillograph', 'ribbon-stack', 'crossfeed', 'quiet-interval'])
const broadSpectrum = new Set([
  'level-meter',
  'inverted-display',
  'cartridge',
  'pocket-radio',
  'crystal-organ',
  'stairwell',
  'polar-needle',
  'comb-filter',
  'open-dial',
  'twin-rail',
  'halo-index',
  'electric-spine',
  'signal-arch',
  'laser-harp',
  'phosphor-scan',
  'east-west',
])
function cue(id) {
  if (stereoScopes.has(id)) return { genre: 'ambient', time: 2.517 }
  if (traces.has(id)) return { genre: 'acoustic', time: 3.867 }
  if (broadSpectrum.has(id)) return { genre: 'breakbeat', time: 4.767 }
  return { genre: 'dance', time: 2.867 }
}
const reviewArg = process.argv.indexOf('--audit')
const reviewDir = reviewArg < 0 ? null : process.argv[reviewArg + 1]
if (reviewArg >= 0 && !reviewDir) throw Error('--audit requires an output directory')
// A previous checkout can be sampled through exactly the same input, cue and resolution.
const sourceArg = process.argv.indexOf('--source')
if (sourceArg >= 0 && (!process.argv[sourceArg + 1] || write))
  throw Error('--source requires a checkout path and cannot be combined with --write')
const aliases =
  sourceArg < 0
    ? []
    : ['templates', 'model', 'scene'].map((name) => ({
        find: '../src/' + name,
        replacement: resolve(process.argv[sourceArg + 1], 'src', name + '.ts'),
      }))
let server, browser
try {
  await build({
    configFile: false,
    logLevel: 'error',
    publicDir: false,
    resolve: { alias: aliases },
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
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource'))
      errors.push(msg.text())
  })
  await page.goto(server.resolvedUrls.local[0] + 'tests/templates.html')
  await page.waitForFunction(() => window.ids?.length === 60)
  const allIds = await page.evaluate(() => window.ids)
  const only = process.argv.indexOf('--only')
  const ids = only < 0 ? allIds : [...new Set((process.argv[only + 1] ?? '').split(','))]
  for (const id of ids) assert.ok(allIds.includes(id), 'Unknown template ' + id)
  if (write) await mkdir('public/templates', { recursive: true })
  let count = 0
  const log = []
  if (reviewDir) await mkdir(reviewDir, { recursive: true })
  const variants = [
    { width: 480, height: 270, genre: 'dance', time: 2.39 },
    { width: 256, height: 256, genre: 'ambient', time: 3.17 },
    { width: 180, height: 320, genre: 'acoustic', time: 1.82 },
  ]
  if (reviewDir)
    variants.push(
      { width: 320, height: 180, genre: 'dance', time: 2.39 },
      { width: 320, height: 180, genre: 'ambient', time: 2.39 },
      { width: 320, height: 180, genre: 'breakbeat', time: 3.96 },
      { width: 320, height: 180, genre: 'silence', time: 2.39 },
      { width: 320, height: 180, genre: 'dance', time: 3.867 },
    )
  for (const [index, variant] of variants.entries()) {
    const { width, height } = variant
    for (const id of ids) {
      const primary = index === 0
      const { genre, time } = primary ? cue(id) : variant
      const save = Boolean((primary && write) || reviewDir)
      const { uri, ...metrics } = await page.evaluate(
        (args) => window.renderTemplate(...args),
        [id, width, height, save, genre, time],
      )
      // Waveform-only presets may collapse to a baseline or a point for silent stereo.
      if (genre !== 'silence')
        assert.ok(
          metrics.luminanceVariation > 16 && metrics.brightPixels >= 12,
          id +
            ' ' +
            width +
            '×' +
            height +
            ' ' +
            genre +
            ': insufficient visible geometry (' +
            metrics.brightPixels +
            ' pixels)',
        )
      assert.ok(metrics.clipped < 0.3, id + ' filled more than 30% of the screen with clipped white')
      if (uri) {
        assert.ok(uri.startsWith('data:image/webp;base64,'))
        const file = Buffer.from(uri.split(',')[1], 'base64')
        if (primary && write) await writeFile('public/templates/' + id + '.webp', file)
        if (reviewDir) await writeFile(join(reviewDir, id + '-' + index + '.webp'), file)
      }
      log.push({ id, width, height, genre, time, ...metrics })
      count++
    }
    console.log(
      'PASS',
      ids.length + ' designs',
      width + '×' + height,
      index === 0 ? 'gallery cues' : variant.genre + ' ' + variant.time + 's',
    )
  }
  if (reviewDir) {
    await writeFile(join(reviewDir, 'frames.json'), JSON.stringify(log, null, 2))
    for (const id of ids) {
      const frames = log.filter((f) => f.id === id && f.width === 320)
      assert.notEqual(
        frames[0].hash,
        frames[1].hash,
        id + ' did not respond to changing the soundtrack at the same time',
      )
      assert.notEqual(
        frames[0].hash,
        frames[4].hash,
        id + ' did not change with time under the same soundtrack',
      )
      assert.notEqual(
        frames[0].hash,
        frames[3].hash,
        id + ' did not respond to switching between a beat and silence',
      )
    }
  }
  if (palettes) {
    for (const id of ids) {
      const hashes = []
      const { genre, time } = cue(id)
      for (const key of ['original', 'aurora', 'ember', 'ice']) {
        const frame = await page.evaluate(
          (args) => window.renderTemplate(...args),
          [id, 192, 108, false, genre, time, key],
        )
        hashes.push(frame.hash)
      }
      assert.equal(new Set(hashes).size, 4, id + ' did not render four different colorways')
    }
    console.log('PASS', ids.length * 4, 'same-input colorway renders')
  }
  await page.evaluate(() => window.finishRenderer())
  assert.deepEqual(errors, [])
  console.log('PASS', count + ' rendered and read-back frames, Chromium ' + browser.version())
} finally {
  await browser?.close()
  if (server) await new Promise((resolve) => server.httpServer.close(resolve))
  await rm(outDir, { recursive: true, force: true })
}
