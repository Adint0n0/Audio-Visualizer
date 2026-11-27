import { describe, expect, it } from 'vitest'
import {
  FeatureBuilder,
  defaultAnalysis,
  readFrame,
  FEATURE_HZ,
  silentFrame,
  demoFrame,
} from '../src/analysis'
import { makeMusicFixture, type GenreFixture } from './fixtures/rhythm'

function analyze(left: Float32Array, right: Float32Array, rate: number, blockSize = 4039) {
  const builder = new FeatureBuilder(rate, left.length / rate, { ...defaultAnalysis, fftSize: 1024 })
  for (let i = 0; i < left.length; i += blockSize)
    builder.push(i, left.subarray(i, i + blockSize), right.subarray(i, i + blockSize))
  return builder.finish()
}
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
describe('music features for the 3D stage', () => {
  it('measures calibrated band RMS and spectral centroid before visual gain and smoothing', () => {
    const rate = 16384
    for (const [freq, band] of [
      [80, 'bass'],
      [512, 'mid'],
      [6144, 'treble'],
    ] as const) {
      const signal = Float32Array.from(
        { length: rate },
        (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / rate),
      )
      const m = readFrame(analyze(signal, signal, rate), 0.5).music!
      expect(m[band]).toBeCloseTo(0.5 / Math.SQRT2, 4)
      expect(m.centroidHz).toBeCloseTo(freq, 1)
      for (const other of ['bass', 'mid', 'treble'] as const)
        if (other !== band) expect(m[other]).toBeLessThan(0.0001)
      expect(m.beat).toBe(0)
      expect(m.tempo).toBe(0)
    }
    expect(silentFrame.music?.centroidHz).toBe(0)
    expect(demoFrame(0.75).music).toEqual(demoFrame(0.75).music)
  })
  it.each([
    ['dance', 120],
    ['acoustic', 86],
    ['breakbeat', 150],
  ] as [GenreFixture, number][])('recovers rhythmic evidence on %s fixtures', (genre, bpm) => {
    const { left, right, rate, beats } = makeMusicFixture(genre)
    const data = analyze(left, right, rate),
      tempos: number[] = [],
      confidence: number[] = []
    for (let n = 2 * FEATURE_HZ; n < 10 * FEATURE_HZ; n++) {
      const m = readFrame(data, n / FEATURE_HZ).music!
      tempos.push(m.tempo)
      confidence.push(m.confidence)
    }
    // A pulse should coincide with each annotated beat independently of repeated visual frame lookup.
    const steady = beats.filter((t) => t > 2 && t < 10)
    const pulseHits = steady.filter((t) =>
      [-2, -1, 0, 1, 2].some((i) => readFrame(data, t + i / FEATURE_HZ).music!.beat > 0.52),
    ).length
    const transientHits = steady.filter((t) =>
      [-2, -1, 0, 1, 2].some((i) => readFrame(data, t + i / FEATURE_HZ).music!.transient > 0.3),
    ).length
    console.log(genre, {
      tempo: median(tempos),
      confidence: median(confidence),
      pulseHits,
      transientHits,
      total: steady.length,
    })
    expect(Math.abs(median(tempos) - bpm)).toBeLessThan(2)
    expect(median(confidence)).toBeGreaterThan(0.58)
    expect(pulseHits / steady.length).toBeGreaterThan(0.84)
    expect(transientHits / steady.length).toBeGreaterThan(0.84)
  })
  it('withholds the beat grid on sustained ambient material and digital silence', () => {
    const { left, right, rate } = makeMusicFixture('ambient')
    for (const [l, r] of [
      [left, right],
      [new Float32Array(left.length), new Float32Array(right.length)],
    ]) {
      const data = analyze(l, r, rate)
      for (let f = 0; f < data.count; f++) {
        const m = readFrame(data, f / FEATURE_HZ).music!
        expect(m.tempo).toBe(0)
        expect(m.beat).toBe(0)
      }
    }
  })
  it('rejects sustained periodicity on scattered, aperiodic percussion', () => {
    const rate = 16000,
      duration = 28,
      samples = new Float32Array(rate * duration)
    let seed = 1745,
      t = 0.21
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    while (t < duration - 0.1) {
      const hz = 100 + rnd() * 1500,
        amp = 0.12 + rnd() * 0.36
      const start = Math.round(t * rate)
      for (let i = 0; i < rate * 0.09; i++)
        samples[start + i] += amp * Math.exp((-i / rate) * 46) * Math.sin((2 * Math.PI * hz * i) / rate)
      t += 0.14 + rnd() * 0.78
    }
    const data = analyze(samples, samples, rate)
    let periodic = 0,
      transients = 0
    for (let f = FEATURE_HZ * 3; f < (duration - 3) * FEATURE_HZ; f++) {
      const m = readFrame(data, f / FEATURE_HZ).music!
      if (m.tempo > 0) periodic++
      if (m.transient > 0.5) transients++
    }
    console.log('aperiodic percussion', {
      gridFraction: periodic / ((duration - 6) * FEATURE_HZ),
      transients,
    })
    expect(transients).toBeGreaterThan(60)
    expect(periodic / ((duration - 6) * FEATURE_HZ)).toBeLessThan(0.15)
  })
  it('uses the selected actual audio channel for stereo energies', () => {
    const rate = 16384
    const left = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 80 * i) / rate))
    const right = Float32Array.from(
      { length: rate },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 5408 * i) / rate),
    )
    for (const channel of ['left', 'right'] as const) {
      const b = new FeatureBuilder(rate, 1, { ...defaultAnalysis, channel, fftSize: 1024 })
      b.push(0, left, right)
      const m = readFrame(b.finish(), 0.5).music!
      expect(m[channel === 'left' ? 'bass' : 'treble']).toBeCloseTo(0.5 / Math.SQRT2, 4)
      expect(m[channel === 'left' ? 'treble' : 'bass']).toBeLessThan(0.0001)
    }
  })
  it('adapts after tempo changes and caches the same features across chunk boundaries and backwards seeks', () => {
    const { left, right, rate } = makeMusicFixture('tempo-change', 18)
    const data = analyze(left, right, rate),
      other = analyze(left, right, rate, 1024)
    expect(readFrame(data, 4).music!.tempo).toBeCloseTo(90, 0)
    expect(Math.abs(readFrame(data, 15).music!.tempo - 132)).toBeLessThan(2)
    for (const t of [15.2, 2.1, 8.12, 5, 15.2])
      expect(readFrame(data, t).music).toEqual(readFrame(other, t).music)
  })
  it('places offset audio on the project clock and reproduces music features at fractional range starts', () => {
    const { left, right, rate } = makeMusicFixture('dance', 10)
    const normal = analyze(left, right, rate)
    const delay = 1,
      delayed = new FeatureBuilder(rate, 11, { ...defaultAnalysis, fftSize: 1024 })
    // Simulate the source with video starting one second before the first audio PTS.
    delayed.push(rate * delay, left, right)
    const offset = delayed.finish()
    expect(readFrame(offset, 0.5).music).toEqual(silentFrame.music)
    const start = 4.123,
      fps = 30000 / 1001
    for (let i = 0; i < 75; i++) {
      const t = start + i / fps,
        original = readFrame(normal, t).music!,
        shifted = readFrame(offset, t + delay).music!
      expect(shifted.bass).toBe(original.bass)
      expect(shifted.transient).toBe(original.transient)
      expect(shifted.tempo).toBeCloseTo(original.tempo, 4)
      expect(shifted.beat).toBeCloseTo(original.beat, 5)
    }
  })
  it('responds to a large timbre change of nearly constant RMS', () => {
    const rate = 16000
    const s = Float32Array.from(
      { length: rate * 2 },
      (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < rate ? 250 : 4000) * i) / rate),
    )
    const data = analyze(s, s, rate)
    const pre = readFrame(data, 0.75),
      post = readFrame(data, 1.25)
    expect(post.rms).toBeCloseTo(pre.rms, 2)
    expect(post.music!.brightness).toBeGreaterThan(pre.music!.brightness + 0.4)
    expect(
      Math.max(...[-2, -1, 0, 1, 2].map((i) => readFrame(data, 1 + i / FEATURE_HZ).music!.transient)),
    ).toBeGreaterThan(0.5)
  })
})
