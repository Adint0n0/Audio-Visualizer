// Run from repository root. Requires FFmpeg, ffprobe and Chromium or Playwright Chromium.
import { chromium } from 'playwright'
import { build } from 'vite'
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const dir = await mkdtemp(join(tmpdir(), 'formant-codecs-'))
const ff = (cmd, args, extra = {}) => execFileSync(cmd, args, { maxBuffer: 24 * 1024 * 1024, ...extra })
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webm': 'video/webm', '.mp4': 'video/mp4' }
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname
    const data = await readFile(join(dir, path))
    if (path.endsWith('.html'))
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob:",
      )
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(data)
  } catch {
    res.writeHead(404).end()
  }
})
let browser
try {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: { outDir: dir, emptyOutDir: false, rollupOptions: { input: 'tests/export-fixture.html' } },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await access('/usr/bin/chromium')
      .then(() => '/usr/bin/chromium')
      .catch(() => undefined))
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + server.address().port + '/tests/export-fixture.html')
  await page.waitForFunction(() => typeof window.runExportTest === 'function')
  console.log('Chromium', browser.version())
  async function render(o, mode = 'normal', source) {
    const before = Date.now()
    const result = await page.evaluate(
      ([o, mode, source]) => window.runExportTest(o, mode, source),
      [o, mode, source],
    )
    if (!result.supported) {
      console.log('UNSUPPORTED', o.container, o.videoCodec, result.reason)
      return null
    }
    if (mode === 'cancel') {
      assert.equal(result.canceled, true)
      return
    }
    const filename = [o.container, o.videoCodec, mode, o.width, o.end].join('-') + '.' + o.container
    const path = join(dir, filename)
    await writeFile(path, Buffer.from(result.data, 'base64'))
    const metadata = JSON.parse(
      ff('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]),
    )
    const video = metadata.streams.find((s) => s.codec_type === 'video')
    const audio = metadata.streams.find((s) => s.codec_type === 'audio')
    assert.equal(video.width, o.width)
    assert.equal(video.height, o.height)
    assert.equal(audio.channels, 2)
    assert.equal(audio.sample_rate, '48000')
    const frames = JSON.parse(
      ff('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v',
        '-show_frames',
        '-show_entries',
        'frame=best_effort_timestamp_time',
        '-of',
        'json',
        path,
      ]),
    ).frames
    const expectedFrames = Math.ceil((o.end - o.start) * o.fps - 1e-9)
    if (mode !== 'copy') {
      assert.equal(frames.length, expectedFrames)
      assert.ok(Math.abs(Number(metadata.format.duration) - (o.end - o.start)) <= Math.max(1 / o.fps, 0.045))
      for (const [i, f] of frames.entries())
        assert.ok(Math.abs(Number(f.best_effort_timestamp_time) - i / o.fps) < 0.002)
    }
    console.log(
      'PASS',
      filename,
      video.codec_name,
      audio.codec_name,
      result.audioMode,
      frames.length + ' frames',
      metadata.format.duration + 's',
      Date.now() - before + 'ms',
    )
    return { path, filename, audioMode: result.audioMode }
  }
  const base = {
    start: 0.125,
    end: 1.375,
    fps: 20,
    width: 320,
    height: 180,
    videoBitrate: 1600000,
    audioBitrate: 256000,
  }
  const validated = []
  let mp4Path
  for (const [container, codecs] of [
    ['webm', ['vp9', 'av1']],
    ['mp4', ['avc', 'av1', 'vp9']],
  ]) {
    let movie
    for (const videoCodec of codecs) {
      const o = { ...base, container, videoCodec }
      movie = await render(o)
      if (!movie) continue
      const gray = ff('ffmpeg', [
        '-v',
        'error',
        '-i',
        movie.path,
        '-an',
        '-vf',
        'scale=1:1,format=gray',
        '-pix_fmt',
        'gray',
        '-f',
        'rawvideo',
        '-',
      ])
      const pcm = ff('ffmpeg', [
        '-v',
        'error',
        '-i',
        movie.path,
        '-vn',
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        '-',
      ])
      const sound = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4)
      for (const target of [0.15, 0.65, 1.15]) {
        const center = Math.round(target * 48000)
        let peak = 0,
          idx = 0
        for (let i = center - 4800; i < center + 4800; i++) {
          if (Math.abs(sound[i * 2]) > peak) {
            peak = Math.abs(sound[i * 2])
            idx = i
          }
        }
        assert.ok(peak > 0.1)
        const brightness = gray[Math.round(target * o.fps)]
        assert.ok(brightness > 150, 'Expected flash at ' + target + ' got ' + brightness)
        const diff = idx / 48000 - target
        console.log('click/flash', target, diff.toFixed(5) + 's')
        assert.ok(Math.abs(diff) < 1 / o.fps)
      }
      const copied = await render(
        { ...o, start: 0, end: base.end - base.start },
        'copy',
        '/' + movie.filename,
      )
      assert.equal(copied?.audioMode, 'copy')
      const hashes = (path) =>
        ff('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'a',
          '-show_packets',
          '-show_entries',
          'packet=data_hash',
          '-show_data_hash',
          'sha256',
          '-of',
          'csv=p=0',
          path,
        ])
          .toString()
          .trim()
          .split('\n')
          .map((s) => s.match(/SHA256:[a-f0-9]+/i)?.[0])
          .filter(Boolean)
      const copies = hashes(copied.path),
        originals = hashes(movie.path)
      assert.ok(copies.length > 1)
      assert.deepEqual(copies, originals)
      await render(o, 'cancel')
      if (container === 'mp4') mp4Path = movie.path
      validated.push(o)
      break
    }
    assert.ok(movie, 'No usable output for ' + container)
  }
  const retained = await page.evaluate(async () => {
    const entries = []
    for await (const [n] of await navigator.storage.getDirectory())
      if (n.startsWith('formant-export-')) entries.push(n)
    return entries
  })
  assert.deepEqual(retained, [])
  const mp4 = validated.find((o) => o.container === 'mp4')
  const delayedPath = join(dir, 'delayed.mp4')
  ff('ffmpeg', [
    '-v',
    'error',
    '-i',
    mp4Path,
    '-itsoffset',
    '0.35',
    '-i',
    mp4Path,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c',
    'copy',
    delayedPath,
  ])
  const getAudioStart = (path) =>
    Number(
      ff('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=start_time',
        '-of',
        'csv=p=0',
        path,
      ])
        .toString()
        .trim(),
    )
  const firstAudio = getAudioStart(delayedPath)
  assert.ok(firstAudio > 0.25 && firstAudio < 0.4)
  for (const [options, audioMode] of [
    [{ ...mp4, start: 0, end: 1.65 }, 'copy'],
    [{ ...validated[0], start: 0.125, end: 1.4 }, 'encode'],
  ]) {
    const result = await render(options, 'normal', '/delayed.mp4')
    assert.equal(result.audioMode, audioMode)
    const delta = getAudioStart(result.path) - (firstAudio - options.start)
    assert.ok(Math.abs(delta) < 0.035, 'Audio offset changed by ' + delta)
    console.log('PASS delayed audio', audioMode, 'offset deviation', delta.toFixed(5) + 's')
  }
  const pcm = await render({ ...mp4, start: 0, end: 1.5 })
  assert.equal(pcm?.audioMode, 'copy')
  console.log('PASS ISO PCM packet-copy in MP4')
  const quality = await render({ ...validated[0], quantizer: 22 })
  if (quality) console.log('PASS constant-quality Q22')
  const realAudio = await page.evaluate(() => typeof AudioEncoder !== 'undefined')
  await page.evaluate(() => {
    Object.defineProperty(window, 'AudioEncoder', { configurable: true, value: undefined })
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => {
        throw new DOMException('Unavailable', 'NotSupportedError')
      },
    })
  })
  const portable = await render(mp4)
  assert.equal(portable?.audioMode, 'encode')
  console.log(
    'PASS AAC fallback and bounded RAM mux target under Pages-compatible CSP, prior native AudioEncoder:',
    realAudio,
  )
  await page.reload()
  await page.waitForFunction(() => typeof window.runExportTest === 'function')
  await page.evaluate(() =>
    Object.defineProperty(navigator.storage, 'estimate', {
      configurable: true,
      value: async () => ({ quota: 1000, usage: 1000 }),
    }),
  )
  await assert.rejects(() => render(validated[0]), /Insufficient storage/)
  console.log('PASS storage rejection')
  await page.reload()
  await page.waitForFunction(() => typeof window.runExportTest === 'function')
  if (process.argv.includes('--stress')) {
    for (const [width, height, fps, seconds] of [
      [3840, 2160, 60, 0.25],
      [1920, 1080, 24, 60],
    ]) {
      const o = { ...validated[0], width, height, fps, end: seconds, start: 0, videoBitrate: 24000000 }
      assert.ok(await render(o))
    }
    const longFile = join(dir, 'long.m4a')
    const clickGraph =
      '[1:a]asplit=3[a][b][c];[a]adelay=1000[x];[b]adelay=900000[y];[c]adelay=1798000[z];[0:a][x][y][z]amix=inputs=4:normalize=0'
    ff('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=800:sample_rate=48000:duration=0.02',
      '-filter_complex',
      clickGraph,
      '-t',
      '1799.5',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      longFile,
    ])
    const long = await render(
      { ...mp4, width: 1920, height: 1080, fps: 1, start: 0, end: 1799.5 },
      'normal',
      '/long.m4a',
    )
    assert.equal(long?.audioMode, 'copy')
    for (const t of [1, 900, 1798]) {
      const pts = ff('ffmpeg', [
        '-v',
        'error',
        '-ss',
        String(t - 0.25),
        '-i',
        long.path,
        '-vn',
        '-t',
        '0.5',
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        '-',
      ])
      const samples = new Float32Array(pts.buffer, pts.byteOffset, pts.length / 4)
      let peak = 0,
        at = -1
      for (let i = 0; i < samples.length; i += 2) {
        if (Math.abs(samples[i]) > peak) {
          peak = Math.abs(samples[i])
          at = i / 2
        }
      }
      assert.ok(peak > 0.02 && Math.abs(at / 48000 - 0.25) < 0.05)
      const flash = ff('ffmpeg', [
        '-v',
        'error',
        '-ss',
        String(t),
        '-i',
        long.path,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        'scale=1:1,format=gray',
        '-pix_fmt',
        'gray',
        '-f',
        'rawvideo',
        '-',
      ])
      assert.ok(flash[0] > 150)
      console.log('Long click/flash', t, (at / 48000 - 0.25).toFixed(5) + 's')
    }
    const ntsc = { ...validated[0], fps: 30000 / 1001, start: 0, end: 1.337 }
    assert.ok(await render(ntsc))
  }
} finally {
  await browser?.close()
  server.close()
  await rm(dir, { recursive: true, force: true })
}
