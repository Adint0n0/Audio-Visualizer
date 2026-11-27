import { retiredAssetIds } from '../src/storage'
import { describe, expect, it } from 'vitest'
import {
  alignLayers,
  createLayer,
  createProject,
  defaultOutput,
  resolveRange,
  defaultModulation,
  defaultMotion,
  distributeLayers,
  duplicateLayers,
  evaluateLayer,
  evaluateScene,
  groupLayers,
  moveLayers,
  parseProject,
  parseLayer,
  ProjectHistory,
  removeLayers,
} from '../src/model'
import { categories, colorways, families, featuredIds, templates } from '../src/templates'
import { loadProject, saveProject, loadPreset, savePreset } from '../src/storage'

const frame = { rms: 0.25, bands: new Float32Array([0.1, 0.5]) }
describe('scene persistence and validation', () => {
  it('has five editable presets in every category, with full JSON round trips', () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(60)
    for (const category of Object.keys(categories))
      expect(templates.filter((t) => t.category === category)).toHaveLength(5)
    const structures = new Set<string>()
    for (const t of templates) {
      const scene = t.create()
      expect(parseProject(JSON.parse(JSON.stringify(scene)))).toEqual(scene)
      structures.add(
        JSON.stringify(
          scene.layers.map((l) => [
            l.style,
            l.shape,
            l.layout,
            l.position,
            l.rotation,
            l.scale,
            l.settings,
          ]),
        ),
      )
      expect(t.name.en).toBeTruthy()
      expect(t.name.ja).toBeTruthy()
    }
    expect(structures.size).toBe(60)
  })
  it('groups each stable scene in one family, with independent, schema-valid colorways', () => {
    const stableIds = templates.map((t) => t.id).sort()
    expect(
      Object.values(families)
        .flatMap((f) => [...f.ids])
        .sort(),
    ).toEqual(stableIds)
    expect(new Set(featuredIds).size).toBe(featuredIds.length)
    expect(featuredIds.every((id) => stableIds.includes(id))).toBe(true)
    expect(templates[0].id).toBe('binary-stars')
    const geometry = (p: ReturnType<typeof createProject>) =>
      p.layers.map((l) => [
        l.style,
        l.layout,
        l.shape,
        l.settings,
        l.position,
        l.rotation,
        l.scale,
        l.effects,
        l.modulations,
        l.motions,
      ])
    for (const t of templates) {
      expect(t.description.en.length).toBeGreaterThan(20)
      expect(t.description.ja.length).toBeGreaterThan(10)
      expect(families[t.family].ids).toContain(t.id)
      expect(t.colorways).toEqual(Object.keys(colorways))
      const original = t.create()
      expect(t.palette).toEqual(original.layers[0].material.stops.map((stop) => stop.color))
      const recipes = new Set<string>()
      for (const key of t.colorways) {
        const scene = t.create(key)
        expect(parseProject(JSON.parse(JSON.stringify(scene)))).toEqual(scene)
        expect(scene.layers[0].id).not.toBe(original.layers[0].id)
        expect(geometry(scene)).toEqual(geometry(original))
        recipes.add(JSON.stringify(scene.layers.map((l) => l.material.stops)))
      }
      expect(recipes.size).toBe(t.colorways.length)
    }
  })
  it('migrates version 1 and validates persisted output preferences and ranges', () => {
    const { output: _oldOutput, range: _oldRange, ...other } = createProject()
    const migrated = parseProject({ ...other, version: 1 })
    expect(migrated.version).toBe(2)
    expect(migrated.output).toEqual(defaultOutput)
    expect(migrated.range).toBeNull()
    const output = {
      ...defaultOutput,
      container: 'webm' as const,
      videoCodec: 'vp9' as const,
      fps: 24000 / 1001,
      width: 1280,
      height: 720,
      quantizer: 15,
      audioPolicy: 'compatible' as const,
    }
    const saved = { ...migrated, range: [0.125, 5.5], output }
    expect(parseProject(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    expect(resolveRange([0.125, 5.5], 5)).toEqual([0.125, 5])
    expect(resolveRange([5, 6], 3)).toEqual([0, 3])
    for (const range of [[1, 1], [-1, 0.5], [0, 1801], [null, 1], undefined])
      expect(() => parseProject({ ...saved, range })).toThrow(/range/)
    for (const delta of [
      { container: 'wav' },
      { width: 4098 },
      { fps: 61 },
      { quantizer: 52 },
      { audioPolicy: 'mixdown' },
      { videoBitrate: Infinity },
    ]) {
      expect(() => parseProject({ ...saved, output: { ...output, ...delta } })).toThrow()
    }
  })
  it('migrates stand-alone object presets and validates selective effect strengths', () => {
    const { effects: _legacy, ...oldLayer } = createLayer()
    expect(parseLayer(oldLayer).effects).toEqual({ bloom: 0, trail: 0 })
    expect(() => parseLayer({ ...oldLayer, effects: { bloom: -1, trail: 0 } })).toThrow(/bloom/)
    expect(() => parseLayer({ ...oldLayer, effects: null })).toThrow(/effects/)
    const layer = parseLayer({ ...oldLayer, effects: { bloom: 0.4, trail: 0.3 } })
    layer.modulations = [{ ...defaultModulation('effects.trail'), mode: 'add' }]
    expect(evaluateLayer(layer, 0, frame).effects.trail).toBeCloseTo(0.55)
    expect(layer.effects.trail).toBe(0.3)
  })
  it('exports and reopens every authored template as a preset and as a complete project', async () => {
    for (const item of templates) {
      const scene = item.create()
      expect(await loadPreset(savePreset(scene))).toEqual(scene)
      const archived = await loadProject(await saveProject(scene, new Map()))
      expect(archived.project).toEqual(scene)
      expect(archived.assets.size).toBe(0)
    }
  })
  it('creates independent templates', () => {
    const t = templates.find((t) => t.id === 'twin-rail')!
    const current = t.create()
    current.layers[0].position[1] = 999
    current.layers[0].material.stops.length = 0
    const fresh = t.create()
    expect(fresh.layers[0].position[1]).not.toBe(999)
    expect(fresh.layers[0].material.stops.length).toBeGreaterThan(0)
  })
  it('rejects cyclic groups, duplicate IDs, unknown versions, oversized geometry and nonfinite values', () => {
    const p = createProject()
    const group = createLayer('group')
    expect(() => parseProject({ ...p, version: 3 })).toThrow(/version/)
    expect(() => parseProject({ ...p, layers: [group, group] })).toThrow(/layers.id/)
    expect(() => parseProject({ ...p, layers: [{ ...group, parentId: group.id }] })).toThrow(/parentId/)
    const layer = p.layers[0]
    for (const count of [Infinity, NaN, 100000, 3.5])
      expect(() =>
        parseProject({ ...p, layers: [{ ...layer, settings: { ...layer.settings, count } }] }),
      ).toThrow(/count/)
    expect(() => parseProject({ ...p, analysis: { fftSize: 44 } })).toThrow(/FFT/)
    expect(() => parseProject({ ...p, camera: { ...p.camera, near: 10, far: 2 } })).toThrow(/far/)
    const driver = defaultModulation('camera.zoom')
    expect(() => parseProject({ ...p, layers: [{ ...layer, modulations: [driver] }] })).toThrow(
      /modulations/,
    )
  })
})
describe('signal evaluation', () => {
  it('combines multiple enabled modulators in order without changing base values', () => {
    const l = createLayer()
    l.modulations = [
      { ...defaultModulation('settings.gain'), sensitivity: 2 },
      { ...defaultModulation('settings.gain'), mode: 'multiply' },
      { ...defaultModulation('settings.gain'), mode: 'replace', enabled: false },
    ]
    expect(evaluateLayer(l, 0, frame).settings.gain).toBe((1 + 0.5) * 0.25)
    expect(l.settings.gain).toBe(1)
    l.modulations.reverse()
    expect(evaluateLayer(l, 0, frame).settings.gain).toBe(0.75)
  })
  it('supports scene light color, camera target vectors and continuous rotation through long renders', () => {
    const p = createProject()
    p.lights.point.color = '#dd128a'
    p.modulations = [
      { ...defaultModulation('lights.point.hue'), mode: 'replace', min: 120, max: 120 },
      { ...defaultModulation('camera.target.y'), mode: 'replace', min: -800, max: -800 },
    ]
    const scene = evaluateScene(p, 2, frame)
    expect(scene.camera.target[1]).toBe(-800)
    expect(scene.lights.point.color).not.toEqual(p.lights.point.color)
    const layer = createLayer()
    layer.motions = [{ ...defaultMotion('rotation.z'), wave: 'spin', period: 0.5, amplitude: 350 }]
    expect(evaluateLayer(layer, 1700, frame).rotation[2]).toBe(((1700 / 0.5) * 350) % 360)
    expect(createLayer('image').material.shading).toBe('unlit')
    expect(createLayer('text').material.shading).toBe('unlit')
  })
  it('uses channel-aware smoothed resolver and preserves source signal', () => {
    const l = createLayer()
    l.modulations = [
      {
        ...defaultModulation('position.z'),
        source: 'band',
        channel: 'side',
        curve: 2,
        attack: 20,
        release: 80,
        mode: 'replace',
      },
    ]
    const result = evaluateLayer(l, 1, {
      ...frame,
      resolveMod: (m) => (m.channel === 'side' && m.attack === 20 ? 0.8 : 0),
    })
    expect(result.position[2]).toBeCloseTo(0.64)
    expect(l.position[2]).toBe(0)
  })
  it('restores the same noise, camera motion and orbit at arbitrary seek times', () => {
    const p = createProject()
    p.motions = [{ ...defaultMotion('camera.orbit'), wave: 'noise', amplitude: 90, period: 3 }]
    const val = evaluateScene(p, 20, frame)
    evaluateScene(p, 0.33, frame)
    expect(evaluateScene(p, 20, frame)).toEqual(val)
    expect(evaluateScene({ ...p, seed: p.seed + 1 }, 20, frame).camera.orbit).not.toBe(val.camera.orbit)
    expect(p.camera.orbit).toBe(0)
    const l = p.layers[0]
    l.motions = [{ ...defaultMotion('position.x'), wave: 'orbit', amplitude: 2, period: 4 }]
    expect(evaluateLayer(l, 1, frame).position[0]).toBeCloseTo(2)
    expect(evaluateLayer(l, 0, frame).position[1]).toBeCloseTo(2)
  })
})
describe('editing', () => {
  it('retires only files unique to discarded undo or redo snapshots', () => {
    const asset = (id: string) => ({ ...createProject(), mediaId: id.repeat(64) })
    const first = asset('a'),
      second = asset('b'),
      third = asset('c'),
      fourth = asset('d')
    first.background.imageId = 'e'.repeat(64)
    third.background.imageId = first.background.imageId
    const retired: string[] = []
    const prune = (lost: readonly (typeof first)[], kept: readonly (typeof first)[]) =>
      retired.push(...retiredAssetIds(lost, kept))
    const history = new ProjectHistory(first, 1)
    history.commit(second, prune)
    history.commit(third, prune)
    expect(retired).toEqual([first.mediaId])
    history.undo()
    history.commit(fourth, prune)
    expect(retired.sort()).toEqual([first.mediaId, third.mediaId, first.background.imageId].sort())
  })
  it('copies groups and remaps selected descendants once', () => {
    const p = createProject(),
      child = p.layers[0]
    const grouped = groupLayers(p, [child.id]),
      parent = grouped.layers[1]
    expect(grouped.layers[0].parentId).toBe(parent.id)
    const duplicate = duplicateLayers(grouped, [parent.id, child.id])
    expect(duplicate.layers).toHaveLength(4)
    expect(duplicate.layers[2].parentId).toBe(duplicate.layers[3].id)
    expect(parseProject(removeLayers(duplicate, [parent.id])).layers).toHaveLength(2)
    expect(p.layers[0].parentId).toBeNull()
  })
  it('respects locked layers and avoids comparing different parent coordinate systems', () => {
    const p = createProject()
    const [a] = p.layers,
      b = createLayer(),
      c = createLayer()
    a.position[0] = -3
    b.position[0] = 1
    c.position[0] = 3
    p.layers = [a, b, c]
    const ids = p.layers.map((l) => l.id)
    expect(distributeLayers(p, ids, 0).layers[1].position[0]).toBe(0)
    expect(alignLayers(p, ids, 0).layers.map((l) => l.position[0])).toEqual([0, 0, 0])
    b.locked = true
    expect(moveLayers(p, [a.id], 1).layers).toEqual(p.layers)
    expect(removeLayers(p, [b.id])).toBe(p)
    const grouped = groupLayers(p, [a.id])
    expect(alignLayers(grouped, [a.id, c.id], 1)).toBe(grouped)
  })
  it('undoes a completed edit, invalidates redo on a divergent edit and enforces capacity', () => {
    const p = createProject(),
      h = new ProjectHistory(p, 2)
    for (const name of ['A', 'B', 'C']) h.commit({ ...p, name })
    expect(h.undo().name).toBe('B')
    expect(h.undo().name).toBe('A')
    expect(h.canUndo).toBe(false)
    expect(h.redo().name).toBe('B')
    h.commit({ ...p, name: 'D' })
    expect(h.canRedo).toBe(false)
  })
})
