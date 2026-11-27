// Render measured local media features into the shipped instruments and compare real WebGL pixels.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
  const page = await browser.newPage()
  await page.route('**/music-response.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Music response</title>' }),
  )
  await page.goto(server.resolvedUrls.local[0] + 'music-response.html')
  const results = await page.evaluate(async () => {
    const [{ makeMusicFixture }, { openMedia }, { SceneRenderer }, { templates }, { silentFrame }] =
      await Promise.all([
        import('/tests/fixtures/rhythm.ts'),
        import('/src/media.ts'),
        import('/src/scene.ts'),
        import('/src/templates.ts'),
        import('/src/analysis.ts'),
      ])
    function waveFile(genre) {
      const f = makeMusicFixture(genre, 8),
        count = f.left.length,
        buffer = new ArrayBuffer(44 + count * 4),
        v = new DataView(buffer)
      function label(at, s) {
        for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
      }
      label(0, 'RIFF')
      v.setUint32(4, buffer.byteLength - 8, true)
      label(8, 'WAVE')
      label(12, 'fmt ')
      v.setUint32(16, 16, true)
      v.setUint16(20, 1, true)
      v.setUint16(22, 2, true)
      v.setUint32(24, f.rate, true)
      v.setUint32(28, f.rate * 4, true)
      v.setUint16(32, 4, true)
      v.setUint16(34, 16, true)
      label(36, 'data')
      v.setUint32(40, count * 4, true)
      for (let i = 0; i < count; i++) {
        v.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, f.left[i])) * 32767), true)
        v.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, f.right[i])) * 32767), true)
      }
      return new File([buffer], genre + '.wav', { type: 'audio/wav' })
    }
    const width = 320,
      height = 180,
      frames = {}
    for (const genre of ['dance', 'acoustic', 'breakbeat', 'ambient']) {
      const media = await openMedia(waveFile(genre), { analysis: { fftSize: 1024 } })
      try {
        let at = 2,
          best = -1
        for (let n = 120; n < 240; n++) {
          const a = media.frame(n / 60),
            strength = a.music.transient + a.rms
          if (strength > best) {
            best = strength
            at = n / 60
          }
        }
        const sample = media.frame(at)
        // The sampled frame retains its feature history while native decoding resources are released.
        frames[genre] = { at, frame: sample }
      } finally {
        media.dispose()
      }
    }
    const canvas = document.createElement('canvas'),
      renderer = new SceneRenderer(canvas)
    const gl = renderer.renderer.getContext(),
      rows = []
    renderer.resize(width, height)
    function pixels(project, signal) {
      renderer.render(project, 2.75, signal)
      const result = new Uint8Array(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, result)
      if (gl.getError() !== gl.NO_ERROR) throw Error('GPU readback failed')
      return result
    }
    const difference = (a, b) => {
      let changed = 0
      for (let i = 0; i < a.length; i += 4)
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 8)
          changed++
      return changed
    }
    try {
      for (const name of ['Binary Stars', 'Halo Index', 'Level Meter', 'Liquid Pearl']) {
        const project = templates.find((item) => item.name.en === name).create()
        const quiet = pixels(project, silentFrame)
        const dance = pixels(project, frames.dance.frame)
        for (const [genre, { at, frame }] of Object.entries(frames)) {
          const shot = pixels(project, frame)
          pixels(project, silentFrame)
          rows.push({
            name,
            genre,
            at,
            tempo: frame.music.tempo,
            changed: difference(quiet, shot),
            vsDance: difference(dance, shot),
            repeat: difference(shot, pixels(project, frame)),
          })
        }
      }
    } finally {
      renderer.dispose()
    }
    return rows
  })
  console.table(results)
  assert.equal(results.length, 16)
  for (const r of results) {
    assert.ok(r.changed > 20, r.name + ' / ' + r.genre + ' shows no source response')
    assert.equal(r.repeat, 0, r.name + ' / ' + r.genre + ' random-access mismatch')
    if (r.genre !== 'dance') assert.ok(r.vsDance > 20, r.name + ' did not distinguish ' + r.genre)
  }
} finally {
  await browser?.close()
  await server.close()
}
