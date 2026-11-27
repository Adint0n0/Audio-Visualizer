import { validateExport, type ExportOptions } from './output/timing'
import { defaultAnalysis, validateAnalysis, type AnalysisSettings } from './analysis'
// Coordinates use scene units. Rotations, arcs, and hue offsets use degrees.
export type Vec3 = [number, number, number]
export type LayerKind = 'visualizer' | 'text' | 'image' | 'group'
export const STYLES = [
  'spectrum',
  'waveform',
  'lissajous',
  'led',
  'spectrogram',
  'waterfall',
  'terrain',
  'orb',
  'tunnel',
  'particles',
  'polygon',
  'prism',
] as const
export const LAYOUTS = [
  'line',
  'symmetric',
  'circle',
  'ellipse',
  'arc',
  'rings',
  'spiral',
  'grid',
  'sphere',
  'path',
] as const
export const SHAPES = [
  'bar',
  'rounded',
  'dot',
  'line',
  'ribbon',
  'triangle',
  'cube',
  'sphere',
  'mesh',
] as const
export type Style = (typeof STYLES)[number]
export type Layout = (typeof LAYOUTS)[number]
export type Shape = (typeof SHAPES)[number]
export type Channel = 'mono' | 'left' | 'right' | 'mid' | 'side'
export type VisualSettings = {
  count: number
  width: number
  spacing: number
  minHeight: number
  maxHeight: number
  baseline: number
  radius: number
  startAngle: number
  arc: number
  depth: number
  rows: number
  columns: number
  history: number
  lifetime: number
  speed: number
  gravity: number
  spread: number
  reverse: boolean
  mirror: boolean
  inward: boolean
  corner: number
  lineWidth: number
  gain: number
  path: string
  closed: boolean
  tangent: boolean
}
export type Material = {
  color: string
  stops: { at: number; color: string }[]
  colorMode: 'solid' | 'frequency' | 'height' | 'position' | 'cycle'
  shading: 'unlit' | 'standard' | 'glass'
  blend: 'normal' | 'add' | 'multiply'
  wireframe: boolean
  roughness: number
  metalness: number
  emission: number
  shadow: boolean
  textureId: string | null
}
export type Caption = {
  content: string
  font: string
  fontId: string | null
  size: number
  tracking: number
  leading: number
  align: 'left' | 'center' | 'right'
  stroke: string
  strokeWidth: number
  shadow: number
}
export const MOD_TARGETS = [
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'opacity',
  'effects.bloom',
  'effects.trail',
  'settings.gain',
  'settings.radius',
  'settings.width',
  'settings.depth',
  'settings.maxHeight',
  'settings.minHeight',
  'settings.spacing',
  'settings.baseline',
  'settings.startAngle',
  'settings.arc',
  'settings.gravity',
  'settings.lineWidth',
  'settings.lifetime',
  'settings.speed',
  'settings.spread',
  'material.hue',
  'material.emission',
  'material.roughness',
  'material.metalness',
] as const
export const SCENE_TARGETS = [
  'camera.zoom',
  'camera.fov',
  'camera.roll',
  'camera.orbit',
  'camera.position.x',
  'camera.position.y',
  'camera.position.z',
  'camera.target.x',
  'camera.target.y',
  'camera.target.z',
  'camera.orthoSize',
  'background.brightness',
  'background.contrast',
  'background.saturation',
  'background.blur',
  'background.x',
  'background.y',
  'background.rotation',
  'background.zoom',
  'background.hue',
  'effects.bloom',
  'effects.trail',
  'lights.ambient.hue',
  'lights.directional.hue',
  'lights.point.hue',
  'lights.spot.hue',
  'lights.ambient',
  'lights.directional',
  'lights.point',
  'lights.spot',
] as const
export type Target = (typeof MOD_TARGETS)[number] | (typeof SCENE_TARGETS)[number]
export type Modulation = {
  enabled: boolean
  target: Target
  channel: Channel
  source: 'rms' | 'peak' | 'onset' | 'band'
  lowHz: number
  highHz: number
  curve: number
  sensitivity: number
  offset: number
  min: number
  max: number
  attack: number
  release: number
  invert: boolean
  mode: 'add' | 'multiply' | 'replace'
}
export type Motion = {
  enabled: boolean
  target: Target
  wave: 'sine' | 'triangle' | 'saw' | 'spin' | 'noise' | 'orbit'
  period: number
  amplitude: number
  phase: number
}
export type Layer = {
  id: string
  name: string
  kind: LayerKind
  style: Style
  layout: Layout
  shape: Shape
  position: Vec3
  rotation: Vec3
  scale: Vec3
  pivot: Vec3
  lockAspect: boolean
  visible: boolean
  locked: boolean
  screenSpace: boolean
  depthTest: boolean
  parentId: string | null
  opacity: number
  settings: VisualSettings
  material: Material
  text: Caption
  imageId: string | null
  effects: { bloom: number; trail: number }
  modulations: Modulation[]
  motions: Motion[]
}
export type Camera = {
  projection: 'perspective' | 'orthographic'
  position: Vec3
  target: Vec3
  fov: number
  orthoSize: number
  near: number
  far: number
  roll: number
  orbit: number
  zoom: number
}
export type Lamp = { color: string; intensity: number; position: Vec3; shadow: boolean }
export type Lights = Record<'ambient' | 'directional' | 'point' | 'spot', Lamp>
export type Background = {
  color: string
  imageId: string | null
  fit: 'contain' | 'cover' | 'stretch'
  zoom: number
  x: number
  y: number
  rotation: number
  brightness: number
  contrast: number
  saturation: number
  blur: number
  hue: number
}
export type OutputSettings = Omit<ExportOptions, 'start' | 'end'>
export type TimelineRange = [number, number] | null
export const defaultOutput: OutputSettings = {
  container: 'mp4',
  videoCodec: 'avc',
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrate: 16000000,
  audioBitrate: 256000,
  audioPolicy: 'original',
}
export function resolveRange(range: TimelineRange, duration: number): [number, number] {
  if (!Number.isFinite(duration) || duration <= 0) return [0, 0]
  if (!range || range[0] >= duration) return [0, duration]
  return [range[0], Math.min(range[1], duration)]
}
export type Project = {
  version: 2
  output: OutputSettings
  range: TimelineRange
  analysis: AnalysisSettings
  name: string
  seed: number
  mediaId: string | null
  layers: Layer[]
  camera: Camera
  lights: Lights
  background: Background
  effects: { bloom: number; trail: number }
  modulations: Modulation[]
  motions: Motion[]
}

