import { describe, it, expect } from 'vitest'
import { frameCount, validateExport, type ExportOptions } from '../src/output/timing'
import {
  aspectOf,
  hasAspect,
  lockedResolution,
  resolutionPresets,
  sizeForAspect,
  validPixelSize,
} from '../src/output/resolution'

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

describe('editor aspect presets', () => {
  it('keeps the short edge when switching between common ratios', () => {
    expect(sizeForAspect(1080, 1, 1)).toEqual({ width: 1080, height: 1080 })
    expect(sizeForAspect(1080, 9, 16)).toEqual({ width: 1080, height: 1920 })
    expect(sizeForAspect(1080, 16, 9)).toEqual({ width: 1920, height: 1080 })
    expect(sizeForAspect(1080, 4, 3)).toEqual({ width: 1440, height: 1080 })
  })

  it('keeps the exact ratio and valid H.264 dimensions near the output limits', () => {
    for (const shortEdge of [2, 311, 2160, 2900]) {
      const size = sizeForAspect(shortEdge, 16, 9)
      expect(size!.width * 9).toBe(size!.height * 16)
      expect(() => validateExport({ ...options, ...size! })).not.toThrow()
    }
  })
  it('generates all four short-edge tiers for common frames', () => {
    const sizes = (w: number, h: number) =>
      resolutionPresets(aspectOf(w, h)).map(({ width, height }) => [width, height])
    expect(sizes(16, 9)).toEqual([
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ])
    expect(sizes(1, 1)).toEqual([
      [720, 720],
      [1080, 1080],
      [1440, 1440],
      [2160, 2160],
    ])
    expect(sizes(9, 16)).toEqual([
      [720, 1280],
      [1080, 1920],
      [1440, 2560],
      [2160, 3840],
    ])
    expect(sizes(3, 2)).toEqual([
      [1080, 720],
      [1620, 1080],
      [2160, 1440],
      [3240, 2160],
    ])
  })
  it('preserves exact proportions, removes duplicate sizes at the limit and supports legacy odd dimensions', () => {
    for (const ratio of [aspectOf(21, 9), aspectOf(9, 21), aspectOf(500, 310), aspectOf(4095, 2159)]) {
      const sizes = resolutionPresets(ratio)
      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes.every((size) => validPixelSize(size) && hasAspect(size, ratio))).toBe(true)
      expect(new Set(sizes.map((size) => size.width)).size).toBe(sizes.length)
    }
    expect(lockedResolution(720, 'width', [9, 16])).toEqual({ width: 720, height: 1280 })
    expect(lockedResolution(311, 'height', [50, 31])).toEqual({ width: 500, height: 310 })
  })
})
