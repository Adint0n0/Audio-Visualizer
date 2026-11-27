// Isolated real WebGL checks for the four reference-driven instruments.
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  server: { hmr: false, watch: null, host: '127.0.0.1', port: 0 },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text())
  })
  await page.goto(server.resolvedUrls.local[0] + 'tests/templates.html')
  for (const style of ['galaxy', 'radial', 'diodes', 'globe']) {
    const { images, stats } = await page.evaluate(async (style) => {
      const { createProject, createLayer } = await import('/src/model.ts')
      const { SceneRenderer } = await import('/src/scene.ts')
      const { demoFrame, silentFrame } = await import('/src/analysis.ts')
      const c = document.createElement('canvas'),
        engine = new SceneRenderer(c),
        p = createProject(),
        l = createLayer('visualizer', style)
      Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: '360px', height: '202px' })
      document.body.append(c)
      p.layers = [l]
      p.background.color = '#050811'
      p.camera.position = [0, 0, 8]
      const palettes = {
        galaxy: ['#ffe7ae', '#ef9564', '#f498ed', '#687bff', '#6cbfff'],
        radial: ['#6cf1e8', '#79bdfd', '#e895fb', '#ffaf77'],
        diodes: ['#55f0cb', '#d6fb72', '#ffb056', '#fc505b'],
        globe: ['#ffac6c', '#e6839f', '#796dff', '#60d4ff'],
      }
      l.material.colorMode = 'position'
      l.material.stops = palettes[style].map((color, i, a) => ({ at: i / (a.length - 1), color }))
      Object.assign(l.settings, {
        count: style === 'galaxy' ? 380 : 160,
        radius: style === 'galaxy' ? 2.7 : 1.7,
        width: style === 'diodes' ? 0.091 : 0.06,
        columns: 64,
        rows: 20,
        spacing: 0.025,
        depth: 0.04,
        gain: 1.3,
        speed: 0.6,
        maxHeight: 1.0,
      })
      const t = 3.3,
        frame = demoFrame(t)
      engine.resize(900, 506)
      engine.render(p, t, frame)
      const images = c.toDataURL('image/png').split(',')[1]
      engine.resize(360, 202)
      const gl = engine.renderer.getContext()
      function read(a, time = t) {
        engine.render(p, time, a)
        const b = new Uint8Array(c.width * c.height * 4)
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, b)
        return b
      }
      const shot = read(frame),
        quiet = read(silentFrame)
      const bandFrame = (u) => ({
        ...silentFrame,
        bands: Float32Array.from({ length: 96 }, (_, i) => Math.exp(-50 * (i / 95 - u) ** 2)),
        music: undefined,
      })
      const bass = read(bandFrame(0.12)),
        high = read(bandFrame(0.83)),
        displaced = read(frame, t + 1.4),
        again = read(frame)
      function diff(a, b) {
        let d = 0
        for (let i = 0; i < a.length; i += 4)
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 5) d++
        return d
      }
      const stats = {
        quiet: diff(shot, quiet),
        bands: diff(bass, high),
        time: diff(shot, displaced),
        repeat: diff(shot, again),
      }
      const box = engine.selectionBounds(l.id),
        radius = engine.focusBounds(l.id)?.radius
      if (!box || !radius || box.right - box.left < 35 || box.bottom - box.top < 20)
        throw Error('Invalid selection footprint for ' + style)
      const center = engine.pick(180, 101),
        ring = engine.pick(232, 101)
      if (style === 'radial' ? center !== null || ring !== l.id : center !== l.id)
        throw Error('GPU picking failed for ' + style)
      if (engine.pick(1, 1) !== null) throw Error('False positive pick outside layer')
      if (style !== 'diodes') l.settings.radius *= 1.6
      else l.settings.width *= 1.8
      read(frame)
      const larger = engine.focusBounds(l.id)?.radius
      if (!larger || larger < radius * 1.3) throw Error('GPU focus bounds did not expand with shape')
      engine.dispose()
      c.remove()
      return { images, stats }
    }, style)
    if (process.argv.includes('--images'))
      await writeFile('/tmp/formant-' + style + '.png', Buffer.from(images, 'base64'))
    console.log(style, stats)
    if (errors.length) throw Error(errors.join('\n'))
    assert.ok(stats.quiet > 12 && stats.bands > 12)
    assert.equal(stats.repeat, 0)
    if (style !== 'diodes') assert.ok(stats.time > 12)
  }
} finally {
  await browser?.close()
  await server.close()
}
