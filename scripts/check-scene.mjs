// WebGL2 acceptance checks. Optional --snapshot writes the diagnostic scene to /tmp.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const video = execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'color=c=0x926c44:s=32x32:d=0.3',
  '-c:v',
  'libvpx-vp9',
  '-f',
  'webm',
  'pipe:1',
])
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'scene-test-page',
      configureServer(s) {
        s.middlewares.use('/sdr.webm', (_req, res) => {
          res.setHeader('Content-Type', 'video/webm')
          res.end(video)
        })
        s.middlewares.use('/scene-test.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html')
          res.end('<!doctype html><style>*{margin:0}canvas{display:block}</style><canvas></canvas>')
        })
      },
    },
  ],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text())
  })
  await page.goto(server.resolvedUrls.local[0] + 'scene-test.html')
  const result = await page.evaluate(async () => {
    const { SceneRenderer, readPath } = await import('/src/scene.ts')
    const { createLayer, createProject } = await import('/src/model.ts')
    const { demoFrame } = await import('/src/analysis.ts')
    const { templates } = await import('/src/templates.ts')
    const canvas = document.querySelector('canvas'),
      r = new SceneRenderer(canvas),
      p = templates[0].create(),
      t = 0.8
    const draw = (proj = p, at = t, assets = {}) =>
      r.render(proj, at, demoFrame(at), { frameAt: demoFrame, ...assets })
    r.resize(900, 506)
    draw()
    const snap = canvas.toDataURL('image/png')
    r.resize(1280, 720)
    draw()
    const gpu = r.renderer.getContext()
    const sample = new Uint8Array(4)
    const start = performance.now()
    for (let i = 0; i < 24; i++) {
      draw(p, i / 24)
      gpu.readPixels(640, 360, 1, 1, gpu.RGBA, gpu.UNSIGNED_BYTE, sample)
    }
    const frameMs = (performance.now() - start) / 24
    r.resize(320, 180)
    function pixels() {
      const gl = r.renderer.getContext(),
        bytes = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      let hash = 0,
        nonblack = 0
      for (let i = 0; i < bytes.length; i += 4) {
        hash = (Math.imul(hash, 31) + bytes[i] + bytes[i + 1] * 7 + bytes[i + 2] * 13) | 0
        if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 30) nonblack++
      }
      return { hash, nonblack }
    }
    const txt = createLayer('text')
    txt.screenSpace = true
    txt.text.content = 'FORM'
    txt.material.color = '#ffffff'
    const fixed = createProject()
    fixed.layers = [txt]
    draw(fixed)
    const locked = pixels()
    fixed.camera.orbit = 75
    draw(fixed)
    const orbited = pixels()
    txt.screenSpace = false
    txt.rotation = [15, 48, 25]
    draw(fixed)
    const rotated = pixels()
    fixed.layers.push(createLayer('visualizer', 'orb'))
    draw(fixed)
    const mixed = pixels()
    const custom = createProject()
    const caption = createLayer('text')
    custom.layers = [caption]
    caption.text.content = 'iiiillll'
    caption.text.font = 'asset-fixture'
    caption.text.fontId = 'fixture'
    draw(custom)
    const fallbackHash = pixels().hash
    const localFace = await new FontFace(
      'asset-fixture',
      'url(/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2)',
    ).load()
    document.fonts.add(localFace)
    draw(custom)
    const loadedHash = pixels().hash
    document.fonts.delete(localFace)
    const testImg = document.createElement('canvas')
    testImg.width = 2
    testImg.height = 2
    const ctx = testImg.getContext('2d')
    ctx.fillStyle = '#926c44'
    ctx.fillRect(0, 0, 2, 2)
    const bg = createProject()
    bg.layers = []
    bg.background.fit = 'stretch'
    draw(bg, t, { background: testImg })
    const rgb = new Uint8Array(4),
      gl = r.renderer.getContext()
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgb)
    const movie = document.createElement('video')
    movie.src = '/sdr.webm'
    movie.muted = true
    await new Promise((done, fail) => {
      movie.addEventListener('loadeddata', done, { once: true })
      movie.addEventListener('error', fail, { once: true })
    })
    const videoPixel = new Uint8Array(4)
    draw(bg, t, { background: movie })
    gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, videoPixel)
    ctx.drawImage(movie, 0, 0, 2, 2)
    const decodedPixel = Array.from(ctx.getImageData(0, 0, 1, 1).data)
    const tracer = templates.find((s) => s.id === 'fireflies').create()
    tracer.effects.trail = 0.75
    tracer.effects.bloom = 0.25
    for (let i = 0; i <= 6; i++) draw(tracer, i / 30)
    const continuous = pixels()
    draw(tracer, 6)
    draw(tracer, 6 / 30)
    const seek = pixels()
    // Two independently moving objects, widely separated on screen. Keep a sub-LSB
    // scene bloom enabled in the reference so all comparisons use the same AA target.
    const selective = createProject()
    selective.layers = [-1.75, 1.75].map((x) => {
      const l = createLayer('visualizer', 'polygon')
      l.position = [x, 0, 0]
      l.settings.radius = 0.4
      l.material.shading = 'unlit'
      l.material.color = '#e7f0ff'
      l.motions = [
        { enabled: true, target: 'position.y', wave: 'sine', amplitude: 1.4, period: 1.4, phase: 0 },
      ]
      return l
    })
    selective.effects.bloom = 1e-7
    function shot(at = 0.12) {
      draw(selective, at)
      const data = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data)
      return data
    }
    function halfChanges(a, b) {
      const sums = [0, 0]
      for (let i = 0; i < a.length; i += 4) {
        const half = (i / 4) % canvas.width < canvas.width / 2 ? 0 : 1
        sums[half] += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      }
      return sums
    }
    const plain = shot()
    selective.layers[0].effects.bloom = 1.5
    const leftGlow = halfChanges(plain, shot())
    selective.layers[0].effects.bloom = 0
    selective.layers[1].effects.trail = 0.9
    const glowRight = shot(),
      rightTrail = halfChanges(plain, glowRight)
    shot(0.71)
    const localSeek = halfChanges(glowRight, shot())
    selective.layers[0].effects.bloom = 1.5
    const both = halfChanges(plain, shot())
    const rear = selective.layers[0],
      front = selective.layers[1]
    rear.effects = { bloom: 0, trail: 0 }
    front.effects = { bloom: 0, trail: 0 }
    rear.motions = []
    front.motions = []
    rear.position = [0, 0, 0]
    front.position = [0, 0, 1]
    front.settings.radius = 1.5
    front.material.color = '#1f2233'
    const coveredReference = shot()
    rear.effects.bloom = 2
    const covered = halfChanges(coveredReference, shot())
    const selectiveResults = { leftGlow, rightTrail, localSeek, both, covered }
    draw(tracer, 6 / 30)
    const memo = { ...r.renderer.info.memory }
    for (let i = 0; i < 10; i++) {
      draw(fixed, i / 10)
      draw(tracer, i / 10)
    }
    const after = { ...r.renderer.info.memory }
    let unsafe = false
    try {
      readPath('<!DOCTYPE svg><svg/>')
    } catch {
      unsafe = true
    }
    const path = readPath(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 1 2 L 3 4" onclick="alert(1)"/></svg>',
    )
    let lostCaught = false,
      restored = false
    const ext = gl.getExtension('WEBGL_lose_context')
    if (ext) {
      const lost = new Promise((done) => canvas.addEventListener('webglcontextlost', done, { once: true }))
      ext.loseContext()
      await lost
      try {
        draw()
      } catch {
        lostCaught = true
      }
      const recover = new Promise((done) =>
        canvas.addEventListener('webglcontextrestored', done, { once: true }),
      )
      await new Promise((done) => setTimeout(done, 100))
      ext.restoreContext()
      await recover
      draw()
      restored = pixels().nonblack > 30
    }
    const renderer = gl.getParameter(gl.RENDERER)
    r.dispose()
    return {
      snap,
      frameMs,
      fallbackHash,
      loadedHash,
      locked,
      orbited,
      rotated,
      mixed,
      rgb: Array.from(rgb),
      videoPixel: Array.from(videoPixel),
      decodedPixel,
      selectiveResults,
      continuous,
      seek,
      memo,
      after,
      unsafe,
      path,
      lostCaught,
      restored,
      renderer,
    }
  })
  if (process.argv.includes('--snapshot'))
    await writeFile('/tmp/formant-prism.png', Buffer.from(result.snap.split(',')[1], 'base64'))
  delete result.snap
  console.log(browser.version(), result)
  assert.notEqual(result.fallbackHash, result.loadedHash)
  assert.deepEqual(result.locked, result.orbited)
  assert.ok(result.locked.nonblack > 40)
  assert.notEqual(result.locked.hash, result.rotated.hash)
  assert.notEqual(result.rotated.hash, result.mixed.hash)
  assert.deepEqual(result.continuous, result.seek)
  assert.ok(result.continuous.nonblack > 0)
  assert.ok(
    result.rgb.slice(0, 3).every((v, i) => Math.abs(v - [146, 108, 68][i]) <= 1),
    'SDR neutral grade',
  )
  assert.ok(
    result.videoPixel.every((v, i) => Math.abs(v - result.decodedPixel[i]) <= 3),
    'Direct video color vs browser-decoded SDR reference',
  )
  const { leftGlow, rightTrail, localSeek, both } = result.selectiveResults
  assert.ok(leftGlow[0] > 1000)
  assert.equal(leftGlow[1], 0)
  assert.equal(rightTrail[0], 0)
  assert.ok(rightTrail[1] > 1000)
  assert.deepEqual(localSeek, [0, 0])
  assert.deepEqual(result.selectiveResults.covered, [0, 0])
  assert.deepEqual(both, [leftGlow[0], rightTrail[1]])
  assert.deepEqual(result.after, result.memo)
  assert.equal(result.unsafe, true)
  assert.equal(result.path, 'M 1 2 L 3 4')
  assert.equal(result.lostCaught, true)
  assert.equal(result.restored, true)
  // Drive TransformControls through real pointer events; dragging the X arrow commits once.
  await page.evaluate(async () => {
    const { SceneRenderer } = await import('/src/scene.ts'),
      { createProject } = await import('/src/model.ts'),
      { silentFrame } = await import('/src/analysis.ts')
    const canvas = document.querySelector('canvas')
    canvas.style.width = '600px'
    canvas.style.height = '400px'
    const r = new SceneRenderer(canvas),
      p = createProject()
    p.layers[0].style = 'orb'
    r.resize(600, 400)
    r.setGizmo(
      p.layers[0].id,
      'translate',
      (id, field, value) => window.dragCommits.push({ id, field, value }),
      0.25,
    )
    window.dragCommits = []
    r.render(p, 0, silentFrame)
    if (r.pick(300, 200) !== p.layers[0].id || r.pick(2, 2) !== null) throw Error('Layer raycast failed')
    window.endDragTest = () => r.dispose()
  })
  await page.mouse.move(329, 200)
  await page.mouse.down()
  await page.mouse.move(397, 200, { steps: 12 })
  await page.mouse.up()
  const commits = await page.evaluate(() => {
    window.endDragTest()
    return window.dragCommits
  })
  console.log('Gizmo drag commits', commits)
  assert.equal(commits.length, 1)
  assert.equal(commits[0].field, 'position')
  assert.ok(commits[0].value[0] > 0.25)
  assert.equal(commits[0].value[0] % 0.25, 0)
  assert.deepEqual(commits[0].value.slice(1), [0, 0])
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await server.close()
}
