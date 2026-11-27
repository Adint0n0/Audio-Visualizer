// Audio descriptors are calculated once at source times, before the renderer or export range is chosen.
export interface MusicFeatures {
  /** Unweighted RMS amplitudes in 20–250 Hz, 250–4000 Hz and 4000 Hz–Nyquist. */
  bass: number
  mid: number
  treble: number
  centroidHz: number
  /** Log-frequency centroid scaled from 40 Hz to 16 kHz. */
  brightness: number
  /** A short decaying response to a local spectral-flux peak. */
  transient: number
  /** A periodic pulse gated by rhythmic confidence. */
  beat: number
  /** Local estimated BPM. Zero when the event pattern is ambiguous. */
  tempo: number
  confidence: number
}

const BASS = 0,
  MID = 1,
  TREBLE = 2,
  CENTROID = 3,
  TRANSIENT = 4,
  BEAT = 5,
  TEMPO = 6,
  CONFIDENCE = 7
export const MUSIC_VALUES = 8
export const quietMusic: MusicFeatures = {
  bass: 0,
  mid: 0,
  treble: 0,
  centroidHz: 0,
  brightness: 0,
  transient: 0,
  beat: 0,
  tempo: 0,
  confidence: 0,
}
const unit = (v: number) => Math.max(0, Math.min(1, v))

export function musicAt(rows: Float32Array, frame: number): MusicFeatures {
  const i = frame * MUSIC_VALUES
  const centroidHz = rows[i + CENTROID]
  return {
    bass: rows[i + BASS],
    mid: rows[i + MID],
    treble: rows[i + TREBLE],
    centroidHz,
    brightness: unit(Math.log(Math.max(40, centroidHz) / 40) / Math.log(16000 / 40)),
    transient: rows[i + TRANSIENT],
    beat: rows[i + BEAT],
    tempo: rows[i + TEMPO],
    confidence: rows[i + CONFIDENCE],
  }
}

export function demoMusic(time: number): MusicFeatures {
  const phase = Math.max(0, time) * 1.8
  const bass = Math.exp(-5 * (phase % 1)),
    transient = Math.exp(-9 * ((phase * 2) % 1))
  const brightness = 0.43 + 0.22 * Math.sin(phase * 0.8)
  return {
    bass: 0.12 + 0.44 * bass,
    mid: 0.16 + 0.09 * Math.sin(phase * 1.07),
    treble: 0.05 + 0.13 * transient,
    centroidHz: 40 * 400 ** brightness,
    brightness,
    transient,
    beat: bass,
    tempo: 108,
    confidence: 0.92,
  }
}

export class SpectralDescriptors {
  private readonly previous: Float64Array
  private readonly hzPerBin: number
  private readonly first: number
  private readonly mid: number
  private readonly treble: number
  constructor(
    rate: number,
    size: number,
    buckets: number,
    private readonly noiseBandwidth: number,
  ) {
    this.hzPerBin = rate / size
    this.first = Math.ceil(20 / this.hzPerBin)
    this.mid = Math.ceil(250 / this.hzPerBin)
    this.treble = Math.ceil(4000 / this.hzPerBin)
    this.previous = new Float64Array(buckets)
  }
  measure(
    rows: Float32Array,
    frame: number,
    magnitude: Float64Array,
    channelEnergy: Float64Array,
    channel: number,
  ) {
    let bass = 0,
      mid = 0,
      treble = 0,
      weight = 0,
      weightedBin = 0
    const last = magnitude.length - 1
    for (let i = this.first; i <= last; i++) {
      const mag = magnitude[i]
      // Interior bins contain two-sided sinusoidal peak amplitudes; Nyquist contains one real coefficient.
      const power = mag * mag * (i === last ? 1 : 0.5)
      if (i < this.mid) bass += power
      else if (i < this.treble) mid += power
      else treble += power
      weight += mag
      weightedBin += i * mag
    }
    const offset = frame * MUSIC_VALUES
    rows[offset + BASS] = unit(Math.sqrt(bass / this.noiseBandwidth))
    rows[offset + MID] = unit(Math.sqrt(mid / this.noiseBandwidth))
    rows[offset + TREBLE] = unit(Math.sqrt(treble / this.noiseBandwidth))
    rows[offset + CENTROID] = weight > 1e-7 ? (this.hzPerBin * weightedBin) / weight : 0
    // Log-compressed subband power makes changes in quiet, high-frequency instruments observable.
    // A change in pitch can be an onset even when the broadband RMS stays constant.
    let flux = 0
    for (let i = 0; i < this.previous.length; i++) {
      const value = Math.log1p(32 * Math.sqrt(channelEnergy[channel * this.previous.length + i]))
      const delta = Math.max(0, value - this.previous[i])
      flux += delta * delta
      this.previous[i] = value
    }
    rows[offset + TRANSIENT] = Math.sqrt(flux)
  }
}

