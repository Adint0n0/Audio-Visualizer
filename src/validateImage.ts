const imageLimit = 64 * 1024 * 1024
const svgLimit = 1024 * 1024
const svgNamespace = 'http://www.w3.org/2000/svg'
const tags = new Set(
  'svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath title desc'.split(
    ' ',
  ),
)
const attributes = new Set(
  (
    'xmlns id version viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry fx fy d points transform opacity ' +
    'stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset fill fill-rule fill-opacity ' +
    'clip-path clip-rule gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity color vector-effect'
  ).split(' '),
)
const dimensionLimit = (width: number, height: number) => {
  if (
    !Number.isFinite(width * height) ||
    width <= 0 ||
    height <= 0 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 32_000_000
  ) {
    throw new Error('Image dimensions exceed 32 megapixels or 16,384 pixels per side')
  }
}
function svgDimension(value: string | null, fallback: number) {
  if (value === null || /^\d+(?:\.\d+)?%$/.test(value)) return fallback
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/.test(value)) throw new Error('Unsupported SVG dimension unit')
  return parseFloat(value)
}
/** Accept standalone vector artwork, including local gradient/clip references. No active content or CSS. */
export function validateSvg(source: string): void {
  if (source.length > svgLimit || /<!(?:DOCTYPE|ENTITY)|<\?(?!xml\s)/i.test(source))
    throw new Error('Unsupported SVG declaration')
  const dom = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = dom.documentElement
  if (root.localName !== 'svg' || root.namespaceURI !== svgNamespace || dom.querySelector('parsererror'))
    throw new Error('Invalid SVG image')
  const elements = dom.getElementsByTagName('*')
  if (elements.length > 8000) throw new Error('SVG is too complex')
  for (const el of elements) {
    if (el.namespaceURI !== svgNamespace || !tags.has(el.localName))
      throw new Error('Unsupported SVG element: ' + el.localName)
    for (const attr of el.attributes) {
      if (!attributes.has(attr.name) || (attr.name === 'xmlns' && attr.value !== svgNamespace))
        throw new Error('Unsupported SVG attribute: ' + attr.name)
      if (attr.name === 'xmlns') continue
      const value = attr.value.trim()
      if (
        /[\\:;"'@<>]/.test(value) ||
        /\/\*|\/\//.test(value) ||
        (/url\s*\(/i.test(value) && !/^url\(\s*#[\w.-]+\s*\)$/i.test(value)) ||
        /(?:var|image|env|paint|attr|element|cross-fade)\s*\(/i.test(value)
      )
        throw new Error('Unsafe SVG attribute value')
    }
  }
  const vb = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (vb && (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0))
    throw new Error('Invalid SVG viewBox')
  dimensionLimit(
    svgDimension(root.getAttribute('width'), vb?.[2] ?? 300),
    svgDimension(root.getAttribute('height'), vb?.[3] ?? 150),
  )
}

export async function imageMime(
  file: Blob,
): Promise<'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'> {
  if (file.size > imageLimit || file.size === 0) throw new Error('Image must be between 1 byte and 64 MiB')
  const prefix = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const d = new DataView(prefix.buffer)
  if (
    prefix.length >= 24 &&
    d.getUint32(0) === 0x89504e47 &&
    d.getUint32(4) === 0x0d0a1a0a &&
    d.getUint32(12) === 0x49484452
  ) {
    dimensionLimit(d.getUint32(16), d.getUint32(20))
    if (d.getUint32(8) !== 13) throw new Error('Invalid PNG header')
    // APNG control appears ahead of the first IDAT. Keeping animation out of still-image
    // slots ensures their texture is determined by the project, including after a seek.
    let offset = 33
    for (let n = 0; n < 2048 && offset + 12 <= file.size; n++) {
      const chunk = new DataView(await file.slice(offset, offset + 8).arrayBuffer())
      const length = chunk.getUint32(0),
        kind = chunk.getUint32(4)
      if (offset + length + 12 > file.size) break
      if (kind === 0x6163544c) throw new Error('Animated backgrounds are unsupported')
      if (kind === 0x49444154) return 'image/png'
      offset += 12 + length
    }
    throw new Error('Invalid PNG image data')
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8) {
    const bytes = new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer())
    const view = new DataView(bytes.buffer)
    for (let pos = 2; pos + 9 <= bytes.byteLength;) {
      if (bytes[pos++] !== 0xff) break
      while (bytes[pos] === 0xff) pos++
      const code = bytes[pos++]
      if (code === 0xda || code === 0xd9 || pos + 7 > bytes.length) break
      if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) continue
      const length = view.getUint16(pos)
      if (length < 2) break
      if (code >= 0xc0 && code <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(code) && length >= 7) {
        dimensionLimit(view.getUint16(pos + 5), view.getUint16(pos + 3))
        return 'image/jpeg'
      }
      pos += length
    }
    throw new Error('Invalid JPEG dimensions')
  }
  if (prefix.length >= 30 && d.getUint32(0) === 0x52494646 && d.getUint32(8) === 0x57454250) {
    switch (d.getUint32(12)) {
      case 0x56503858:
        if (prefix[20] & 2) throw new Error('Animated backgrounds are unsupported')
        dimensionLimit((d.getUint32(24, true) & 0xffffff) + 1, (d.getUint32(26, true) >>> 8) + 1)
        return 'image/webp'
      case 0x56503820:
        dimensionLimit(d.getUint16(26, true) & 0x3fff, d.getUint16(28, true) & 0x3fff)
        return 'image/webp'
      case 0x5650384c: {
        const bits = d.getUint32(21, true)
        dimensionLimit((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
        return 'image/webp'
      }
    }
  }
  if (
    file.size <= svgLimit &&
    (file.type === 'image/svg+xml' || new TextDecoder().decode(prefix).trimStart().startsWith('<'))
  ) {
    validateSvg(await file.text())
    return 'image/svg+xml'
  }
  throw new Error('Choose a PNG, JPEG, WebP, or standalone SVG image')
}

export async function validateImage(file: Blob): Promise<void> {
  await imageMime(file)
}
