// Independent demux/PTS and worker integration check. Optional --long analyzes 29m59s of mono PCM.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const work = await mkdtemp(join(tmpdir(), 'formant-media-'))
const make = (name, args) => {
  const path = join(work, name)
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args, path])
  return path
}
let browser, server
try {
  const video = make('offset.webm', [
    '-f',
    'lavfi',
    '-i',
    'color=red:size=192x108:rate=12:duration=1',
    '-itsoffset',
    '0.25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=2400:sample_rate=48000:duration=0.65',
    '-vf',
    "drawbox=c=blue:t=fill:enable='gte(t,0.5)',select='eq(n,0)+eq(n,1)+eq(n,6)+eq(n,11)'",
    '-fps_mode',
    'vfr',
    '-c:v',
    'libvpx-vp9',
    '-c:a',
    'libopus',
  ])
  const long = process.argv.includes('--long')
    ? make('long.wav', [
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=600:sample_rate=24000:duration=1799',
        '-c:a',
        'pcm_s16le',
      ])
    : null
  const tooLong = make('limit.flac', [
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=8000:cl=mono',
    '-t',
    '1801',
    '-c:a',
    'flac',
  ])
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage()
  const url = server.resolvedUrls.local[0]
  await page.route('**/check-media.html', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<input type=file>' }),
  )
  await page.goto(new URL('check-media.html', url).href)
  await page.locator('input').setInputFiles(video)
  const result = await page.evaluate(async () => {
    const { openMedia } = await import('/src/media.ts')
    const file = document.querySelector('input').files[0]
    const data = await openMedia(file)
    try {
      const pixel = async (t) => {
        const cv = await data.videoAt(t)
        return Array.from(cv.getContext('2d').getImageData(48, 48, 1, 1).data)
      }
      const late = await pixel(0.78),
        early = await pixel(0.3),
        repeat = await pixel(0.78)
      const sequential = []
      for await (const cv of data.videoFrames([0.1, 0.3, 0.55, 0.78])) {
        sequential.push(Array.from(cv.getContext('2d').getImageData(48, 48, 1, 1).data))
      }
      const controller = new AbortController()
      const before = data.frame(0.5).rms
      const abort = await data
        .reanalyze({ channel: 'side' }, { signal: controller.signal, onProgress: () => controller.abort() })
        .then(
          () => '',
          (e) => e.name,
        )
      const after = data.frame(0.5).rms
      await data.reanalyze({ channel: 'side' })
      return {
        late,
        early,
        repeat,
        sequential,
        abort,
        before,
        after,
        side: data.frame(0.5).rms,
        first: data.frame(0.1).rms,
        duration: data.duration,
        start: data.startTimestamp,
        width: data.width,
        height: data.height,
      }
    } finally {
      data.dispose()
    }
  })
  assert.equal(result.abort, 'AbortError')
  assert.deepEqual([result.width, result.height], [192, 108])
  assert.ok(Math.abs(result.duration - 1) < 0.09)
  assert.ok(result.early[0] > 200 && result.early[2] < 40)
  assert.ok(result.late[2] > 200 && result.late[0] < 40)
  assert.deepEqual(result.repeat, result.late)
  assert.deepEqual(result.sequential, [result.early, result.early, result.late, result.late])
  assert.equal(result.first, 0)
  assert.equal(result.side, 0)
  assert.ok(result.before > 0.05)
  assert.equal(result.after, result.before)
  await page.locator('input').setInputFiles(tooLong)
  const rejection = await page.evaluate(async () => {
    const { openMedia } = await import('/src/media.ts')
    return openMedia(document.querySelector('input').files[0]).then(
      (d) => {
        d.dispose()
        return ''
      },
      (e) => e.message,
    )
  })
  assert.match(rejection, /30 minutes/)
  console.log(
    'VFR frames, delayed audio, random seek, cancellation, reanalysis and input limit passed',
    result,
  )
  const samples = [
    ['s16.wav', 'pcm_s16le'],
    ['layer3.mp3', 'libmp3lame'],
    ['lossless.flac', 'flac'],
    ['adts.aac', 'aac'],
    ['audio.m4a', 'aac'],
    ['opus.ogg', 'libopus'],
    ['vorbis.ogg', 'libvorbis'],
  ]
  const observations = []
  for (const [name, codec] of samples) {
    const path = make(name, [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:sample_rate=48000:duration=0.3',
      '-c:a',
      codec,
    ])
    await page.locator('input').setInputFiles(path)
    observations.push(
      await page.evaluate(async () => {
        const { openMedia } = await import('/src/media.ts')
        const file = document.querySelector('input').files[0]
        try {
          const data = await openMedia(file)
          try {
            const player = document.createElement('audio')
            player.preload = 'auto'
            player.src = data.url
            const playable = await new Promise((resolve) => {
              const done = (result) => {
                clearTimeout(timer)
                resolve(result)
              }
              const timer = setTimeout(() => done(false), 5000)
              player.oncanplay = () => done(true)
              player.onerror = () => done(false)
              player.load()
            })
            player.removeAttribute('src')
            player.load()
            return { name: file.name, rms: data.frame(0.15).rms, playable }
          } finally {
            data.dispose()
          }
        } catch (e) {
          return { name: file.name, error: e.message }
        }
      }),
    )
  }
  for (const row of observations) if (!row.error) assert.ok(row.rms > 0.045, row.name + ' missing audio')
  console.table(observations)
  for (const name of ['avc.mp4', 'silent.mov']) {
    const audio = name.endsWith('.mp4')
    const args = ['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12:duration=0.5']
    if (audio)
      args.push('-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=48000:duration=0.5', '-c:a', 'aac')
    const path = make(name, [...args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
    await page.locator('input').setInputFiles(path)
    const result = await page.evaluate(async () => {
      const { openMedia } = await import('/src/media.ts')
      try {
        const file = document.querySelector('input').files[0]
        const media = await openMedia(file)
        try {
          const cv = await media.videoAt(0.25)
          return { video: [cv.width, cv.height], hasAudio: media.hasAudio, rms: media.frame(0.25).rms }
        } finally {
          media.dispose()
        }
      } catch (e) {
        return { error: e.message }
      }
    })
    if (!result.error) {
      assert.deepEqual(result.video, [160, 90])
      assert.equal(result.hasAudio, audio)
      assert.equal(result.rms > 0, audio)
    }
    console.log(name, result)
  }
  if (long) {
    await page.locator('input').setInputFiles(long)
    const simulated = await page.evaluate(async () => {
      const { openMedia } = await import('/src/media.ts')
      Object.defineProperty(navigator, 'deviceMemory', { value: 0.25, configurable: true })
      try {
        return await openMedia(document.querySelector('input').files[0]).then(
          (d) => {
            d.dispose()
            return ''
          },
          (e) => e.message,
        )
      } finally {
        delete navigator.deviceMemory
      }
    })
    assert.match(simulated, /Insufficient memory/)
    const measured = await page.evaluate(async () => {
      const { openMedia } = await import('/src/media.ts')
      const start = performance.now()
      const media = await openMedia(document.querySelector('input').files[0])
      try {
        return {
          duration: media.duration,
          seconds: (performance.now() - start) / 1000,
          endRMS: media.frame(1798).rms,
          buckets: media.waveform.length,
        }
      } finally {
        media.dispose()
      }
    })
    assert.equal(measured.duration, 1799)
    assert.ok(measured.endRMS > 0.07)
    assert.equal(measured.buckets, 1280)
    console.log('Long-input analysis passed', measured, await browser.version())
  }
} finally {
  await browser?.close()
  await server?.close()
  await rm(work, { recursive: true, force: true })
}
