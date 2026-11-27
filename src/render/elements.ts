import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Layer } from '../model'
import { level, noise, palette, surface, TAU, updateMaterial, type Visual } from './common'
import { samplePath } from './path'

function shapeGeometry(l: Layer) {
  switch (l.shape) {
    case 'sphere':
      return new T.SphereGeometry(0.5, 12, 8)
    case 'dot':
      return new T.CircleGeometry(0.5, 16)
    case 'triangle':
      return new T.ConeGeometry(0.6, 1, 3)
    case 'mesh':
      return new T.IcosahedronGeometry(0.55, 1)
    case 'rounded':
      return new RoundedBoxGeometry(1, 1, 1, 3, Math.min(0.49, l.settings.corner))
    case 'ribbon':
      return new T.PlaneGeometry(1, 1)
    default:
      return new T.BoxGeometry(1, 1, 1)
  }
}
export function createElements(l: Layer): Visual {
  const led = l.style === 'led',
    particles = l.style === 'particles',
    s = l.settings
  const n = led ? Math.min(16384, s.rows * s.columns) : Math.max(1, Math.round(s.count))
  const geo = led ? new T.BoxGeometry(1, 1, 1) : shapeGeometry(l),
    mat = surface(l),
    object = new T.InstancedMesh(geo, mat, n)
  object.frustumCulled = false
  object.instanceMatrix.setUsage(T.DynamicDrawUsage)
  const tr = new T.Object3D(),
    color = new T.Color(),
    grad = palette(),
    up = new T.Vector3(0, 1, 0),
    dir = new T.Vector3()
  const path = l.layout === 'path' ? samplePath(s.path, n, s.closed) : null
  return {
    object,
    update(f) {
      const { layer: l, time } = f,
        s = l.settings,
        tint = grad(l, time)
      updateMaterial(mat, l)
      object.castShadow = l.material.shadow
      object.receiveShadow = l.material.shadow
      for (let i = 0; i < n; i++) {
        const u = i / Math.max(1, n - 1)
        let x = 0,
          y = 0,
          z = 0,
          angle = 0
        const sample = l.layout === 'symmetric' ? Math.abs(2 * u - 1) : u
        let frequency = s.mirror ? Math.abs(2 * sample - 1) : sample
        if (s.reverse) frequency = 1 - frequency
        let energy = level(f, sample)
        let h = s.minHeight + (s.maxHeight - s.minHeight) * energy
        let w = s.width,
          d = s.depth
        tr.rotation.set(0, 0, 0)
        if (led) {
          const col = i % s.columns,
            row = Math.floor(i / s.columns)
          energy = level(f, col / Math.max(1, s.columns - 1))
          w = Math.max(0.012, s.width)
          h = Math.max(0.012, w * 0.75)
          x = (col - (s.columns - 1) / 2) * (w + s.spacing)
          y = (row - (s.rows - 1) / 2) * (h + s.spacing)
          tint(col / Math.max(1, s.columns - 1), row / s.rows, color)
          if (row / s.rows > energy) color.multiplyScalar(0.035)
        } else if (particles) {
          const phase = noise(f.seed, i * 9 + 1),
            life = Math.max(0.1, s.lifetime)
          // Stable per-cycle emission independent of playback direction and frame rate.
          const abs = (time * s.speed) / life + phase,
            cycle = Math.floor(abs),
            age = abs - cycle
          const seed = f.seed + cycle * 8191,
            az = noise(seed, i * 9 + 2) * TAU
          const radial = Math.sqrt(noise(seed, i * 9 + 3)) * s.spread
          x = Math.cos(az) * radial * (0.3 + age * 2.5) * s.radius
          z = Math.sin(az) * radial * (0.3 + age * 2.5) * s.radius
          y = (age - 0.5) * s.maxHeight + (1 - age) * energy * 0.65 - 0.5 * s.gravity * age * age
          h = w = d = s.width * (0.4 + energy * 1.6) * Math.max(0.015, Math.sin(Math.PI * age))
          tint(frequency, energy, color, 0.5 + x / (2 * Math.max(0.01, s.radius * s.spread)))
        } else {
          const ph = T.MathUtils.degToRad(
            s.startAngle +
              s.arc * (l.layout === 'circle' || l.layout === 'ellipse' || l.layout === 'rings' ? i / n : u),
          )
          const line = (u - 0.5) * (s.width + s.spacing) * n
          switch (l.layout) {
            case 'circle':
            case 'ellipse':
            case 'arc':
            case 'rings':
            case 'spiral': {
              const a = l.layout === 'spiral' ? ph * 2 : ph
              const r =
                s.radius *
                (l.layout === 'spiral' ? 0.2 + 0.8 * u : l.layout === 'rings' ? ((i % 3) + 2) / 4 : 1)
              x = Math.cos(a) * r * (l.layout === 'ellipse' ? 1.4 : 1)
              y = Math.sin(a) * r
              if (s.tangent) angle = a - Math.PI / 2
              if (s.inward) angle += Math.PI
              break
            }
            case 'grid':
              x = ((i % s.columns) - (s.columns - 1) / 2) * (s.width + s.spacing)
              z = (Math.floor(i / s.columns) - (Math.ceil(n / s.columns) - 1) / 2) * (s.depth + s.spacing)
              break
            case 'sphere': {
              const phi = Math.acos(1 - (2 * (i + 0.5)) / n),
                theta = i * 2.39996322973
              dir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
              x = dir.x * s.radius
              y = dir.y * s.radius
              z = dir.z * s.radius
              tr.quaternion.setFromUnitVectors(up, s.inward ? dir.negate() : dir)
              break
            }
            case 'path': {
              const p = path![i]
              x = p.x * s.radius
              y = p.y * s.radius
              if (s.tangent) angle = p.angle
              break
            }
            default:
              x = line
          }
          if (l.layout !== 'sphere') tr.rotation.z = angle
          if (l.shape === 'cube' || l.shape === 'dot' || l.shape === 'sphere' || l.shape === 'mesh') {
            h = w = d = s.width * (1 + energy * 2)
          } else if (l.shape === 'line') {
            w = Math.max(0.01, s.lineWidth * 0.01)
            d = w
          }
          dir
            .copy(up)
            .applyQuaternion(tr.quaternion)
            .multiplyScalar(h * 0.5)
          x += dir.x
          y += dir.y
          z += dir.z
          const halfSpan =
            l.layout === 'line' || l.layout === 'symmetric' ? (s.width + s.spacing) * n * 0.5 : s.radius
          tint(frequency, energy, color, 0.5 + x / (2 * Math.max(0.01, halfSpan)))
        }
        tr.position.set(x, y + s.baseline, z)
        tr.scale.set(Math.max(0.0001, w), Math.max(0.0001, h), Math.max(0.0001, d))
        tr.updateMatrix()
        object.setMatrixAt(i, tr.matrix)
        object.setColorAt(i, color)
      }
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },
  }
}
