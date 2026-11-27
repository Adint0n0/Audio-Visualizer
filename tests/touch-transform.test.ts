import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createLayer, createProject } from '../src/model'
import {
  contacts,
  initialSnap,
  moveView,
  snapValue,
  transformLayer,
  type Projection,
} from '../src/studio/transform'

const canvas = { left: 0, right: 400, top: 0, bottom: 240 }
const xy = (x: number, y: number) => ({ x, y })
const projection: Projection = {
  center: xy(200, 120),
  world: new Vector3(),
  camera: new Quaternion(),
  parent: new Quaternion(),
  origin: canvas,
  bounds: { left: 188, right: 212, top: 108, bottom: 132 },
  neighbors: [],
  toLocal: (p) => new Vector3((p.x - 200) / 40, (120 - p.y) / 40, 0),
  toScreen: (v) => xy(200 + 40 * v.x, 120 - 40 * v.y),
  worldFromLocal: (v) => v.clone(),
  localFromWorld: (v) => v.clone(),
  fixed: false,
}
describe('direct manipulation', () => {
  it('keeps the grabbed midpoint while translating, twisting and doubling scale', () => {
    const before = contacts([xy(140, 120), xy(180, 120)])
    const after = contacts([xy(220, 80), xy(220, 160)])
    const layer = createLayer()
    const { result } = transformLayer(
      { input: before, layer, projection },
      after,
      'object',
      { ...initialSnap, enabled: false },
      {},
    )
    expect(result.scale).toEqual([2, 2, 2])
    expect(result.rotation[2]).toBeCloseTo(-90)
    expect(result.position[0]).toBeCloseTo(0.5)
    expect(result.position[1]).toBeCloseTo(-2)
  })
  it('holds an acquired guide beyond its threshold, then releases it', () => {
    expect(snapValue(12, [15], 4)).toBe(15)
    expect(snapValue(21, [15], 4, 15)).toBe(15)
    expect(snapValue(22, [15], 4, 15)).toBeUndefined()
    expect(snapValue(21, [15], 4)).toBeUndefined()
  })
  it('rotates in camera coordinates without changing depth', () => {
    const input = contacts([xy(200, 120)])
    const next = contacts([xy(222, 150)])
    const layer = createLayer()
    const { result } = transformLayer(
      {
        input,
        projection: { ...projection, camera: new Quaternion().setFromEuler(new Euler(0.35, 0.1, 0.3)) },
        layer,
      },
      next,
      'orbit',
      { ...initialSnap, enabled: false },
      {},
    )
    expect(result.position).toEqual(layer.position)
    expect(result.scale).toEqual(layer.scale)
    expect(result.rotation.every((axis) => Math.abs(axis) > 1)).toBe(true)
  })
  it('isolates the view change from the saved camera', () => {
    const initial = createProject().camera
    const saved = structuredClone(initial)
    const before = contacts([xy(100, 100), xy(140, 100)])
    const after = contacts([xy(140, 80), xy(140, 160)])
    const view = moveView(initial, before, after, canvas)
    expect(view.zoom).toBe(initial.zoom * 2)
    expect(view.roll).toBeCloseTo(90)
    expect(view.target).not.toEqual(saved.target)
    expect(initial).toEqual(saved)
  })
})
