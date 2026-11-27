import * as T from 'three'
import type { AudioFrame } from '../analysis'
import type { Layer } from '../model'

export type Frame = { layer: Layer; audio: AudioFrame; time: number; seed: number }
export type BoundsVisitor = (worldPoint: T.Vector3) => void
export type Visual = {
  object: T.Object3D
  update: (frame: Frame) => void
  dispose?: () => void
  /** Shader-displaced geometry supplies its visible world-space extent for framing and snapping. */
  bounds?: (visit: BoundsVisitor) => void
}
export const TAU = Math.PI * 2
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
export const band = (bins: ArrayLike<number>, u: number) =>
  bins[Math.round(clamp01(u) * (bins.length - 1))] || 0
export function level(frame: Frame, u: number) {
  const { settings: s } = frame.layer
  if (s.mirror) u = Math.abs(u * 2 - 1)
  return clamp01(band(frame.audio.bands, s.reverse ? 1 - u : u) * s.gain)
}
export function noise(seed: number, i: number) {
  let x = Math.imul((seed ^ i) >>> 0, 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
export function palette() {
  let signature = '',
    solid = new T.Color()
  let stops: { at: number; color: T.Color }[] = []
  return (l: Layer, t: number) => {
    const m = l.material
    const key = m.color + '|' + m.stops.map((s) => s.at + s.color).join('|')
    if (key !== signature) {
      signature = key
      solid = new T.Color(m.color)
      stops = m.stops.map((s) => ({ at: s.at, color: new T.Color(s.color) })).sort((a, b) => a.at - b.at)
    }
    return (u: number, h: number, out: T.Color, position = u) => {
      if (m.colorMode === 'solid' || !stops.length) return out.copy(solid)
      const p =
        m.colorMode === 'height'
          ? clamp01(h)
          : m.colorMode === 'cycle'
            ? T.MathUtils.euclideanModulo(t * 0.08 + u, 1)
            : m.colorMode === 'position'
              ? clamp01(position)
              : clamp01(u)
      const end = stops.findIndex((s) => s.at >= p)
      if (end === 0) return out.copy(stops[0].color)
      if (end < 0) return out.copy(stops[stops.length - 1].color)
      const a = stops[end - 1],
        b = stops[end]
      return out.lerpColors(a.color, b.color, clamp01((p - a.at) / Math.max(1e-6, b.at - a.at)))
    }
  }
}
export function surface(
  l: Layer,
  vertexColors = false,
): T.MeshBasicMaterial | T.MeshStandardMaterial | T.MeshPhysicalMaterial {
  const options = { side: T.DoubleSide, vertexColors, wireframe: l.material.wireframe }
  if (l.material.shading === 'unlit') return new T.MeshBasicMaterial(options)
  if (l.material.shading === 'glass')
    return new T.MeshPhysicalMaterial({
      ...options,
      clearcoat: 1,
      ior: 1.48,
      transmission: 0.38,
      thickness: 0.3,
    })
  return new T.MeshStandardMaterial(options)
}
export function updateMaterial(m: T.Material, l: Layer, opacity = l.opacity) {
  const style = l.material
  m.opacity = opacity
  m.transparent = opacity < 1 || style.blend !== 'normal'
  m.depthTest = l.depthTest
  m.depthWrite = l.depthTest && !m.transparent
  m.blending =
    style.blend === 'add'
      ? T.AdditiveBlending
      : style.blend === 'multiply'
        ? T.MultiplyBlending
        : T.NormalBlending
  if (m instanceof T.MeshStandardMaterial) {
    m.metalness = style.metalness
    m.roughness = style.roughness
    m.emissive.set(style.color)
    m.emissiveIntensity = style.emission * 0.35
  }
}
export function disposeObject(root: T.Object3D) {
  const meshes = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>()
  root.traverse((o) => {
    const item = o as T.Mesh
    if (item.geometry) meshes.add(item.geometry)
    if (item.material)
      for (const m of Array.isArray(item.material) ? item.material : [item.material]) materials.add(m)
    if (o instanceof T.InstancedMesh) o.dispose()
  })
  for (const g of meshes) g.dispose()
  for (const m of materials) m.dispose()
}
export function buffered(n: number, indices?: number[]) {
  const geo = new T.BufferGeometry()
  for (const key of ['position', 'color'])
    geo.setAttribute(key, new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage))
  if (indices) geo.setIndex(indices)
  return geo
}
