import { Euler, MathUtils, Quaternion, Vector2, Vector3 } from 'three'
import { numericBounds, type Camera, type Layer, type Vec3 } from '../model'

export type Point = { x: number; y: number }
export type Rect = { left: number; right: number; top: number; bottom: number }
export type Mode = 'object' | 'orbit' | 'view'
export type Transform = Pick<Layer, 'position' | 'rotation' | 'scale'>
export type Snap = {
  enabled: boolean
  canvas: boolean
  neighbors: boolean
  grid: boolean
  angle: number
  scale: number
  distance: number
  haptic: boolean
}
export const initialSnap: Snap = {
  enabled: true,
  canvas: true,
  neighbors: true,
  grid: false,
  angle: 15,
  scale: 0,
  distance: 9,
  haptic: false,
}
export const vector = (p: Point) => new Vector2(p.x, p.y)
export const vec3 = (v: Vector3) => v.toArray() as Vec3
const degrees = MathUtils.radToDeg
const radians = MathUtils.degToRad
export const quat = (rotation: Vec3) =>
  new Quaternion().setFromEuler(new Euler(...(rotation.map(radians) as Vec3)))
export const angles = (q: Quaternion) => {
  const r = new Euler().setFromQuaternion(q)
  return [degrees(r.x), degrees(r.y), degrees(r.z)] as Vec3
}
export const clampTransform = (field: keyof Transform, v: Vec3) =>
  v.map((value, i) => MathUtils.clamp(value, ...numericBounds(field + '.' + 'xyz'[i]))) as Vec3

export type Projection = {
  center: Point
  world: Vector3
  camera: Quaternion
  parent: Quaternion
  origin: Rect
  bounds: Rect
  neighbors: Rect[]
  toLocal(p: Point): Vector3
  toScreen(p: Vector3): Point
  worldFromLocal(p: Vector3): Vector3
  localFromWorld(p: Vector3): Vector3
  fixed: boolean
}