export const defaultModulation = (target: Target = 'scale.y'): Modulation => ({
  enabled: true,
  target,
  channel: 'mono',
  source: 'rms',
  lowHz: 40,
  highHz: 240,
  curve: 1,
  sensitivity: 1,
  offset: 0,
  min: 0,
  max: 1,
  attack: 0,
  release: 0,
  invert: false,
  mode: 'add',
})
export const defaultMotion = (target: Target = 'rotation.z'): Motion => ({
  enabled: true,
  target,
  wave: 'sine',
  period: 8,
  amplitude: 12,
  phase: 0,
})
export function createLayer(kind: LayerKind = 'visualizer', style: Style = 'spectrum'): Layer {
  return {
    id: crypto.randomUUID(),
    name: kind === 'visualizer' ? style : kind,
    kind,
    style,
    layout: 'line',
    shape: 'bar',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    pivot: [0, 0, 0],
    lockAspect: false,
    visible: true,
    locked: false,
    screenSpace: false,
    depthTest: true,
    parentId: null,
    opacity: 1,
    settings: {
      count: 64,
      width: 0.1,
      spacing: 0.02,
      minHeight: 0.035,
      maxHeight: 2,
      baseline: 0,
      radius: 2,
      startAngle: 0,
      arc: 360,
      depth: 0.18,
      rows: 12,
      columns: 16,
      history: 20,
      lifetime: 3,
      speed: 1,
      gravity: 0,
      spread: 1,
      reverse: false,
      mirror: false,
      inward: false,
      corner: 0.2,
      lineWidth: 2,
      gain: 1,
      path: 'M 0 50 Q 50 0 100 50',
      closed: false,
      tangent: true,
    },
    material: {
      color: kind === 'image' ? '#ffffff' : '#80efe4',
      stops: [
        { at: 0, color: '#3cb3fe' },
        { at: 1, color: '#91ffcc' },
      ],
      colorMode: 'solid',
      shading: kind === 'image' || kind === 'text' ? 'unlit' : 'standard',
      blend: 'normal',
      wireframe: false,
      roughness: 0.45,
      metalness: 0.12,
      emission: 0.22,
      shadow: false,
      textureId: null,
    },
    text: {
      content: 'Audio Visualizer',
      font: 'sans-serif',
      fontId: null,
      size: 1,
      tracking: 0,
      leading: 1.25,
      align: 'center',
      stroke: '#000000',
      strokeWidth: 0,
      shadow: 0,
    },
    imageId: null,
    effects: { bloom: 0, trail: 0 },
    modulations: [],
    motions: [],
  }
}
export function createProject(name = 'Untitled'): Project {
  const lamp = (intensity: number, position: Vec3, color = '#ffffff'): Lamp => ({
    color,
    intensity,
    position,
    shadow: false,
  })
  return {
    version: 2,
    output: { ...defaultOutput },
    range: null,
    analysis: { ...defaultAnalysis },
    name,
    seed: 1907,
    mediaId: null,
    layers: [createLayer()],
    camera: {
      projection: 'perspective',
      position: [0, 0, 9],
      target: [0, 0, 0],
      fov: 45,
      orthoSize: 7,
      near: 0.1,
      far: 250,
      roll: 0,
      orbit: 0,
      zoom: 1,
    },
    lights: {
      ambient: lamp(1.4, [0, 0, 0]),
      directional: lamp(3, [4, 7, 6]),
      point: lamp(0, [-3, 2, 2], '#80ddff'),
      spot: lamp(0, [2, 5, 3]),
    },
    background: {
      color: '#000000',
      imageId: null,
      fit: 'contain',
      zoom: 1,
      x: 0,
      y: 0,
      rotation: 0,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      blur: 0,
      hue: 0,
    },
    effects: { bloom: 0, trail: 0 },
    modulations: [],
    motions: [],
  }
}

