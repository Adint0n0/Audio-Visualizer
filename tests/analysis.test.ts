import { describe, expect, it } from 'vitest'
import {
  BAND_COUNT,
  bandEdges,
  defaultAnalysis,
  FEATURE_HZ,
  FeatureBuilder,
  MAX_MEDIA_SECONDS,
  readFrame,
  validateAnalysis,
  type AnalysisSettings,
} from '../src/analysis'

const rate = 48000
const seconds = 0.5
const size = rate * seconds
const tone = (hz: number, gain = 1) =>
  Float32Array.from({ length: size }, (_, i) => Math.sin((i * 2 * Math.PI * hz) / rate) * gain)
const pure: AnalysisSettings = {
  ...defaultAnalysis,
  fftSize: 1024,
  minHz: 0,
  maxHz: rate / 2,
  distribution: 'linear',
  amplitude: 'linear',
  attackMs: 0,
  releaseMs: 0,
  window: 'rectangular',
}
const baseMod = {
  channel: 'left' as const,
  source: 'rms' as const,
  lowHz: 2000,
  highHz: 4000,
  attack: 0,
  release: 0,
}
function analyze(
  left: Float32Array,
  right: Float32Array,
  overrides: Partial<AnalysisSettings> = {},
  chunks = 511,
) {
  const builder = new FeatureBuilder(rate, seconds, { ...pure, ...overrides })
  for (let i = 0; i < size; i += chunks)
    builder.push(i, left.subarray(i, i + chunks), right.subarray(i, i + chunks))
  return builder.finish()
}
describe('compressed, timestamped audio features', () => {
  it('resolves integer-bin FFT peak, RMS and peak at original sample rate', () => {
    const signal = tone(3000, 0.8)
    const f = readFrame(analyze(signal, signal), 0.25)
    const max = Math.max(...f.bands),
      i = f.bands.indexOf(max),
      edges = bandEdges(pure, rate)
    expect(3000).toBeGreaterThanOrEqual(edges[i])
    expect(3000).toBeLessThan(edges[i + 1])
    expect(max).toBeCloseTo(0.8, 2)
    expect(f.rms).toBeCloseTo(0.8 / Math.SQRT2, 4)
    expect(f.peak).toBeCloseTo(0.8, 5)
  })
  it('keeps L/R spectra, Mid/Side and band-limited modulation distinct', () => {
    const l = tone(3000),
      r = tone(750, 0.4)
    const f = readFrame(analyze(l, r), 0.25)
    expect(f.resolveMod!(baseMod)).toBeCloseTo(1 / Math.SQRT2, 4)
    expect(f.resolveMod!({ ...baseMod, channel: 'right' })).toBeCloseTo(0.4 / Math.SQRT2, 4)
    expect(f.resolveMod!({ ...baseMod, source: 'band' })).toBeCloseTo(1 / Math.SQRT2, 2)
    expect(f.resolveMod!({ ...baseMod, source: 'band', channel: 'right' })).toBeLessThan(0.001)
    const opposite = Float32Array.from(l, (v) => -v)
    const phase = readFrame(analyze(l, opposite, { channel: 'side' }), 0.25)
    expect(phase.rms).toBeCloseTo(1 / Math.SQRT2, 4)
    expect(phase.resolveMod!({ ...baseMod, channel: 'mid' })).toBe(0)
    expect(phase.resolveMod!({ ...baseMod, channel: 'side', source: 'band' })).toBeCloseTo(1 / Math.SQRT2, 2)
  })
  it('fills packet gaps with silence and records the nearest impulse without changing its timestamp', () => {
    const builder = new FeatureBuilder(rate, seconds, pure),
      pulse = new Float32Array(768)
    pulse[12] = 1
    builder.push(rate / 4 - 12, pulse)
    const data = builder.finish()
    expect(readFrame(data, 0.1).peak).toBe(0)
    expect(readFrame(data, 0.25).peak).toBe(1)
    expect(readFrame(data, 0.25).onset).toBeGreaterThan(0)
    expect(readFrame(data, 0.25 + 1 / FEATURE_HZ).peak).toBe(0)
    expect(data.waveform.includes(1)).toBe(true)
  })
  it('is independent of block sizes, overlapping packet starts and random seek order', () => {
    const left = tone(440),
      right = tone(731)
    const data = analyze(left, right, { attackMs: 90, releaseMs: 210 }, 811)
    const other = analyze(left, right, { attackMs: 90, releaseMs: 210 }, 16384)
    expect(data.bands).toEqual(other.bands)
    const a = readFrame(data, 0.4),
      b = readFrame(data, 0.25)
    expect(a.history(0.15)).toEqual(b.bands)
    expect(Math.max(...b.history(1))).toBe(0)
    const mod = { ...baseMod, attack: 120, release: 240 }
    const late = a.resolveMod!(mod)
    const early = b.resolveMod!(mod)
    expect(early).toBeLessThan(late)
    expect(late).toEqual(readFrame(other, 0.4).resolveMod!(mod))
    expect(early).toEqual(readFrame(other, 0.25).resolveMod!(mod))
    const sequential = analyze(left, right)
    for (let i = 0; i <= 0.4 * FEATURE_HZ; i++) readFrame(sequential, i / FEATURE_HZ).resolveMod!(mod)
    expect(readFrame(sequential, 0.4).resolveMod!(mod)).toBe(late)
    const repeated = new FeatureBuilder(rate, seconds, pure)
    repeated.push(0, left, right)
    repeated.push(500, left.subarray(500), right.subarray(500))
    expect(repeated.finish().metrics).toEqual(analyze(left, right).metrics)
  })
  it('follows Attack and Release in milliseconds on a fixed-time lattice', () => {
    const signal = tone(3000)
    signal.fill(0, rate / 4)
    const data = analyze(signal, signal, { attackMs: 100, releaseMs: 100 })
    const a = Math.max(...readFrame(data, 0.1).bands),
      b = Math.max(...readFrame(data, 0.35).bands)
    expect(a).toBeGreaterThan(0.6)
    expect(a).toBeLessThan(0.72)
    expect(b).toBeGreaterThan(0.25)
    expect(b).toBeLessThan(0.4)
  })
  it('preserves very low-level material until whole-song normalization', () => {
    const signal = tone(3000, 0.00002)
    const data = analyze(signal, signal, { floorDb: -145, normalization: 'song' })
    expect(Math.max(...readFrame(data, 0.2).bands)).toBe(1)
  })
  it('keeps silence finite and clamps the requested spectrum to Nyquist', () => {
    const zero = new Float32Array(7),
      b = new FeatureBuilder(rate, 7 / rate, defaultAnalysis)
    b.push(0, zero)
    const f = readFrame(b.finish(), 0)
    expect([...f.bands]).toEqual(Array(BAND_COUNT).fill(0))
    expect(f.rms).toBe(0)
    for (const distribution of ['linear', 'log', 'mel', 'bark', 'octave'] as const) {
      const edges = bandEdges({ ...defaultAnalysis, distribution, maxHz: 96000 }, 8000)
      expect(edges.at(-1)).toBeCloseTo(4000)
      expect([...edges].every((v, i) => !i || v >= edges[i - 1])).toBe(true)
    }
    expect(() => new FeatureBuilder(rate, MAX_MEDIA_SECONDS + 0.01, pure)).toThrow()
    expect(() => validateAnalysis({ fftSize: 255 })).toThrow()
    expect(() => validateAnalysis({ minHz: 1000, maxHz: 900 })).toThrow()
  })
})
