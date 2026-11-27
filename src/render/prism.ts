import * as T from 'three'
import type { Layer } from '../model'
import { buffered, clamp01, level, palette, TAU, updateMaterial, type Visual } from './common'

// A twisted annulus. The shaded skin occludes its far-side contours and establishes
// self-overlap as the object rotates. Both skin and filaments share the same vertices.
export function createPrism(layer: Layer): Visual {
  const rows = Math.max(8, Math.min(160, Math.round(layer.settings.count))),
    cols = 192
  const triangles: number[] = [],
    lines: number[] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i,
        b = j * cols + ((i + 1) % cols)
      lines.push(a, b)
      if (j + 1 < rows) triangles.push(a, b, a + cols, b, b + cols, a + cols)
    }
  const skinGeo = buffered(rows * cols, triangles),
    lineGeo = new T.BufferGeometry()
  lineGeo.setAttribute('position', skinGeo.getAttribute('position'))
  lineGeo.setAttribute('color', skinGeo.getAttribute('color'))
  lineGeo.setIndex(lines)
  const pos = skinGeo.getAttribute('position'),
    color = skinGeo.getAttribute('color')
  const skin = new T.MeshBasicMaterial({
    color: 0x344057,
    vertexColors: true,
    side: T.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const silk = new T.LineBasicMaterial({ vertexColors: true })
  const group = new T.Group(),
    mesh = new T.Mesh(skinGeo, skin),
    contours = new T.LineSegments(lineGeo, silk)
  mesh.frustumCulled = false
  contours.frustumCulled = false
  group.add(mesh, contours)
  const grad = palette(),
    col = new T.Color()
  const angles = Array.from({ length: cols }, (_, i) => (TAU * i) / cols)
  // Separate row/column trigonometric factors; animated folds then cost a
  // handful of scalar products per vertex instead of three transcendentals.
  const strands = Array.from({ length: rows }, (_, j) => {
    const w = (2 * j) / (rows - 1) - 1
    return {
      w,
      cosEdge: Math.cos(0.66 * w),
      sinEdge: Math.sin(0.66 * w),
      cosFold: Math.cos(w * Math.PI * 0.8),
      sinFold: Math.sin(w * Math.PI * 0.8),
    }
  })
  return {
    object: group,
    update(f) {
      const { settings: s } = f.layer,
        tint = grad(f.layer, f.time)
      const time = f.time * s.speed * 0.18,
        radius = s.radius,
        rms = clamp01(f.audio.rms * s.gain)
      group.rotation.set(0.55 + Math.sin(time * 0.4) * 0.08, -0.28 + Math.sin(time * 0.32) * 0.14, -0.37)
      group.scale.set(1.32, 0.91, 1)
      group.position.y = -radius * 0.12
      for (let i = 0; i < cols; i++) {
        const a = angles[i],
          cs = Math.cos(a),
          sn = Math.sin(a)
        const freq = (1 - cs) * 0.5
        const amp = level(f, freq)
        const center =
          radius * (0.92 + 0.11 * Math.sin(3 * a + time) + 0.065 * Math.cos(2 * a - time * 0.8) + 0.07 * amp)
        const elevation =
          radius * (0.28 * Math.sin(2 * a - time * 0.6) + 0.12 * Math.cos(3 * a + 0.6 + time * 0.5))
        const twist = a * 2 + 0.6 * Math.sin(3 * a - time) + time * 0.45
        const cosTwist = Math.cos(twist),
          sinTwist = Math.sin(twist)
        const width = radius * (0.41 + 0.16 * (0.5 + 0.5 * Math.cos(3 * a - time)) + 0.06 * rms)
        for (let j = 0; j < rows; j++) {
          const { w, cosEdge, sinEdge, cosFold, sinFold } = strands[j]
          const edge = cosTwist * cosEdge - sinTwist * sinEdge,
            depth = sinTwist * cosEdge + cosTwist * sinEdge
          const r = center + width * w * edge
          const z = elevation + width * w * depth + radius * 0.16 * (cosFold * cs - sinFold * sn) * sn
          const k = j * cols + i
          pos.setXYZ(k, r * cs, r * sn, z)
          const u = clamp01(0.5 + 0.38 * cs + 0.17 * sn + 0.2 * w)
          tint(freq, amp, col, u).multiplyScalar(0.65 + 0.32 * (1 - Math.abs(w)) + 0.2 * amp)
          color.setXYZ(k, col.r, col.g, col.b)
        }
      }
      pos.needsUpdate = true
      color.needsUpdate = true
      updateMaterial(skin, f.layer)
      updateMaterial(silk, f.layer)
      // A depth prepass is essential for a solid ribbon even with additive filaments.
      skin.blending = T.NormalBlending
      skin.depthWrite = f.layer.depthTest && f.layer.opacity >= 0.99
      mesh.visible = !f.layer.material.wireframe
      silk.depthWrite = false
    },
  }
}