type Bounds = readonly [number, number]
const bounds: Record<string, Bounds> = {
  count: [2, 1024],
  width: [0.001, 10],
  spacing: [0, 5],
  minHeight: [0, 30],
  maxHeight: [0, 30],
  baseline: [-50, 50],
  radius: [0.01, 50],
  startAngle: [-3600, 3600],
  arc: [0.01, 360],
  depth: [0.001, 30],
  rows: [2, 128],
  columns: [2, 128],
  history: [1, 128],
  lifetime: [0.05, 60],
  speed: [-100, 100],
  gravity: [-100, 100],
  spread: [0, 50],
  corner: [0, 1],
  lineWidth: [0.1, 32],
  gain: [0, 32],
  opacity: [0, 1],
  at: [0, 1],
  roughness: [0, 1],
  metalness: [0, 1],
  emission: [0, 10],
  size: [0.02, 20],
  tracking: [-0.5, 1],
  leading: [0.2, 5],
  strokeWidth: [0, 20],
  shadow: [0, 64],
  fov: [5, 150],
  orthoSize: [0.01, 150],
  near: [0.001, 100],
  far: [1, 10000],
  roll: [-3600, 3600],
  orbit: [-3600, 3600],
  zoom: [0.01, 25],
  intensity: [0, 100],
  x: [-100, 100],
  y: [-100, 100],
  rotation: [-36000, 36000],
  brightness: [0, 5],
  contrast: [0, 5],
  saturation: [0, 5],
  blur: [0, 64],
  hue: [-3600, 3600],
  bloom: [0, 3],
  trail: [0, 1],
  curve: [0.01, 16],
  sensitivity: [-1000, 1000],
  offset: [-10000, 10000],
  min: [-10000, 10000],
  max: [-10000, 10000],
  attack: [0, 10000],
  release: [0, 10000],
  lowHz: [0, 192000],
  highHz: [0, 192000],
  period: [0.01, 3600],
  amplitude: [-10000, 10000],
  phase: [-3600, 3600],
  seed: [0, 4294967295],
}
export function numericBounds(path: string): Bounds {
  const key = path.split('.').pop()!
  const vector = path.match(/(?:^|\.)(position|target|rotation|scale|pivot)\.[xyz]$/)?.[1]
  if (vector)
    return vector === 'scale' ? [0.001, 1000] : vector === 'rotation' ? bounds.rotation : [-1000, 1000]
  return bounds[key] ?? [-1000, 1000]
}
const enums: Record<string, readonly string[]> = {
  kind: ['visualizer', 'text', 'image', 'group'],
  style: STYLES,
  layout: LAYOUTS,
  shape: SHAPES,
  colorMode: ['solid', 'frequency', 'height', 'position', 'cycle'],
  shading: ['unlit', 'standard', 'glass'],
  blend: ['normal', 'add', 'multiply'],
  align: ['left', 'center', 'right'],
  projection: ['perspective', 'orthographic'],
  fit: ['contain', 'cover', 'stretch'],
  channel: ['mono', 'left', 'right', 'mid', 'side'],
  source: ['rms', 'peak', 'onset', 'band'],
  mode: ['add', 'multiply', 'replace'],
  wave: ['sine', 'triangle', 'saw', 'spin', 'noise', 'orbit'],
  target: [...MOD_TARGETS, ...SCENE_TARGETS],
}
const integers = new Set(['count', 'rows', 'columns', 'history', 'seed'])
const invalid = (path: string): never => {
  throw new Error('Invalid project field: ' + path)
}
function record(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(path)
  return input as Record<string, unknown>
}
// Walk a closed schema. Imported objects never contribute property names or prototypes.
function checked(input: unknown, example: unknown, path: string): unknown {
  const key = path.split('.').pop()!
  if (example === null || key === 'id') {
    if (input === null && example === null) return null
    if (typeof input !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(input)) invalid(path)
    return input
  }
  if (typeof example === 'boolean') {
    if (typeof input !== 'boolean') invalid(path)
    return input
  }
  if (typeof example === 'number') {
    const [min, max] = numericBounds(path)
    if (
      typeof input !== 'number' ||
      !Number.isFinite(input) ||
      input < min ||
      input > max ||
      (integers.has(key) && !Number.isInteger(input))
    )
      invalid(path)
    return input
  }
  if (typeof example === 'string') {
    if (typeof input !== 'string') return invalid(path)
    if (input.length > (key === 'path' ? 32768 : key === 'content' ? 4096 : 180)) invalid(path)
    if (enums[key] && !enums[key].includes(input)) invalid(path)
    if ((key === 'color' || key === 'stroke') && !/^#[0-9a-fA-F]{6}$/.test(input)) invalid(path)
    return input
  }
  if (Array.isArray(example)) {
    if (!Array.isArray(input)) return invalid(path)
    if (key === 'stops') {
      if (!input.length || input.length > 128) invalid(path)
      const stops = input.map((v, i) => checked(v, example[0], path + '.' + i)) as Material['stops']
      if (stops.some((v, i) => i > 0 && v.at < stops[i - 1].at)) invalid(path)
      return stops
    }
    if (key === 'motions' || key === 'modulations') {
      if (input.length > 32) invalid(path)
      return input.map((v, i) => {
        const entry = checked(
          v,
          key === 'motions' ? defaultMotion() : defaultModulation(),
          path + '.' + i,
        ) as Modulation | Motion
        if (
          !(
            path.startsWith('layer.')
              ? (MOD_TARGETS as readonly Target[])
              : (SCENE_TARGETS as readonly Target[])
          ).includes(entry.target)
        )
          invalid(path)
        if ('source' in entry && (entry.max < entry.min || entry.highHz < entry.lowHz)) invalid(path)
        return entry
      })
    }
    if (input.length !== 3) invalid(path)
    const [min, max] =
      key === 'scale' ? [0.001, 1000] : key === 'rotation' ? bounds.rotation : [-1000, 1000]
    return input.map((v) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) invalid(path)
      return v
    })
  }
  const obj = record(input, path)
  return Object.fromEntries(
    Object.entries(example as Record<string, unknown>).map(([k, v]) => [
      k,
      checked(obj[k], v, path + '.' + k),
    ]),
  )
}

