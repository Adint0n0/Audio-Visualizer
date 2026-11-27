// Values in the feature cache are sampled on the source timeline, independently of playback and output FPS.
export const MAX_MEDIA_SECONDS = 30 * 60
export const FEATURE_HZ = 60
export const BAND_COUNT = 96
export const WAVE_POINTS = 128
const MOD_BANDS = 48
const channels = { left: 0, right: 1, mid: 2, mono: 2, side: 3 } as const
type ModInput = {
  channel: keyof typeof channels
  source: 'rms' | 'peak' | 'onset' | 'band'
  lowHz: number
  highHz: number
  attack: number
  release: number
}

export const analysisChoices = {
  channel: ['mono', 'left', 'right', 'mid', 'side'],
  window: ['hann', 'hamming', 'blackman', 'rectangular'],
  distribution: ['linear', 'log', 'mel', 'bark', 'octave'],
  aggregation: ['peak', 'mean', 'rms'],
  amplitude: ['linear', 'db', 'power'],
  normalization: ['fixed', 'adaptive', 'song'],
} as const
type Choice = { [K in keyof typeof analysisChoices]: (typeof analysisChoices)[K][number] }
export interface AnalysisSettings extends Choice {
  fftSize: number
  minHz: number
  maxHz: number
  gain: number
  exponent: number
  floorDb: number
  threshold: number
  dynamicRangeDb: number
  attackMs: number
  releaseMs: number
  timeSmoothMs: number
  frequencySmooth: number
  holdMs: number
  decayMs: number
  outMin: number
  outMax: number
}
export const defaultAnalysis: AnalysisSettings = {
  channel: 'mono',
  window: 'hann',
  distribution: 'log',
  aggregation: 'peak',
  amplitude: 'db',
  normalization: 'fixed',
  fftSize: 2048,
  minHz: 35,
  maxHz: 18000,
  gain: 1,
  exponent: 1.5,
  floorDb: -80,
  threshold: 0,
  dynamicRangeDb: 64,
  attackMs: 8,
  releaseMs: 110,
  timeSmoothMs: 0,
  frequencySmooth: 0,
  holdMs: 0,
  decayMs: 80,
  outMin: 0,
  outMax: 1,
}
export const analysisRanges = {
  minHz: [0, 192000, 1],
  maxHz: [1, 192000, 1],
  gain: [0, 32, 0.05],
  exponent: [0.1, 8, 0.1],
  floorDb: [-160, 0, 1],
  threshold: [0, 1, 0.001],
  dynamicRangeDb: [1, 160, 1],
  attackMs: [0, 5000, 1],
  releaseMs: [0, 10000, 1],
  timeSmoothMs: [0, 5000, 1],
  frequencySmooth: [0, 16, 1],
  holdMs: [0, 10000, 1],
  decayMs: [0, 10000, 1],
  outMin: [0, 1, 0.01],
  outMax: [0, 1, 0.01],
} as const
export const fftSizes = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768]
export function validateAnalysis(s: Partial<AnalysisSettings> = {}): AnalysisSettings {
  const result = { ...defaultAnalysis }
  const input = { ...defaultAnalysis, ...s }
  for (const key of Object.keys(analysisChoices) as (keyof Choice)[]) {
    if (!(analysisChoices[key] as readonly string[]).includes(input[key]))
      throw Error('Invalid analysis option: ' + key)
    Object.assign(result, { [key]: input[key] })
  }
  for (const key of Object.keys(analysisRanges) as (keyof typeof analysisRanges)[]) {
    const n = input[key],
      [low, high] = analysisRanges[key]
    if (!Number.isFinite(n) || n < low || n > high) throw Error('Invalid analysis value: ' + key)
    result[key] = n
  }
  if (!fftSizes.includes(input.fftSize) || result.minHz >= result.maxHz || result.outMin > result.outMax) {
    throw Error('FFT size, frequency range or output range is invalid.')
  }
  result.fftSize = input.fftSize
  result.frequencySmooth = Math.round(result.frequencySmooth)
  return result
}
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
export interface AudioFrame {
  bands: Float32Array
  wave: Float32Array
  left: Float32Array
  right: Float32Array
  rms: number
  peak: number
  onset: number
  resolveMod?: (input: ModInput) => number
  history: (secondsAgo: number) => Float32Array
}
const zeroBands = new Float32Array(BAND_COUNT),
  zeroWave = new Float32Array(WAVE_POINTS)