type Attack = { frame: number; intensity: number; weight: number }
function findAttacks(rows: Float32Array, metrics: Float32Array, hz: number) {
  const attacks: Attack[] = []
  const count = rows.length / MUSIC_VALUES
  const release = Math.exp(-1 / (hz * 0.3)),
    refractory = Math.max(1, Math.round(hz * 0.08))
  let floor = 0
  for (let n = 0; n < count; n++) {
    const i = n * MUSIC_VALUES
    const value = rows[i + TRANSIENT]
    const contrast = value - 2 * floor
    floor = floor * release + value * (1 - release)
    if (
      contrast < 0.045 ||
      (n > 0 && rows[i - MUSIC_VALUES + TRANSIENT] > value) ||
      (n + 1 < count && rows[i + MUSIC_VALUES + TRANSIENT] >= value)
    )
      continue
    // Refine a spectral attack against the local amplitude edge when the two agree.
    let frame = n
    for (let j = Math.max(0, n - 1); j <= Math.min(count - 1, n + 2); j++) {
      if (metrics[j * 3 + 2] > 0.08 && metrics[j * 3 + 2] > metrics[frame * 3 + 2]) frame = j
    }
    const bassRise = Math.max(0, rows[i + BASS] - (n > 2 ? rows[i - 3 * MUSIC_VALUES + BASS] : 0))
    const attack = {
      frame,
      intensity: unit(contrast / (contrast + 0.45)),
      weight: Math.log1p(contrast) + 2 * bassRise,
    }
    const prev = attacks[attacks.length - 1]
    if (!prev || frame - prev.frame >= refractory) attacks.push(attack)
    else if (attack.weight > prev.weight) attacks[attacks.length - 1] = attack
  }
  return attacks
}