export function parseLayer(input: unknown): Layer {
  const obj = record(input, 'layer')
  const defaults = createLayer()
  const migrated = obj.effects === undefined ? { ...obj, effects: defaults.effects } : obj
  const layer = checked(migrated, defaults, 'layer') as Layer
  if (layer.settings.minHeight > layer.settings.maxHeight) invalid('settings.minHeight')
  return layer
}
export function parseOutputSettings(input: unknown): OutputSettings {
  const source = record(input, 'output')
  const result = Object.fromEntries(
    [
      'container',
      'videoCodec',
      'width',
      'height',
      'fps',
      'videoBitrate',
      'audioBitrate',
      'audioPolicy',
      'quantizer',
    ]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  ) as OutputSettings
  if (
    result.audioPolicy !== undefined &&
    result.audioPolicy !== 'original' &&
    result.audioPolicy !== 'compatible'
  )
    invalid('output.audioPolicy')
  validateExport({ ...result, start: 0, end: 1 })
  return result
}

function parseRange(input: unknown): TimelineRange {
  if (input === null) return null
  if (!Array.isArray(input) || input.length !== 2) return invalid('range')
  const [a, b] = input
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a < 0 ||
    a >= b ||
    b > 1800
  )
    return invalid('range')
  return [a, b]
}