export const silentFrame: AudioFrame = {
  bands: zeroBands,
  wave: zeroWave,
  left: zeroWave,
  right: zeroWave,
  rms: 0,
  peak: 0,
  onset: 0,
  history: () => zeroBands,
  resolveMod: () => 0,
}
function sampleChannel(s: Choice['channel'], l: number, r: number) {
  if (s === 'left') return l
  if (s === 'right') return r
  return s === 'side' ? (l - r) / 2 : (l + r) / 2
}
export function bandEdges(settings: AnalysisSettings, rate: number) {
  const hi = Math.min(settings.maxHz, rate / 2),
    lo = Math.min(settings.minHz, hi)
  const edge = (k: number) => {
    const t = k / BAND_COUNT
    switch (settings.distribution) {
      case 'linear':
        return lo + (hi - lo) * t
      case 'log':
        return Math.exp(Math.log(1 + lo) * (1 - t) + Math.log(1 + hi) * t) - 1
      case 'octave': {
        const base = Math.max(1, lo)
        return k === 0 ? lo : base * 2 ** (Math.log2(hi / base) * t)
      }
      case 'mel':
        return 700 * Math.expm1(Math.log1p(lo / 700) * (1 - t) + Math.log1p(hi / 700) * t)
      case 'bark':
        return 600 * Math.sinh(Math.asinh(lo / 600) * (1 - t) + Math.asinh(hi / 600) * t)
    }
  }
  return Float64Array.from({ length: BAND_COUNT + 1 }, (_, i) => edge(i))
}
export interface FeatureData {
  count: number
  duration: number
  sampleRate: number
  settings: AnalysisSettings
  channelBands: Uint8Array
  channelMetrics: Float32Array
  bands: Uint8Array
  waves: Int8Array
  metrics: Float32Array
  waveform: Float32Array
}
// Channel-specific energy occupies 48 log-frequency buckets; boundary buckets are weighted by overlap.
function modEdge(index: number, rate: number) {
  return 32 * Math.expm1((index / MOD_BANDS) * Math.log1p(rate / 64))
}
type ModCurve = { values: Float32Array; filled: number; measure: (frame: number) => number }
const curves = new WeakMap<FeatureData, Map<string, ModCurve>>()
function resolveMod(data: FeatureData, index: number, input: ModInput) {
  let cache = curves.get(data)
  if (!cache) {
    cache = new Map()
    curves.set(data, cache)
  }
  const ch = channels[input.channel],
    band = input.source === 'band'
  const key = [
    ch,
    input.source,
    band ? input.lowHz : 0,
    band ? input.highHz : 0,
    input.attack,
    input.release,
  ].join('/')
  let curve = cache.get(key)
  if (!curve) {
    let measure: (frame: number) => number
    if (band) {
      const weights: { bin: number; weight: number }[] = []
      for (let i = 0; i < MOD_BANDS; i++) {
        const lo = modEdge(i, data.sampleRate),
          hi = modEdge(i + 1, data.sampleRate)
        const overlap = Math.min(input.highHz, hi) - Math.max(input.lowHz, lo)
        if (overlap > 0) weights.push({ bin: i, weight: overlap / (hi - lo) })
      }
      measure = (frame) => {
        let sum = 0
        const offset = (frame * 4 + ch) * MOD_BANDS
        for (const { bin, weight } of weights) {
          const amplitude = (data.channelBands[offset + bin] / 255) ** 2
          sum += weight * amplitude * amplitude
        }
        return Math.sqrt(sum)
      }
    } else {
      const metric = input.source === 'peak' ? 1 : input.source === 'onset' ? 2 : 0
      measure = (frame) => data.channelMetrics[(frame * 4 + ch) * 3 + metric]
    }
    // Keep seekable envelope checkpoints and compute only the requested prefix. Evict old editor configurations.
    curve = {
      values: input.attack || input.release ? new Float32Array(data.count) : new Float32Array(0),
      filled: 0,
      measure,
    }
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(key, curve)
  }
  if (!curve.values.length) return curve.measure(index)
  const a = envelopeCoefficient(input.attack),
    r = envelopeCoefficient(input.release)
  let last = curve.filled ? curve.values[curve.filled - 1] : 0
  while (curve.filled <= index) {
    const delta = curve.measure(curve.filled) - last
    // Quantize every recurrence step so a seek and sequential playback resume from identical state.
    last = Math.fround(last + (delta >= 0 ? a : r) * delta)
    curve.values[curve.filled++] = last
  }
  return curve.values[index]
}

