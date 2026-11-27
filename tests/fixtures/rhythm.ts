// Original offline sound fixtures with known note timing. Seeded stereo playback, in seconds.
export type GenreFixture = 'dance' | 'acoustic' | 'breakbeat' | 'ambient' | 'tempo-change'
export function makeMusicFixture(kind: GenreFixture, duration = 12, rate = 16000) {
  const left = new Float32Array(Math.ceil(rate * duration)),
    right = new Float32Array(left.length)
  const beats: number[] = []
  const tau = 2 * Math.PI
  let generator = 44021
  const noise = () => {
    generator = (Math.imul(generator, 1664525) + 1013904223) >>> 0
    return generator / 2147483648 - 1
  }
  const note = (start: number, length: number, pan: number, fn: (seconds: number) => number) => {
    const index = Math.round(start * rate),
      n = Math.min(Math.round(length * rate), left.length - index)
    for (let i = 0; i < n; i++) {
      const v = fn(i / rate)
      left[index + i] += v * (1 - pan * 0.18)
      right[index + i] += v * (1 + pan * 0.18)
    }
  }
  if (kind === 'ambient') {
    for (let n = 0; n < left.length; n++) {
      const t = n / rate,
        fade = Math.min(1, t / 1.7, (duration - t) / 2)
      left[n] =
        fade * (0.12 * Math.sin(tau * (132 * t + 0.12 * Math.sin(t * 0.8))) + 0.08 * Math.sin(tau * 195 * t))
      right[n] = left[n] + fade * 0.06 * Math.sin(tau * (262 * t + 0.21 * Math.sin(t * 0.55)))
    }
    return { left, right, beats, rate, duration }
  }
  for (let n = 0, t = 0.35; t < duration - 0.2; n++) {
    const bpm =
      kind === 'dance'
        ? 120
        : kind === 'acoustic'
          ? 86
          : kind === 'breakbeat'
            ? 150
            : t < duration * 0.5
              ? 90
              : 132
    const beat = 60 / bpm
    const expressive = kind === 'acoustic' ? 0.014 * Math.sin(n * 1.9) : 0
    const start = t + expressive
    beats.push(start)
    if (kind === 'acoustic') {
      const hz = [196, 246.94, 293.66, 220, 174.61][n % 5]
      note(
        start,
        0.55,
        -0.5,
        (x) =>
          0.34 *
          Math.exp(-7 * x) *
          (1 - Math.exp(-160 * x)) *
          (Math.sin(tau * hz * x) + 0.4 * Math.sin(tau * 2 * hz * x) + 0.13 * Math.sin(tau * 3 * hz * x)),
      )
      note(start + beat * 0.6, 0.25, 0.7, (x) => 0.075 * Math.exp(-15 * x) * Math.sin(tau * 2 * hz * x))
    } else {
      const kick = (s: number, v: number) =>
        note(
          s,
          0.23,
          0,
          (x) => v * Math.exp(-22 * x) * Math.sin(tau * (54 * x + 3.3 * (1 - Math.exp(-27 * x)))),
        )
      const snare = (s: number, v: number) =>
        note(s, 0.13, -0.2, (x) => v * Math.exp(-35 * x) * (0.6 * noise() + 0.4 * Math.sin(tau * 182 * x)))
      if (kind === 'breakbeat') {
        if (n % 4 === 0 || n % 4 === 2) kick(start, 0.62)
        if (n % 4 === 1 || n % 4 === 3) snare(start, 0.57)
        if (n % 4 === 2) kick(start + beat * 0.76, 0.22)
      } else {
        kick(start, 0.55)
        if (n % 2 === 1) snare(start, 0.18)
      }
      note(
        start + beat * 0.51,
        0.07,
        0.8,
        (x) => 0.13 * Math.exp(-70 * x) * (Math.sin(tau * 5600 * x) + 0.25 * noise()),
      )
    }
    t += beat
  }
  return { left, right, beats, rate, duration }
}
