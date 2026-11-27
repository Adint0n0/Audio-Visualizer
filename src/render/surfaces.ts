import * as T from 'three'
import type { Layer } from '../model'
import { band, buffered, clamp01, level, palette, surface, TAU, updateMaterial, type Visual } from './common'

export function createOrb(layer: Layer): Visual {
  const poly = layer.style === 'polygon'
  const detail = poly
    ? Math.min(3, Math.floor(layer.settings.count / 30))
    : Math.min(5, Math.max(2, Math.floor(Math.sqrt(layer.settings.count) / 2)))
  const geo = new T.IcosahedronGeometry(1, detail),
    mat = surface(layer, true),
    object = new T.Mesh(geo, mat)
  const pos = geo.getAttribute('position'),
    initial = new Float32Array(pos.array)
  const colors = new T.Float32BufferAttribute(initial.length, 3)
  geo.setAttribute('color', colors)
  const col = new T.Color(),
    grad = palette()
  object.frustumCulled = false
  return {
    object,
    update(f) {
      const { layer: l, time } = f,
        s = l.settings,
        tint = grad(l, time)
      for (let i = 0; i < pos.count; i++) {
        const x = initial[i * 3],
          y = initial[i * 3 + 1],
          z = initial[i * 3 + 2],
          u = (y + 1) / 2,
          e = level(f, u)
        const p = time * s.speed * 0.5
        const ripple = Math.sin(4 * x + 2 * z + p) * Math.cos(3 * y - 1.3 * p) * 0.08
        const r = s.radius * (1 + ripple + s.maxHeight * 0.17 * e)
        pos.setXYZ(i, x * r, y * r + s.baseline, z * r)
        tint(u, e, col)
        colors.setXYZ(i, col.r, col.g, col.b)
      }
      pos.needsUpdate = true
      colors.needsUpdate = true
      geo.computeVertexNormals()
      updateMaterial(mat, l)
      object.castShadow = l.material.shadow
      object.receiveShadow = l.material.shadow
    },
  }
}
export function createField(layer: Layer): Visual {
  const spectro = layer.style === 'spectrogram',
    fall = layer.style === 'waterfall'
  const nx = Math.max(2, Math.min(256, layer.settings.columns)),
    nz = Math.max(2, Math.min(180, layer.settings.history))
  const indices: number[] = []
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx
      indices.push(a, a + nx, a + 1, a + 1, a + nx, a + 1 + nx)
    }
  const geo = buffered(nx * nz, indices),
    mat = surface(layer, true),
    object = new T.Mesh(geo, mat)
  const pos = geo.getAttribute('position'),
    colors = geo.getAttribute('color'),
    col = new T.Color(),
    grad = palette()
  object.frustumCulled = false
  const uv = new Float32Array(nx * nz * 2)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = 2 * (j * nx + i)
      uv[k] = i / (nx - 1)
      uv[k + 1] = j / (nz - 1)
    }
  geo.setAttribute('uv', new T.BufferAttribute(uv, 2))
  const group = new T.Group()
  group.add(object)
  if (fall) {
    const ridges = new T.BufferGeometry(),
      segments: number[] = []
    ridges.setAttribute('position', pos)
    ridges.setAttribute('color', colors)
    for (let z = 0; z < nz; z++) for (let i = 0; i < nx - 1; i++) segments.push(z * nx + i, z * nx + i + 1)
    ridges.setIndex(segments)
    const stroke = new T.LineSegments(ridges, new T.LineBasicMaterial({ vertexColors: true }))
    stroke.frustumCulled = false
    group.add(stroke)
    mat.polygonOffset = true
    mat.polygonOffsetFactor = 1
    mat.polygonOffsetUnits = 1
  }
  return {
    object: group,
    update(f) {
      const { layer: l, time } = f,
        s = l.settings,
        tint = grad(l, time)
      for (let j = 0; j < nz; j++) {
        const v = j / (nz - 1),
          bins = j ? f.audio.history(j / 30) : f.audio.bands
        for (let i = 0; i < nx; i++) {
          const u = i / (nx - 1),
            e = clamp01(band(bins, s.reverse ? 1 - u : u) * s.gain)
          const h = s.minHeight + (s.maxHeight - s.minHeight) * e
          const x = (u - 0.5) * s.radius * 2.5,
            depth = (v - 0.5) * Math.max(0.3, s.depth * 12)
          const undulation =
            layer.style === 'terrain' ? 0.18 * Math.sin(u * 9 + v * 7 + time * s.speed * 0.38) : 0
          pos.setXYZ(
            j * nx + i,
            x,
            s.baseline + (spectro ? (v - 0.5) * s.radius * 1.6 : h + undulation),
            spectro ? 0 : -depth,
          )
          tint(u, e, col)
          col.multiplyScalar(spectro ? 0.04 + e * 1.6 : fall ? 0.34 + 0.6 * e : 0.5 + 0.8 * e)
          colors.setXYZ(j * nx + i, col.r, col.g, col.b)
        }
      }
      pos.needsUpdate = true
      colors.needsUpdate = true
      geo.computeVertexNormals()
      updateMaterial(mat, l)
      object.castShadow = l.material.shadow
      object.receiveShadow = l.material.shadow
      if (fall) updateMaterial((group.children[1] as T.LineSegments).material as T.Material, l)
    },
  }
}
// Camera-independent plane strip gives the waveform an actual width on WebGL implementations
// whose native lineWidth is permanently clamped to one pixel.
export function createCurve(layer: Layer): Visual {
  const tunnel = layer.style === 'tunnel',
    stereo = layer.style === 'lissajous',
    rings = tunnel ? Math.max(2, Math.min(64, layer.settings.rows)) : 1
  const n = Math.max(8, Math.min(2048, Math.round(layer.settings.count))),
    len = n + (tunnel ? 1 : 0)
  const idx: number[] = []
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < len - 1; i++) {
      const k = (j * len + i) * 2
      idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3)
    }
  const geo = buffered(len * 2 * rings, idx),
    mat = surface(layer, true),
    object = new T.Mesh(geo, mat)
  const pos = geo.getAttribute('position'),
    colors = geo.getAttribute('color'),
    col = new T.Color(),
    grad = palette()
  const uv = new Float32Array(len * rings * 4)
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < len; i++) {
      const k = (j * len + i) * 4
      uv[k] = uv[k + 2] = i / (len - 1)
      uv[k + 1] = 0
      uv[k + 3] = 1
    }
  geo.setAttribute('uv', new T.BufferAttribute(uv, 2))
  const pts = Array.from({ length: len }, () => new T.Vector3())
  object.frustumCulled = false
  return {
    object,
    update(f) {
      const { layer: l, time } = f,
        s = l.settings,
        tint = grad(l, time)
      for (let j = 0; j < rings; j++) {
        const scroll = T.MathUtils.euclideanModulo(time * s.speed * 0.18 + j / rings, 1)
        const hist = tunnel && j ? f.audio.history(j / 30) : f.audio.bands
        for (let i = 0; i < len; i++) {
          const u = i / (len - 1),
            e = band(hist, s.reverse ? 1 - u : u) * s.gain
          if (tunnel) {
            const a = u * TAU + T.MathUtils.degToRad(s.startAngle) + scroll * 0.7
            const r = s.radius * (1 + 0.14 * e)
            pts[i].set(
              Math.cos(a) * r,
              Math.sin(a) * r + s.baseline,
              (scroll - 0.65) * Math.max(1, s.depth * 20),
            )
          } else if (stereo) {
            pts[i].set(
              band(f.audio.left, u) * s.radius * s.gain,
              band(f.audio.right, u) * s.radius * s.gain + s.baseline,
              0,
            )
          } else {
            pts[i].set(
              (u - 0.5) * s.radius * 2.6,
              s.baseline + band(f.audio.wave, s.reverse ? 1 - u : u) * s.maxHeight * s.gain,
              0,
            )
          }
        }
        for (let i = 0; i < len; i++) {
          const p = pts[i],
            a = pts[Math.max(0, i - 1)],
            b = pts[Math.min(len - 1, i + 1)]
          const lenXY = Math.max(1e-7, Math.hypot(b.x - a.x, b.y - a.y)),
            width = Math.max(0.002, s.lineWidth * 0.006)
          const dx = ((a.y - b.y) / lenXY) * width,
            dy = ((b.x - a.x) / lenXY) * width,
            k = (j * len + i) * 2
          pos.setXYZ(k, p.x + dx, p.y + dy, p.z)
          pos.setXYZ(k + 1, p.x - dx, p.y - dy, p.z)
          tint(i / (len - 1), level(f, i / (len - 1)), col)
          colors.setXYZ(k, col.r, col.g, col.b)
          colors.setXYZ(k + 1, col.r, col.g, col.b)
        }
      }
      pos.needsUpdate = true
      colors.needsUpdate = true
      geo.computeVertexNormals()
      updateMaterial(mat, l)
    },
  }
}