// Use available browser hints before allocating a worker cache; actual allocation failures still propagate.
export function analysisBytes(duration: number, normalization: AnalysisSettings['normalization']) {
  const rows = 1 + Math.ceil(duration * FEATURE_HZ)
  return (
    rows *
    (BAND_COUNT +
      2 * WAVE_POINTS +
      3 * 4 +
      4 * MOD_BANDS +
      4 * 3 * 4 +
      (normalization === 'song' ? 2 * BAND_COUNT : 0))
  )
}
export function readFrame(data: FeatureData, time: number): AudioFrame {
  if (!Number.isFinite(time) || time < 0 || time > data.duration) return silentFrame
  const index = Math.min(data.count - 1, Math.round(time * FEATURE_HZ)),
    offset = index * WAVE_POINTS * 2
  const left = new Float32Array(WAVE_POINTS),
    right = new Float32Array(WAVE_POINTS),
    wave = new Float32Array(WAVE_POINTS)
  for (let i = 0; i < WAVE_POINTS; i++) {
    left[i] = data.waves[offset + i] / 127
    right[i] = data.waves[offset + WAVE_POINTS + i] / 127
    wave[i] = sampleChannel(data.settings.channel, left[i], right[i])
  }
  const bandsAt = (n: number) => {
    if (n < 0) return zeroBands
    const start = n * BAND_COUNT
    return Float32Array.from(data.bands.subarray(start, start + BAND_COUNT), (v) => v / 255)
  }
  return {
    resolveMod: (mod) => resolveMod(data, index, mod),
    bands: bandsAt(index),
    wave,
    left,
    right,
    rms: data.metrics[index * 3],
    peak: data.metrics[index * 3 + 1],
    onset: data.metrics[index * 3 + 2],
    history: (ago) =>
      ago > time ? zeroBands : bandsAt(Math.min(index, Math.round((time - Math.max(0, ago)) * FEATURE_HZ))),
  }
}

// Analytic, seekable audition signal used exclusively for template thumbnails and empty-editor previews.
export function demoFrame(time: number): AudioFrame {
  const pulse = Math.exp(-4 * ((Math.max(0, time) * 1.8) % 1))
  const bandsAt = (t: number) =>
    Float32Array.from({ length: BAND_COUNT }, (_, i) => {
      const p = i / (BAND_COUNT - 1)
      return (0.2 + 0.65 * Math.abs(Math.sin(8 * p + t * 0.8) * Math.cos(15 * p - t))) * (1 - 0.45 * p)
    })
  const waveAt = (phase: number) =>
    Float32Array.from(
      { length: WAVE_POINTS },
      (_, i) => Math.sin(i * 0.12 + phase + time * 3) * (0.32 + pulse * 0.43),
    )
  const left = waveAt(0),
    right = waveAt(0.7)
  return {
    bands: bandsAt(time),
    wave: left,
    left,
    right,
    peak: 0.4 + pulse * 0.4,
    rms: 0.25 + pulse * 0.25,
    onset: pulse,
    history: (ago) => (time >= ago ? bandsAt(time - ago) : zeroBands),
  }
}

