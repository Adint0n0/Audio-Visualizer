import { describe, it, expect } from 'vitest'
import { frameCount, validateExport, type ExportOptions } from '../src/output/timing'

const options: ExportOptions = {
  container: 'mp4',
  videoCodec: 'avc',
  width: 3840,
  height: 2160,
  fps: 60000 / 1001,
  start: 0,
  end: 1800,
  videoBitrate: 48000000,
  audioBitrate: 320000,
}
describe('export timeline', () => {
  it('computes exact NTSC frame count at 30 minutes without accumulating rounded durations', () => {
    expect(frameCount(options)).toBe(107893)
    const last = (frameCount(options) - 1) / options.fps
    expect(last).toBeLessThan(1800)
    expect(last + 1 / options.fps).toBeGreaterThan(1800)
  })
  it('includes a partial final frame and no phantom frame on an exact boundary', () => {
    expect(frameCount({ ...options, start: 0.1, end: 0.4, fps: 30 })).toBe(9)
    expect(frameCount({ ...options, start: 0.1, end: 0.401, fps: 30 })).toBe(10)
  })
  it('rejects invalid dimensions, FPS, numbers, times and codec/container combinations', () => {
    validateExport(options)
    for (const change of [
      { width: 4097 },
      { height: 4096 },
      { width: 1919 },
      { fps: 61 },
      { fps: NaN },
      { start: -1 },
      { end: 1801 },
      { start: 5, end: 5 },
      { videoBitrate: Infinity },
      { container: 'webm' },
    ]) {
      expect(() => validateExport({ ...options, ...change } as ExportOptions)).toThrow()
    }
  })
})