export function parseProject(input: unknown): Project {
  const obj = record(input, 'project')
  if (obj.version !== 1 && obj.version !== 2) invalid('version')
  if (!Array.isArray(obj.layers) || obj.layers.length > 128) return invalid('layers')
  const layers = obj.layers.map(parseLayer)
  const map = new Map(layers.map((v) => [v.id, v]))
  if (map.size !== layers.length) invalid('layers.id')
  for (const layer of layers) {
    let parent = layer.parentId
    const visited = new Set([layer.id])
    while (parent) {
      const p = map.get(parent)
      if (!p || p.kind !== 'group' || visited.has(parent)) return invalid('parentId')
      visited.add(parent)
      parent = p.parentId
    }
  }
  const {
    layers: _layers,
    analysis: _analysis,
    output: _output,
    range: _range,
    version: _version,
    ...base
  } = createProject()
  const output = parseOutputSettings(
    obj.version === 1 && obj.output === undefined ? defaultOutput : obj.output,
  )
  const range = parseRange(obj.version === 1 && obj.range === undefined ? null : obj.range)
  const analysis = validateAnalysis(record(obj.analysis, 'analysis'))
  const project = {
    ...(checked(obj, base, 'project') as typeof base),
    version: 2 as const,
    output,
    range,
    layers,
    analysis,
  }
  if (project.camera.far <= project.camera.near) invalid('camera.far')
  return project
}