type BeatGrid = { period: number; phase: number; confidence: number }
function fitGrid(
  attacks: Attack[],
  first: number,
  end: number,
  center: number,
  radius: number,
  hz: number,
): BeatGrid | null {
  if (end - first < 4) return null
  // Fold a six-second neighborhood onto each candidate beat period. Score both the proportion of onset
  // energy on the grid and the proportion of predicted beats that have a matching attack.
  let best: BeatGrid | null = null,
    bestScore = 0
  const cells = 48,
    hist = new Float64Array(cells),
    weights = new Float64Array(end - first)
  let total = 0
  for (let j = first; j < end; j++) {
    const event = attacks[j]
    weights[j - first] = event.weight * (1 - 0.55 * Math.min(1, Math.abs(event.frame - center) / radius))
    total += weights[j - first]
  }
  for (let period = hz / 3; period <= hz; period += 0.5) {
    hist.fill(0)
    for (let j = first; j < end; j++) {
      const bin = Math.round(((attacks[j].frame % period) / period) * cells) % cells
      hist[bin] += weights[j - first]
    }
    let bestBin = 0,
      tallest = -1
    for (let b = 0; b < cells; b++) {
      const mass =
        hist[b] +
        0.75 * (hist[(b + 1) % cells] + hist[(b + cells - 1) % cells]) +
        0.4 * (hist[(b + 2) % cells] + hist[(b + cells - 2) % cells])
      if (mass > tallest) {
        bestBin = b
        tallest = mass
      }
    }
    const phase = (period * bestBin) / cells
    let matched = 0,
      hits = 0,
      lastHit = -Infinity,
      firstHit = 0,
      lastFrame = 0
    let weightedError = 0,
      correctionWeight = 0,
      even = 0,
      odd = 0
    for (let j = first; j < end; j++) {
      const event = attacks[j],
        beat = Math.round((event.frame - phase) / period)
      const error = event.frame - (beat * period + phase),
        distance = Math.abs(error)
      const tolerance = Math.max(1.5, period * 0.105)
      if (distance > tolerance) continue
      const w = weights[j - first],
        strength = w * (1 - 0.5 * (distance / tolerance) ** 2)
      matched += strength
      weightedError += w * error
      correctionWeight += w
      if (beat % 2 === 0) even += strength
      else odd += strength
      if (beat !== lastHit) {
        if (!hits) firstHit = event.frame
        hits++
        lastFrame = event.frame
        lastHit = beat
      }
    }
    const activeSpan = attacks[end - 1].frame - attacks[first].frame
    if (hits < 4 || lastFrame - firstHit < hz * 1.4 || lastFrame - firstHit < activeSpan * 0.67) continue
    const coverage = Math.min(1, hits / (1 + activeSpan / period))
    // Less agreement is required for ghost notes when most predicted beats are supported by attacks.
    const confidence = unit((matched / total) * Math.sqrt(coverage))
    // Uniform hats between stronger kicks can support a double-tempo grid. Compare its two accent phases
    // where half tempo is still in the supported range.
    const balance = Math.min(even, odd) / Math.max(1e-8, even, odd)
    const accentScore = period * 2 <= hz ? 0.45 + 0.55 * Math.sqrt(balance) : 1
    const score =
      confidence *
      accentScore *
      (0.95 + 0.05 * Math.exp(-0.5 * (Math.log2((60 * hz) / period / 112) / 0.56) ** 2))
    if (score > bestScore && confidence >= 0.57) {
      bestScore = score
      best = { period, phase: phase + weightedError / correctionWeight, confidence }
    }
  }
  return best
}

export function finishMusic(rows: Float32Array, metrics: Float32Array, hz: number) {
  const events = findAttacks(rows, metrics, hz),
    count = rows.length / MUSIC_VALUES
  const radius = Math.round(hz * 3),
    step = Math.max(1, Math.round(hz / 2))
  const transientDecay = Math.exp(-1 / (hz * 0.14))
  let next = 0,
    prev = -Infinity,
    envelope = 0,
    first = 0,
    end = 0
  let grid: BeatGrid | null = null
  for (let n = 0; n < count; n++) {
    const i = n * MUSIC_VALUES
    if (n % step === 0) {
      const center = n + step / 2
      while (first < events.length && events[first].frame < center - radius) first++
      while (end < events.length && events[end].frame <= center + radius) end++
      grid = fitGrid(events, first, end, center, radius, hz)
    }
    envelope *= transientDecay
    while (next < events.length && events[next].frame <= n) {
      envelope = Math.max(envelope, events[next].intensity)
      prev = events[next].frame
      next++
    }
    rows[i + TRANSIENT] = envelope
    if (grid && n - prev < grid.period * 1.35 && (next < events.length || n - prev < grid.period * 0.8)) {
      const distance = (((n - grid.phase) % grid.period) + grid.period) % grid.period
      // Fit error below one analysis row must not delay the apparent attack by a whole beat.
      const phase = distance > grid.period - 0.5 ? 0 : distance
      rows[i + BEAT] = grid.confidence * Math.exp(-phase / (hz * 0.11))
      rows[i + TEMPO] = (60 * hz) / grid.period
      rows[i + CONFIDENCE] = grid.confidence
    }
  }
}