// An iterative radix-2 FFT, with one reusable workspace and precomputed twiddles per analysis job.
class Spectrum {
  readonly weights: Float64Array
  readonly real: Float64Array
  readonly imag: Float64Array
  private order: Uint16Array
  private cos: Float64Array
  private sin: Float64Array
  readonly scale: number
  readonly bandwidth: number
  constructor(
    readonly size: number,
    window: Choice['window'],
  ) {
    this.real = new Float64Array(size)
    this.imag = new Float64Array(size)
    this.order = new Uint16Array(size)
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    this.weights = Float64Array.from({ length: size }, (_, i) => {
      const a = (2 * Math.PI * i) / size
      switch (window) {
        case 'hann':
          return 0.5 - 0.5 * Math.cos(a)
        case 'hamming':
          return 0.54 - 0.46 * Math.cos(a)
        case 'blackman':
          return 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a)
        default:
          return 1
      }
    })
    const sum = this.weights.reduce((a, b) => a + b, 0)
    this.scale = 2 / sum
    this.bandwidth = (size * this.weights.reduce((a, b) => a + b * b, 0)) / (sum * sum)
    for (let i = 1; i < size; i++) this.order[i] = (this.order[i >> 1] >> 1) | (((i & 1) * size) / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size)
    }
  }
  transform() {
    const n = this.size,
      re = this.real,
      im = this.imag
    // Pack L + iR. The two real-channel spectra are recovered from conjugate pairs after the transform.
    for (let i = 0; i < n; i++) {
      const j = this.order[i]
      if (j > i) {
        const temp = re[i]
        re[i] = re[j]
        re[j] = temp
        const tempI = im[i]
        im[i] = im[j]
        im[j] = tempI
      }
    }
    for (let step = 2; step <= n; step *= 2) {
      const half = step / 2,
        stride = n / step
      for (let base = 0; base < n; base += step) {
        for (let j = 0; j < half; j++) {
          const a = base + j,
            b = a + half,
            k = j * stride
          const r = this.cos[k] * re[b] - this.sin[k] * im[b],
            v = this.sin[k] * re[b] + this.cos[k] * im[b]
          re[b] = re[a] - r
          im[b] = im[a] - v
          re[a] += r
          im[a] += v
        }
      }
    }
  }
}
function envelopeCoefficient(ms: number) {
  return ms <= 0 ? 1 : -Math.expm1(-1000 / (FEATURE_HZ * ms))
}