export function contacts(points: Point[]) {
  const [a, b] = points
  if (!b) return { center: vector(a), distance: 0, angle: 0 }
  const delta = vector(b).sub(vector(a))
  return {
    center: vector(a).addScaledVector(delta, 0.5),
    distance: Math.max(1, delta.length()),
    angle: Math.atan2(delta.y, delta.x),
  }
}
export type Contacts = ReturnType<typeof contacts>
export function arcball(p: Point, rect: Rect) {
  const r = Math.max(30, Math.min(rect.right - rect.left, rect.bottom - rect.top) * 0.43)
  const x = (p.x - (rect.left + rect.right) / 2) / r,
    y = ((rect.top + rect.bottom) / 2 - p.y) / r
  const length = x * x + y * y
  return new Vector3(x, y, length < 0.5 ? Math.sqrt(1 - length) : 0.5 / Math.sqrt(length)).normalize()
}
export function snapValue(value: number, targets: number[], radius: number, latched?: number) {
  if (latched !== undefined && Math.abs(value - latched) <= radius * 1.6) return latched
  return targets.reduce<number | undefined>(
    (best, t) =>
      Math.abs(value - t) <= radius && (best === undefined || Math.abs(value - t) < Math.abs(value - best))
        ? t
        : best,
    undefined,
  )
}
export type Latch = { x?: number; y?: number; angle?: number; scale?: number; grid?: Vector3 }
export type Guides = { x?: number; y?: number; angle?: number; scale?: number; grid?: boolean }
export type Segment = { input: Contacts; projection: Projection; layer: Layer }
export function transformLayer(segment: Segment, next: Contacts, mode: Mode, snap: Snap, latch: Latch) {
  const { input, projection: p, layer } = segment
  const two = !!input.distance
  const rotate = two || mode === 'orbit'
  const between = p.parent.clone().invert().multiply(p.camera)
  let scale = two
    ? MathUtils.clamp(
        next.distance / input.distance,
        0.001 / Math.min(...layer.scale),
        1000 / Math.max(...layer.scale),
      )
    : 1
  let turn = two ? MathUtils.euclideanModulo(next.angle - input.angle + Math.PI, Math.PI * 2) - Math.PI : 0
  const guides: Guides = {}
  if (snap.enabled && two) {
    const basis = Math.max(0.001, ...layer.scale)
    const current = basis * scale
    const values = [
      0.25,
      0.5,
      1,
      1.5,
      2,
      ...(snap.scale > 0 ? [Math.round(current / snap.scale) * snap.scale] : []),
    ].filter((x) => x > 0)
    latch.scale = snapValue(
      current,
      values,
      next.distance > input.distance ? current * 0.035 : current * 0.04,
      latch.scale,
    )
    if (latch.scale !== undefined) {
      scale = latch.scale / basis
      guides.scale = latch.scale
    }
    if (snap.angle > 0) {
      const currentAngle = degrees(turn)
      const absolute = layer.rotation[2] - currentAngle
      const candidate = Math.round(absolute / snap.angle) * snap.angle
      latch.angle = snapValue(absolute, [candidate], Math.min(4, snap.angle * 0.22), latch.angle)
      if (latch.angle !== undefined) {
        turn = radians(layer.rotation[2] - latch.angle)
        guides.angle = latch.angle
      }
    }
  }
  const rotation = new Quaternion()
  if (two) rotation.setFromAxisAngle(new Vector3(0, 0, 1), -turn)
  else if (mode === 'orbit')
    rotation.setFromUnitVectors(arcball(input.center, p.origin), arcball(next.center, p.origin))
  rotation.premultiply(between).multiply(between.clone().invert())
  const offset = vector(p.center).sub(input.center)
  const center =
    mode === 'orbit' && !two
      ? vector(p.center)
      : offset.rotateAround(new Vector2(), turn).multiplyScalar(scale).add(next.center)
  if (snap.enabled && (two || mode === 'object')) {
    for (const axis of ['x', 'y'] as const) {
      const keys = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
      const [low, high] = keys
      const borders = snap.canvas ? [p.origin[low], p.origin[high], (p.origin[low] + p.origin[high]) / 2] : []
      const neighborLines = snap.neighbors
        ? p.neighbors.flatMap((n) => [n[low], n[high], (n[low] + n[high]) / 2])
        : []
      const offsets = [0, (p.bounds[low] - p.center[axis]) * scale, (p.bounds[high] - p.center[axis]) * scale]
      const lines = [...borders, ...neighborLines]
      const candidates = lines.flatMap((line) => offsets.map((off) => line - off))
      const hit = snapValue(center[axis], candidates, snap.distance, latch[axis])
      latch[axis] = hit
      if (hit !== undefined) {
        center[axis] = hit
        const line = lines.find((v) => offsets.some((off) => Math.abs(v - off - hit) < 0.01))
        guides[axis] = line ?? hit
      }
    }
  }
  const delta = p.toLocal(center).sub(p.toLocal(p.center))
  const position = new Vector3(...layer.position).add(delta)
  if (snap.enabled && snap.grid && mode === 'object' && guides.x === undefined && guides.y === undefined) {
    const local = p.toLocal(center)
    const grid = p.worldFromLocal(local)
    const step = 0.25
    const nearest = new Vector3(
      Math.round(grid.x / step) * step,
      Math.round(grid.y / step) * step,
      p.fixed ? grid.z : Math.round(grid.z / step) * step,
    )
    const near = (point: Vector3, release: number) =>
      vector(p.toScreen(p.localFromWorld(point))).distanceTo(center) < snap.distance * 0.6 * release &&
      point.distanceTo(grid) < step * 0.5 * release
    if (!latch.grid || !near(latch.grid, 1.6)) latch.grid = near(nearest, 1) ? nearest : undefined
    if (latch.grid) {
      const snapped = p.localFromWorld(latch.grid)
      position.add(snapped.sub(local))
      const screen = p.toScreen(snapped)
      guides.x = screen.x
      guides.y = screen.y
      guides.grid = true
    }
  }
  const result: Transform = {
    position: clampTransform('position', vec3(position)),
    scale: clampTransform('scale', layer.scale.map((n) => n * scale) as Vec3),
    rotation: rotate
      ? clampTransform('rotation', angles(rotation.multiply(quat(layer.rotation))))
      : layer.rotation,
  }
  return { result, guides }
}

export function moveView(base: Camera, input: Contacts, next: Contacts, rect: Rect) {
  const eye = new Vector3(...base.position),
    target = new Vector3(...base.target),
    offset = eye.sub(target)
  const delta = next.center.clone().sub(input.center)
  const distance = Math.max(0.01, offset.length())
  const unit =
    (base.projection === 'orthographic' ? base.orthoSize : 2 * distance * Math.tan(radians(base.fov / 2))) /
    base.zoom /
    Math.max(1, rect.bottom - rect.top)
  if (input.distance) {
    const z = offset.clone().normalize(),
      x = new Vector3(0, 1, 0).cross(z).normalize(),
      y = z.clone().cross(x)
    const roll = radians(base.roll)
    const right = x.clone().multiplyScalar(Math.cos(roll)).addScaledVector(y, Math.sin(roll))
    const up = y.multiplyScalar(Math.cos(roll)).addScaledVector(x, -Math.sin(roll))
    target.addScaledVector(right, -delta.x * unit).addScaledVector(up, delta.y * unit)
  } else {
    const theta = Math.atan2(offset.x, offset.z) - delta.x * 0.007
    const phi = MathUtils.clamp(
      Math.acos(MathUtils.clamp(offset.y / distance, -1, 1)) - delta.y * 0.007,
      0.025,
      Math.PI - 0.025,
    )
    offset.set(
      distance * Math.sin(phi) * Math.sin(theta),
      distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.cos(theta),
    )
  }
  return {
    ...base,
    target: vec3(target),
    position: vec3(offset.add(target)),
    roll:
      base.roll +
      (input.distance
        ? degrees(MathUtils.euclideanModulo(next.angle - input.angle + Math.PI, 2 * Math.PI) - Math.PI)
        : 0),
    zoom: input.distance
      ? MathUtils.clamp((base.zoom * next.distance) / input.distance, 0.05, 25)
      : base.zoom,
  }
}