export class ProjectHistory {
  private past: Project[] = []
  private future: Project[] = []
  constructor(
    public current: Project,
    private limit = 80,
  ) {}
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  commit(
    next: Project,
    onDiscard?: (discarded: readonly Project[], retained: readonly Project[]) => void,
  ) {
    if (this.current === next) return this.current
    this.past.push(this.current)
    const discarded = this.future
    if (this.past.length > this.limit) discarded.push(this.past.shift()!)
    this.future = []
    this.current = next
    if (discarded.length) onDiscard?.(discarded, [...this.past, next])
    return next
  }
  undo() {
    const previous = this.past.pop()
    if (previous) {
      this.future.push(this.current)
      this.current = previous
    }
    return this.current
  }
  redo() {
    const next = this.future.pop()
    if (next) {
      this.past.push(this.current)
      this.current = next
    }
    return this.current
  }
}
function family(layers: Layer[], ids: readonly string[]): Set<string> {
  const selected = new Set(layers.filter((l) => ids.includes(l.id) && !l.locked).map((l) => l.id))
  let size: number
  do {
    size = selected.size
    for (const l of layers) if (l.parentId && selected.has(l.parentId)) selected.add(l.id)
  } while (size !== selected.size)
  return selected
}
export function duplicateLayers(p: Project, ids: readonly string[]): Project {
  const selected = family(p.layers, ids)
  if (!selected.size || p.layers.length + selected.size > 128) return p
  const remap = new Map(Array.from(selected, (id) => [id, crypto.randomUUID()]))
  const copies = p.layers
    .filter((l) => selected.has(l.id))
    .map((l) => ({
      ...structuredClone(l),
      id: remap.get(l.id)!,
      name: l.name.slice(0, 170) + ' copy',
      parentId: l.parentId ? (remap.get(l.parentId) ?? l.parentId) : null,
    }))
  return { ...p, layers: [...p.layers, ...copies] }
}
export function removeLayers(p: Project, ids: readonly string[]): Project {
  const selected = family(p.layers, ids)
  if (!selected.size || p.layers.some((l) => l.locked && selected.has(l.id))) return p
  return { ...p, layers: p.layers.filter((l) => !selected.has(l.id)) }
}
export function groupLayers(p: Project, ids: readonly string[]): Project {
  const selected = p.layers.filter((l) => ids.includes(l.id) && !l.locked)
  if (
    !selected.length ||
    p.layers.length >= 128 ||
    selected.some(
      (l) => l.parentId !== selected[0].parentId || l.screenSpace !== selected[0].screenSpace,
    )
  )
    return p
  const group = createLayer('group')
  group.parentId = selected[0].parentId
  group.screenSpace = selected[0].screenSpace
  return {
    ...p,
    layers: [...p.layers.map((l) => (selected.includes(l) ? { ...l, parentId: group.id } : l)), group],
  }
}
export function moveLayers(p: Project, ids: readonly string[], delta: -1 | 1): Project {
  const layers = [...p.layers]
  const indexes = layers.map((_, i) => i)
  if (delta > 0) indexes.reverse()
  for (const i of indexes) {
    const a = layers[i],
      b = layers[i + delta]
    if (b && ids.includes(a.id) && !a.locked && !b.locked && !ids.includes(b.id))
      [layers[i], layers[i + delta]] = [b, a]
  }
  return { ...p, layers }
}
function layoutSelection(p: Project, ids: readonly string[], axis: 0 | 1 | 2, space: boolean): Project {
  const selected = p.layers
    .filter((l) => ids.includes(l.id) && !l.locked)
    .sort((a, b) => a.position[axis] - b.position[axis])
  if (
    selected.length < (space ? 3 : 2) ||
    selected.some(
      (l) => l.parentId !== selected[0].parentId || l.screenSpace !== selected[0].screenSpace,
    )
  )
    return p
  const lo = selected[0].position[axis],
    hi = selected[selected.length - 1].position[axis]
  return {
    ...p,
    layers: p.layers.map((l) => {
      const i = selected.indexOf(l)
      if (i < 0) return l
      const position = [...l.position] as Vec3
      position[axis] = space ? lo + ((hi - lo) * i) / (selected.length - 1) : (lo + hi) / 2
      return { ...l, position }
    }),
  }
}
export const alignLayers = (p: Project, ids: readonly string[], axis: 0 | 1 | 2) =>
  layoutSelection(p, ids, axis, false)
export const distributeLayers = (p: Project, ids: readonly string[], axis: 0 | 1 | 2) =>
  layoutSelection(p, ids, axis, true)