// Analysis owns only the sliding PCM window and a bounded, compressed timeline. Samples arrive in timestamp order.
export class FeatureBuilder {
  readonly data: FeatureData
  private fft: Spectrum
  private left: Float32Array
  private right: Float32Array
  private mask: number
  private ranges: [number, number][]
  private written = 0
  private frameIndex = 0
  private radius: number
  private hopRadius: number
  private raw = new Float32Array(BAND_COUNT)
  private smoothed = new Float32Array(BAND_COUNT)
  private envelope = new Float32Array(BAND_COUNT)
  private holds = new Uint32Array(BAND_COUNT)
  private held = new Float32Array(BAND_COUNT)
  private channelEnergy = new Float64Array(4 * MOD_BANDS)
  private metricSums = new Float64Array(4)
  private metricPeaks = new Float64Array(4)
  private modIndex: Uint8Array
  private magnitude: Float64Array
  private maxBand = 0
  private songLevels?: Uint16Array
  private attack: number
  private release: number
  private smoothing: number
  private decay: number
  constructor(
    private rate: number,
    duration: number,
    private cfg: AnalysisSettings,
  ) {
    if (
      !Number.isFinite(rate) ||
      rate < 1000 ||
      rate > 384000 ||
      !(duration > 0 && duration <= MAX_MEDIA_SECONDS)
    ) {
      throw Error('Audio rate or duration is outside the processing limits.')
    }
    cfg = this.cfg = validateAnalysis(cfg)
    const count = Math.ceil(duration * FEATURE_HZ) + 1
    this.data = {
      count,
      duration,
      sampleRate: rate,
      settings: cfg,
      channelBands: new Uint8Array(count * 4 * MOD_BANDS),
      channelMetrics: new Float32Array(count * 4 * 3),
      bands: new Uint8Array(count * BAND_COUNT),
      waves: new Int8Array(count * WAVE_POINTS * 2),
      metrics: new Float32Array(count * 3),
      waveform: new Float32Array(Math.min(1280, count)),
    }
    if (cfg.normalization === 'song') this.songLevels = new Uint16Array(count * BAND_COUNT)
    this.fft = new Spectrum(cfg.fftSize, cfg.window)
    this.hopRadius = Math.max(1, Math.round(rate / FEATURE_HZ / 2))
    this.radius = Math.max(cfg.fftSize / 2, this.hopRadius)
    const capacity = 2 ** Math.ceil(Math.log2(this.radius * 2 + 16384))
    this.left = new Float32Array(capacity)
    this.right = new Float32Array(capacity)
    this.mask = capacity - 1
    const edges = bandEdges(cfg, rate),
      nyquist = cfg.fftSize / 2
    this.magnitude = new Float64Array(nyquist + 1)
    this.modIndex = Uint8Array.from({ length: nyquist + 1 }, (_, i) =>
      Math.min(
        MOD_BANDS - 1,
        Math.floor((MOD_BANDS * Math.log1p((i * rate) / cfg.fftSize / 32)) / Math.log1p(rate / 64)),
      ),
    )
    this.ranges = Array.from({ length: BAND_COUNT }, (_, i) => {
      if (cfg.minHz >= rate / 2) return [0, 0]
      const lo = Math.min(nyquist, Math.ceil((edges[i] * cfg.fftSize) / rate))
      const hi = Math.min(nyquist + 1, Math.ceil((edges[i + 1] * cfg.fftSize) / rate))
      if (lo < hi) return [lo, hi]
      const nearest = clamp(Math.round(((edges[i] + edges[i + 1]) * 0.5 * cfg.fftSize) / rate), 0, nyquist)
      return [nearest, nearest + 1]
    })
    this.attack = envelopeCoefficient(cfg.attackMs)
    this.release = envelopeCoefficient(cfg.releaseMs)
    this.smoothing = envelopeCoefficient(cfg.timeSmoothMs)
    this.decay = envelopeCoefficient(cfg.decayMs)
  }
  push(offset: number, left: Float32Array, right = left) {
    if (!Number.isSafeInteger(offset) || left.length !== right.length) throw Error('Invalid PCM block.')
    const limit = Math.ceil(this.data.duration * this.rate)
    if (offset > limit) return
    if (offset > this.written) this.appendZeros(offset - this.written)
    let i = Math.max(0, this.written - offset) // Drop timestamp overlap instead of advancing the timeline twice.
    const end = Math.min(left.length, limit - offset)
    while (i < end) {
      const slot = this.written & this.mask
      const take = Math.min(end - i, this.left.length - slot, 8192)
      this.left.set(left.subarray(i, i + take), slot)
      this.right.set(right.subarray(i, i + take), slot)
      this.written += take
      i += take
      this.drain()
    }
  }
  private appendZeros(length: number) {
    while (length > 0) {
      const slot = this.written & this.mask,
        take = Math.min(length, 8192, this.left.length - slot)
      this.left.fill(0, slot, slot + take)
      this.right.fill(0, slot, slot + take)
      this.written += take
      length -= take
      this.drain()
    }
  }
  finish() {
    const lastCenter = Math.round(((this.data.count - 1) * this.rate) / FEATURE_HZ)
    this.appendZeros(Math.max(0, lastCenter + this.radius - this.written))
    if (this.songLevels && this.maxBand > 0) {
      // An intermediate log scale preserves quiet sections until the whole-track maximum is known.
      for (let i = 0; i < this.data.bands.length; i++) {
        const encoded = this.songLevels[i]
        const value = encoded === 0 ? 0 : 10 ** (9 * ((encoded - 1) / 65534 - 1))
        this.data.bands[i] = Math.round(255 * clamp(value / this.maxBand))
      }
      this.songLevels = undefined
    }
    const min = this.cfg.outMin,
      span = this.cfg.outMax - min
    if (min !== 0 || span !== 1)
      for (let i = 0; i < this.data.bands.length; i++)
        this.data.bands[i] = Math.round(min * 255 + span * this.data.bands[i])
    return this.data
  }
  private drain() {
    while (this.frameIndex < this.data.count) {
      const center = Math.round((this.frameIndex * this.rate) / FEATURE_HZ)
      if (center + this.radius > this.written) break
      this.measure(center)
      this.frameIndex++
    }
  }
  private measure(center: number) {
    const n = this.cfg.fftSize,
      cfg = this.cfg
    for (let i = 0; i < n; i++) {
      const at = center - n / 2 + i,
        slot = at & this.mask
      this.fft.real[i] = at < 0 ? 0 : this.left[slot] * this.fft.weights[i]
      this.fft.imag[i] = at < 0 ? 0 : this.right[slot] * this.fft.weights[i]
    }
    this.fft.transform()
    const ch = channels[cfg.channel]
    this.channelEnergy.fill(0)
    const re = this.fft.real,
      im = this.fft.imag
    const scale = this.fft.scale
    for (let i = 0; i <= n / 2; i++) {
      const j = (n - i) % n
      const lr = (re[i] + re[j]) * 0.5,
        li = (im[i] - im[j]) * 0.5,
        rr = (im[i] + im[j]) * 0.5,
        ri = (re[j] - re[i]) * 0.5
      const l = lr * lr + li * li,
        r = rr * rr + ri * ri,
        cross = 2 * (lr * rr + li * ri)
      const mid = Math.max(0, (l + r + cross) * 0.25),
        side = Math.max(0, (l + r - cross) * 0.25)
      const edge = i === 0 || i === n / 2,
        factor = (edge ? 0.5 : 1) * scale
      this.magnitude[i] = Math.sqrt(ch === 0 ? l : ch === 1 ? r : ch === 2 ? mid : side) * factor
      const bucket = this.modIndex[i],
        power = (factor * factor * (edge ? 1 : 0.5)) / this.fft.bandwidth
      this.channelEnergy[bucket] += l * power
      this.channelEnergy[MOD_BANDS + bucket] += r * power
      this.channelEnergy[2 * MOD_BANDS + bucket] += mid * power
      this.channelEnergy[3 * MOD_BANDS + bucket] += side * power
    }
    const energyBase = this.frameIndex * 4 * MOD_BANDS
    for (let i = 0; i < 4 * MOD_BANDS; i++)
      this.data.channelBands[energyBase + i] = Math.round(
        255 * Math.min(1, Math.sqrt(Math.sqrt(this.channelEnergy[i]))),
      )
    let localMax = 0
    for (let b = 0; b < BAND_COUNT; b++) {
      const [lo, hi] = this.ranges[b]
      let value = 0
      for (let j = lo; j < hi; j++) {
        const v = this.magnitude[j]
        value =
          cfg.aggregation === 'peak' ? Math.max(value, v) : value + (cfg.aggregation === 'rms' ? v * v : v)
      }
      if (cfg.aggregation !== 'peak' && hi > lo)
        value = cfg.aggregation === 'rms' ? Math.sqrt(value / (hi - lo)) : value / (hi - lo)
      value *= cfg.gain
      if (value <= Math.max(cfg.threshold, 10 ** (cfg.floorDb / 20))) value = 0
      else if (cfg.amplitude === 'db') value = 1 + (20 * Math.log10(value)) / cfg.dynamicRangeDb
      else if (cfg.amplitude === 'power') value **= cfg.exponent
      this.raw[b] = clamp(value)
      localMax = Math.max(localMax, this.raw[b])
    }
    const base = this.frameIndex * BAND_COUNT,
      radius = cfg.frequencySmooth
    for (let b = 0; b < BAND_COUNT; b++) {
      let v = this.raw[b]
      if (radius) {
        const lo = Math.max(0, b - radius),
          hi = Math.min(BAND_COUNT - 1, b + radius)
        v = 0
        for (let j = lo; j <= hi; j++) v += this.raw[j]
        v /= hi - lo + 1
      }
      if (cfg.normalization === 'adaptive' && localMax > 0) v /= localMax
      this.smoothed[b] += this.smoothing * (v - this.smoothed[b])
      const delta = this.smoothed[b] - this.envelope[b]
      this.envelope[b] += (delta >= 0 ? this.attack : this.release) * delta
      let out = this.envelope[b]
      if (cfg.holdMs > 0) {
        if (out >= this.held[b]) {
          this.held[b] = out
          this.holds[b] = Math.ceil((cfg.holdMs * FEATURE_HZ) / 1000)
        } else if (this.holds[b] > 0) this.holds[b]--
        else this.held[b] += (out - this.held[b]) * this.decay
        out = this.held[b]
      }
      this.maxBand = Math.max(this.maxBand, out)
      this.data.bands[base + b] = Math.round(255 * out)
      if (this.songLevels)
        this.songLevels[base + b] = out > 0 ? 1 + Math.round(65534 * clamp(1 + Math.log10(out) / 9)) : 0
    }
    this.metricSums.fill(0)
    this.metricPeaks.fill(0)
    const lo = Math.max(0, center - this.hopRadius),
      hi = Math.min(center + this.hopRadius, Math.ceil(this.data.duration * this.rate))
    for (let i = lo; i < hi; i++) {
      const slot = i & this.mask
      const l = this.left[slot],
        r = this.right[slot]
      for (let c = 0; c < 4; c++) {
        const v = c === 0 ? l : c === 1 ? r : c === 2 ? (l + r) / 2 : (l - r) / 2
        this.metricSums[c] += v * v
        this.metricPeaks[c] = Math.max(this.metricPeaks[c], Math.abs(v))
      }
    }
    for (let c = 0; c < 4; c++) {
      const idx = (this.frameIndex * 4 + c) * 3
      const rms = Math.sqrt(this.metricSums[c] / Math.max(1, hi - lo)),
        peak = this.metricPeaks[c]
      const prior = this.frameIndex > 0 ? this.data.channelMetrics[idx - 12] : 0
      this.data.channelMetrics[idx] = rms
      this.data.channelMetrics[idx + 1] = peak
      this.data.channelMetrics[idx + 2] = clamp(Math.max(0, rms - prior) * 4)
    }
    const idx = (this.frameIndex * 4 + ch) * 3,
      row = this.frameIndex * 3
    this.data.metrics[row] = this.data.channelMetrics[idx]
    const peak = (this.data.metrics[row + 1] = this.data.channelMetrics[idx + 1])
    this.data.metrics[row + 2] = this.data.channelMetrics[idx + 2]
    const bucket = Math.min(
      this.data.waveform.length - 1,
      Math.floor((this.frameIndex * this.data.waveform.length) / this.data.count),
    )
    this.data.waveform[bucket] = Math.max(this.data.waveform[bucket], peak)
    const waveBase = this.frameIndex * 2 * WAVE_POINTS
    for (let i = 0; i < WAVE_POINTS; i++) {
      const at = center - this.hopRadius + Math.floor(((2 * this.hopRadius - 1) * i) / (WAVE_POINTS - 1)),
        slot = at & this.mask
      this.data.waves[waveBase + i] = at < 0 ? 0 : Math.round(127 * clamp(this.left[slot], -1, 1))
      this.data.waves[waveBase + WAVE_POINTS + i] =
        at < 0 ? 0 : Math.round(127 * clamp(this.right[slot], -1, 1))
    }
  }
}
