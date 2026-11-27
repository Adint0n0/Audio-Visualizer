import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { exportMovie, probeExport, type ExportOptions } from '../src/export'

// Offsets deliberately cross PCM-block boundaries. A click and a single white frame
// share each absolute source time so an independent decoder can measure sync.
const clicks = [0.275, 0.775, 1.275]
const rate = 48000
function clickTrack(duration: number) {
  const frames = Math.round(duration * rate)
  const bytes = new ArrayBuffer(44 + frames * 4),
    v = new DataView(bytes)
  const four = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }
  four(0, 'RIFF')
  v.setUint32(4, 36 + frames * 4, true)
  four(8, 'WAVE')
  four(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, 4 * rate, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 16, true)
  four(36, 'data')
  v.setUint32(40, frames * 4, true)
  for (const t of clicks)
    for (let i = 0; i < 480; i++) {
      const frame = Math.round(t * rate) + i
      if (frame >= frames) continue
      const s = Math.round(24000 * Math.sin((i * Math.PI) / 12))
      v.setInt16(44 + 4 * frame, s, true)
      v.setInt16(46 + 4 * frame, -s, true)
    }
  return new Blob([bytes], { type: 'audio/wav' })
}

async function run(o: ExportOptions, mode: 'normal' | 'cancel' | 'copy', url?: string) {
  const input = new Input({
    source: new BlobSource(url ? await (await fetch(url)).blob() : clickTrack(Math.max(1.5, o.end))),
    formats: ALL_FORMATS,
  })
  const canvas = document.createElement('canvas')
  canvas.width = o.width
  canvas.height = o.height
  const ctx = canvas.getContext('2d')!
  const abort = new AbortController()
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error('Missing fixture audio')
    if (mode === 'copy') o.end = await input.computeDuration()
    const check = await probeExport(o, track)
    if (!check.supported) return { supported: false, reason: check.reason }
    const file = await exportMovie({
      options: o,
      audioTrack: track,
      canvas,
      signal: abort.signal,
      renderFrame(t) {
        ctx.fillStyle = (o.end > 1700 ? [1, 900, 1798] : clicks).some((c) => Math.abs(t - c) < 0.5 / o.fps)
          ? '#fff'
          : '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      },
      onProgress(f) {
        if (mode === 'cancel' && f > 0.15) abort.abort()
      },
    })
    try {
      // Test files are tiny and travel only between the test runner and local browser.
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file.blob)
      })
      return { supported: true, audioMode: file.audioMode, data }
    } finally {
      await file.dispose()
    }
  } catch (e) {
    if (mode === 'cancel' && abort.signal.aborted && e instanceof DOMException && e.name === 'AbortError')
      return { supported: true, canceled: true }
    throw e
  } finally {
    input.dispose()
    canvas.width = 1
    canvas.height = 1
  }
}
Object.assign(window, { runExportTest: run })