export type SignalFrame = {
  bins?: ArrayLike<number>
  bands?: ArrayLike<number>
  rms: number
  peak?: number
  onset?: number
  resolveMod?: (m: Modulation) => number
}
function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value))
}
function sampleMotion(m: Motion, t: number, seed: number) {
  const cycle = t / m.period + m.phase / 360,
    frac = cycle - Math.floor(cycle)
  switch (m.wave) {
    case 'spin':
      return cycle * m.amplitude
    case 'triangle':
      return (1 - 4 * Math.abs(frac - 0.5)) * m.amplitude
    case 'saw':
      return (frac * 2 - 1) * m.amplitude
    case 'noise': {
      const hash = (n: number) => {
        let x = Math.imul(Math.floor(n) ^ seed, 0x45d9f3b)
        x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
        return ((x ^ (x >>> 16)) >>> 0) / 2147483648 - 1
      }
      const smooth = frac * frac * (3 - 2 * frac)
      return (hash(cycle) * (1 - smooth) + hash(cycle + 1) * smooth) * m.amplitude
    }
    default:
      return Math.sin(cycle * 2 * Math.PI) * m.amplitude
  }
}
function signal(m: Modulation, a: SignalFrame) {
  let value = a.resolveMod?.(m)
  if (value === undefined) {
    if (m.source === 'band') {
      // Fallback for synthetic preview signals; real analysis supplies a Hz-band resolver.
      const bins = a.bins ?? a.bands ?? []
      const first = clamp(Math.floor((m.lowHz / 24000) * bins.length), 0, bins.length)
      const end = clamp(Math.ceil((m.highHz / 24000) * bins.length), first, bins.length)
      value = 0
      for (let i = first; i < end; i++) value += bins[i]
      value /= Math.max(1, end - first)
    } else value = a[m.source] ?? 0
  }
  const unit = clamp(Number.isFinite(value) ? value : 0, 0, 1)
  return clamp(Math.pow(m.invert ? 1 - unit : unit, m.curve) * m.sensitivity + m.offset, m.min, m.max)
}
function readTarget(obj: Layer | Project, target: Target): number {
  const [head, key, axis] = target.split('.')
  const field = (obj as unknown as Record<string, unknown>)[head]
  if (head === 'lights')
    return axis === 'hue' ? 0 : (obj as Project).lights[key as keyof Lights].intensity
  if (target === 'material.hue') return 0
  if (!key) return field as number
  if (axis) return (field as Record<string, Vec3>)[key]['xyz'.indexOf(axis)]
  if (Array.isArray(field)) return field['xyz'.indexOf(key)]
  return (field as Record<string, number>)[key]
}
function shiftHue(hex: string, degrees: number) {
  // Rotate around the gray axis in RGB space. Preserve neutral colors and clip to sRGB.
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const cos = Math.cos((degrees * Math.PI) / 180),
    sin = Math.sin((degrees * Math.PI) / 180) / Math.sqrt(3)
  const sum = ((1 - cos) * (rgb[0] + rgb[1] + rgb[2])) / 3
  return (
    '#' +
    rgb
      .map((n, i) =>
        Math.round(clamp(n * cos + sum + sin * (rgb[(i + 2) % 3] - rgb[(i + 1) % 3]), 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}
function writeTarget(obj: Layer | Project, target: Target, value: number) {
  const [head, key, axis] = target.split('.')
  const field = obj as unknown as Record<string, unknown>
  if (target === 'material.hue') {
    const material = (obj as Layer).material
    material.color = shiftHue(material.color, value)
    material.stops = material.stops.map((s) => ({ ...s, color: shiftHue(s.color, value) }))
  } else if (head === 'lights') {
    const lamp = (obj as Project).lights[key as keyof Lights]
    if (axis === 'hue') lamp.color = shiftHue(lamp.color, value)
    else lamp.intensity = clamp(value, 0, 100)
  } else {
    const [lo, hi] = numericBounds(target)
    const angle =
      head === 'rotation' ||
      target === 'camera.orbit' ||
      target === 'camera.roll' ||
      target === 'background.rotation'
    const resolved = angle ? value % 360 : clamp(value, lo, hi)
    if (!key) field[head] = resolved
    else if (axis) (field[head] as Record<string, Vec3>)[key]['xyz'.indexOf(axis)] = resolved
    else if (Array.isArray(field[head])) (field[head] as Vec3)['xyz'.indexOf(key)] = resolved
    else (field[head] as Record<string, number>)[key] = resolved
  }
}
function applyDrivers(obj: Layer | Project, t: number, a: SignalFrame, seed: number) {
  const values = new Map<Target, number>()
  const get = (k: Target) => values.get(k) ?? readTarget(obj, k)
  obj.motions.forEach((m, i) => {
    if (!m.enabled) return
    values.set(m.target, get(m.target) + sampleMotion(m, t, seed + i))
    if (m.wave === 'orbit' && m.target.endsWith('.x')) {
      const second = (m.target.slice(0, -1) + 'y') as Target
      values.set(second, get(second) + sampleMotion({ ...m, phase: m.phase + 90 }, t, seed + i))
    }
  })
  for (const m of obj.modulations) {
    if (!m.enabled) continue
    const v = signal(m, a)
    values.set(
      m.target,
      m.mode === 'replace' ? v : m.mode === 'multiply' ? get(m.target) * v : get(m.target) + v,
    )
  }
  for (const [target, value] of values) writeTarget(obj, target, value)
}
export function evaluateLayer(layer: Layer, t: number, a: SignalFrame, seed = 0): Layer {
  if (!layer.modulations.length && !layer.motions.length) return layer
  const out = structuredClone(layer)
  applyDrivers(out, t, a, seed)
  return out
}
export function evaluateScene(p: Project, t: number, a: SignalFrame): Project {
  if (!p.modulations.length && !p.motions.length) return p
  const { layers, ...scene } = p
  const out = { ...structuredClone(scene), layers }
  applyDrivers(out, t, a, p.seed)
  return out
}
