// Path geometry is sampled on a detached SVGPathElement. No uploaded XML is inserted in the page.
const commands = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/
const svgNS = 'http://www.w3.org/2000/svg'
export function readPath(source: string): string {
  if (source.length > 100_000) throw new Error('SVG path exceeds 100 KB')
  let value = source.trim()
  if (value.startsWith('<')) {
    if (/<!(DOCTYPE|ENTITY)/i.test(value)) throw new Error('Unsupported SVG document')
    const doc = new DOMParser().parseFromString(value, 'image/svg+xml')
    if (doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror'))
      throw new Error('Invalid SVG')
    // Extract geometry only. Scripts, event attributes, styles and references are never used.
    value = doc.getElementsByTagNameNS(svgNS, 'path')[0]?.getAttribute('d')?.trim() || ''
  }
  if (!/^[Mm]/.test(value) || !commands.test(value)) throw new Error('Invalid SVG path data')
  return value
}

export function samplePath(value: string, count: number, closed: boolean) {
  const el = document.createElementNS(svgNS, 'path')
  const d = readPath(value)
  el.setAttribute('d', closed && !/[Zz]\s*$/.test(d) ? d + ' Z' : d)
  const length = el.getTotalLength()
  if (!Number.isFinite(length) || length < 1e-6) throw new Error('Empty SVG path')
  const samples = Array.from({ length: count }, (_, i) => {
    const u = i / Math.max(1, closed ? count : count - 1)
    const p = el.getPointAtLength(length * u)
    const next = el.getPointAtLength(Math.min(length, length * u + length * 0.0001))
    const prev = el.getPointAtLength(Math.max(0, length * u - length * 0.0001))
    return { x: p.x, y: -p.y, angle: Math.atan2(prev.y - next.y, next.x - prev.x) }
  })
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity
  for (const p of samples) {
    xmin = Math.min(xmin, p.x)
    xmax = Math.max(xmax, p.x)
    ymin = Math.min(ymin, p.y)
    ymax = Math.max(ymax, p.y)
  }
  const scale = 2 / Math.max(1e-6, xmax - xmin, ymax - ymin)
  for (const p of samples) {
    p.x = (p.x - (xmin + xmax) / 2) * scale
    p.y = (p.y - (ymin + ymax) / 2) * scale
  }
  return samples
}
