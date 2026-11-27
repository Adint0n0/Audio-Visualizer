export const MAX_SIDE = 4096
const MAX_PIXELS = 8847360
const SHORT_EDGES = [720, 1080, 1440, 2160]

export const ASPECT_PRESETS = [
  [16, 9],
  [1, 1],
  [9, 16],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [5, 4],
  [4, 5],
  [2, 1],
  [1, 2],
  [21, 9],
  [9, 21],
] as const

export type PixelSize = { width: number; height: number }
export type Aspect = readonly [number, number]

export function validPixelSize({ width, height }: PixelSize) {
  return (
    [width, height].every((value) => Number.isInteger(value) && value >= 2 && value <= MAX_SIDE) &&
    width * height <= MAX_PIXELS
  )
}

export function aspectOf(width: number, height: number): Aspect {
  let a = width,
    b = height
  while (b) [a, b] = [b, a % b]
  return [width / a, height / a]
}

export function hasAspect({ width, height }: PixelSize, [w, h]: Aspect) {
  return width * h === height * w
}

export function sizeForAspect(
  shortEdge: number,
  aspectWidth: number,
  aspectHeight: number,
): PixelSize | null {
  // Prefer even sides for H.264. Some existing custom ratios only have an odd size within the limit.
  const upper = multiplierLimit(aspectWidth, aspectHeight)
  if (upper < 1) return null
  const multiplier =
    upper < 2
      ? 1
      : 2 * Math.max(1, Math.floor(Math.min(shortEdge / Math.min(aspectWidth, aspectHeight), upper) / 2))
  const size = { width: aspectWidth * multiplier, height: aspectHeight * multiplier }
  return validPixelSize(size) ? size : null
}

export function resolutionPresets([w, h]: Aspect) {
  const sizes = new Map<string, PixelSize>()
  for (const edge of SHORT_EDGES) {
    const size = sizeForAspect(edge, w, h)
    if (size) sizes.set(size.width + 'x' + size.height, size)
  }
  return [...sizes.values()]
}

function multiplierLimit(w: number, h: number) {
  return Math.floor(Math.min(MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h))))
}

export function lockedResolution(value: number, axis: keyof PixelSize, [w, h]: Aspect): PixelSize {
  const unit = axis === 'width' ? w : h
  const step = multiplierLimit(w, h) < 2 ? 1 : 2
  const multiplier = step * Math.max(1, Math.round(value / (step * unit)))
  return { width: w * multiplier, height: h * multiplier }
}
