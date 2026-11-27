import {
  colorways,
  editorial,
  familyById,
  type Family,
  featuredIds,
  type Mood,
  type Dimensions,
  type Cost,
  type Colorway,
} from './catalog'
export {
  families,
  type Family,
  colorways,
  featuredIds,
  type Colorway,
  type Mood,
  type Dimensions,
  type Cost,
} from './catalog'
import {
  createLayer,
  createProject,
  defaultMotion,
  defaultModulation,
  type Layout,
  type Material,
  type Motion,
  type Modulation,
  type Project,
  type Shape,
  type Style,
  type Vec3,
  type VisualSettings,
} from './model'

export const categories = {
  minimal: { en: 'Minimal', ja: 'ミニマル' },
  bars: { en: 'Linear bars', ja: '直線バー' },
  radial: { en: 'Radial', ja: '円形' },
  waves: { en: 'Waveforms', ja: '波形' },
  retro: { en: 'LED / Retro', ja: 'LED・レトロ' },
  neon: { en: 'Neon', ja: 'ネオン' },
  cinema: { en: 'Cinematic', ja: 'シネマティック' },
  grid: { en: '3D grid', ja: '3D格子' },
  land: { en: 'Terrain / Waterfall', ja: '地形・滝' },
  orbit: { en: 'Spheres / Tunnels', ja: '球体・トンネル' },
  dust: { en: 'Particles', ja: '粒子' },
  abstract: { en: 'Geometry', ja: '抽象幾何学' },
}
export type Category = keyof typeof categories
export interface Template {
  id: string
  name: { en: string; ja: string }
  category: Category
  family: Family
  mood: Mood
  dimensions: Dimensions
  cost: Cost
  featured: boolean
  description: { en: string; ja: string }
  palette: readonly string[]
  colorways: readonly Colorway[]
  create: (colorway?: Colorway) => Project
}

const ice = ['#48e7d1', '#99d6ff', '#c0b5ff'],
  amber = ['#ed633b', '#ffae62', '#fff0bd'],
  rose = ['#7e69fd', '#e989c0', '#ffd1b2'],
  moss = ['#389b87', '#95d89f', '#eff9b2'],
  chalk = ['#848eac', '#e3e9f0']
type LayerEffects = Project['effects']
type LayerDesign = {
  name?: string
  style?: Style
  layout?: Layout
  shape?: Shape
  settings?: Partial<VisualSettings>
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  opacity?: number
  palette?: string[]
  material?: Partial<Material>
  motions?: Motion[]
  modulations?: Modulation[]
  effects?: LayerEffects
  pulse?: 'radius' | 'emission' | 'height'
}
type Stage = {
  eye?: Vec3
  aim?: Vec3
  ortho?: number
  bg?: string
  bloom?: number
  trail?: number
  orbit?: number
  zoom?: number
  ambient?: number
  key?: string
  rim?: string
}
const alternateColorways: Colorway[] = ['original', 'aurora', 'ember', 'ice']
function tintedPalette(source: string[], key: Colorway, layerIndex: number) {
  if (key === 'original') return source.slice()
  const ramp = colorways[key].swatches
  return source.map((original, i) => {
    const rgb = parseInt(original.slice(1), 16)
    const brightness = Math.max(rgb >> 16, (rgb >> 8) & 255, rgb & 255) / 255
    // Preserve dark foundations and keep accent volumes separate from the main palette.
    const index =
      (Math.round((i * (ramp.length - 1)) / Math.max(1, source.length - 1)) + (layerIndex % 2 ? 1 : 0)) %
      ramp.length
    const base = parseInt(ramp[index].slice(1), 16)
    const multiplier = (0.18 + 0.82 * brightness) * Math.min(1, brightness * 3)
    return (
      '#' +
      [base >> 16, (base >> 8) & 255, base & 255]
        .map((v) =>
          Math.round(v * multiplier)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    )
  })
}
const response = (
  target: Modulation['target'],
  lowHz: number,
  highHz: number,
  sensitivity: number,
  release = 240,
  channel: Modulation['channel'] = 'mono',
): Modulation => ({
  ...defaultModulation(target),
  source: 'band',
  lowHz,
  highHz,
  sensitivity,
  channel,
  attack: 18,
  release,
  min: Math.min(0, sensitivity),
  max: Math.max(0, sensitivity),
})
function buildLayer(design: LayerDesign, i: number, colorway: Colorway) {
  const {
    settings,
    material,
    palette: colors = ice,
    motions = [],
    modulations = [],
    effects,
    pulse,
    ...fields
  } = design
  const palette = tintedPalette(colors, colorway, i)
  const l = createLayer('visualizer', design.style)
  Object.assign(l, structuredClone(fields), {
    name: design.name ?? [design.style ?? 'Spectrum', design.layout].filter(Boolean).join(' · '),
    motions: structuredClone(motions),
    modulations: structuredClone(modulations),
    effects: { ...l.effects, ...effects },
  })
  Object.assign(l.settings, settings)
  Object.assign(
    l.material,
    {
      color: palette[0],
      colorMode: 'position',
      stops: palette.map((color, j) => ({ at: j / Math.max(1, palette.length - 1), color })),
    },
    structuredClone(material),
  )
  if (pulse) {
    const m = defaultModulation(
      pulse === 'radius'
        ? 'settings.radius'
        : pulse === 'emission'
          ? 'material.emission'
          : 'settings.maxHeight',
    )
    Object.assign(m, {
      source: 'band',
      attack: 20,
      release: 150,
      sensitivity: 0.45,
      lowHz: i % 2 ? 1400 : 45,
      highHz: i % 2 ? 6500 : 220,
    })
    l.modulations.push(m)
  }
  return l
}
const spin = (target: Motion['target'], degrees: number, period = 24): Motion => ({
  ...defaultMotion(target),
  wave: 'spin',
  amplitude: degrees,
  period,
})
const sway = (target: Motion['target'], degrees: number, period = 16): Motion => ({
  ...defaultMotion(target),
  amplitude: degrees,
  period,
})
function design(
  category: Category,
  en: string,
  ja: string,
  stage: Stage,
  ...layers: LayerDesign[]
): Template {
  const id = en.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const family = familyById.get(id)
  if (!family) throw Error('Template has no family: ' + id)
  const [mood, dimensions, cost, english, japanese] = editorial[id]
  return {
    id,
    mood,
    dimensions,
    cost,
    description: { en: english, ja: japanese },
    featured: featuredIds.includes(id),
    palette: [...(layers[0].palette ?? ice)],
    colorways: alternateColorways,
    family,
    category,
    name: { en, ja },
    create(colorway = 'original') {
      const p = createProject(en)
      p.layers = layers.map((layer, i) => buildLayer(layer, i, colorway))
      p.seed = Array.from(en).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0)
      p.camera.position = stage.eye ? [...stage.eye] : [0, 0, 7.4]
      if (stage.aim) p.camera.target = [...stage.aim]
      if (stage.ortho) {
        p.camera.projection = 'orthographic'
        p.camera.orthoSize = stage.ortho
      }
      p.camera.zoom = stage.zoom ?? 1.05
      p.lights.ambient.intensity = stage.ambient ?? 0.95
      p.lights.directional.color = stage.key ?? '#ffefe6'
      p.lights.directional.position = [-3, 5, 5]
      if (stage.rim) {
        p.lights.point.position = [3, 0, 2.2]
        p.lights.point.color = stage.rim
        p.lights.point.intensity = 12
      }
      p.background.color = stage.bg ?? '#050811'
      p.effects.bloom = stage.bloom ?? 0
      p.effects.trail = stage.trail ?? 0
      if (stage.orbit) p.motions = [sway('camera.orbit', stage.orbit, 28)]
      return p
    },
  }
}
const waveform = (extras: LayerDesign = {}): LayerDesign => ({
  style: 'waveform',
  material: { shading: 'unlit' },
  ...extras,
  settings: { lineWidth: 4, minHeight: 0, ...extras.settings },
})
const led = (rows: number, columns: number, extras: LayerDesign = {}): LayerDesign => ({
  style: 'led',
  settings: { rows, columns, width: 4.4 / columns, spacing: 0.025 },
  ...extras,
})
const terrain = (
  style: 'terrain' | 'waterfall' | 'spectrogram',
  extras: LayerDesign = {},
): LayerDesign => ({
  style,
  settings: { columns: 48, history: 48, depth: 0.35, minHeight: 0.04, maxHeight: 1.3 },
  ...extras,
})
const particle = (extras: LayerDesign = {}): LayerDesign => ({
  style: 'particles',
  shape: 'dot',
  material: { blend: 'add', shading: 'unlit' },
  ...extras,
})

function ticks(
  name: string,
  radius: number,
  count: number,
  width: number,
  height: number,
  palette: string[],
  arc = 360,
  layout: Layout = arc === 360 ? 'circle' : 'arc',
  rotation: Vec3 = [0, 0, 0],
  position: Vec3 = [0, 0, 0],
): LayerDesign {
  return {
    name,
    layout,
    shape: 'ribbon',
    position,
    rotation,
    settings: {
      radius,
      count,
      width,
      minHeight: height * 0.86,
      maxHeight: height,
      spacing: layout === 'line' ? 0.095 : 0.02,
      depth: 0.02,
      arc,
      startAngle: arc === 360 ? 0 : (180 - arc) / 2,
    },
    palette,
    material: { shading: 'unlit' },
  }
}
function body(name: string, radius: number, palette: string[]): LayerDesign {
  return {
    name,
    style: 'polygon',
    settings: { count: 24, radius, maxHeight: 0.46, speed: 0.25 },
    palette,
    material: { metalness: 0.34, roughness: 0.28 },
    motions: [spin('rotation.y', 42, 24)],
  }
}
function orbiter(name: string, position: Vec3, radius: number, palette: string[]): LayerDesign {
  return { ...body(name, radius, palette), position, motions: [sway('position.y', 0.12, 17)] }
}

export const templates: Template[] = [
  design(
    'dust',
    'Binary Stars',
    '連星',
    { eye: [0, 0.35, 7.65], bg: '#020310', zoom: 1.19 },
    {
      name: 'Accretion disc',
      style: 'galaxy',
      rotation: [0, 2, -9],
      settings: { count: 420, radius: 2.28, spread: 1.14, gain: 1.18, speed: 0.72 },
      palette: ['#402781', '#8248ff', '#409cff', '#81f3ff', '#ffb66b'],
      material: { shading: 'unlit' },
      modulations: [
        response('rotation.z', 38, 105, 2.8, 760),
        response('settings.spread', 1200, 4200, 0.11, 420),
      ],
    },
    {
      name: 'Companion',
      style: 'globe',
      position: [1.86, 0.88, -0.85],
      settings: { radius: 0.21, count: 52, gain: 0.6, speed: 0.38, maxHeight: 0.4 },
      palette: ['#6c384d', '#ff824d', '#ffe8bb'],
      material: { shading: 'unlit' },
      motions: [sway('position.y', 0.085, 23)],
    },
  ),
  design(
    'radial',
    'Halo Index',
    '光輪の目盛',
    { eye: [0, 0, 7], bg: '#050512', zoom: 1.04 },
    {
      name: 'Spectrum crown',
      style: 'radial',
      settings: { count: 168, radius: 1.56, maxHeight: 0.83, width: 0.058, gain: 1.12 },
      palette: ['#5e45d9', '#b14aff', '#ff6bca', '#ffc779'],
      material: { shading: 'unlit' },
    },
    ticks('Index marks', 2.39, 52, 0.038, 0.1, ['#2b315a', '#5a87ba', '#38324a']),
    {
      name: 'Counterweight',
      layout: 'arc',
      shape: 'dot',
      settings: { radius: 1.23, arc: 70, startAngle: -88, count: 14, width: 0.027 },
      palette: ['#4c4c7c', '#85dbeb'],
      motions: [spin('rotation.z', 28, 20)],
    },
  ),
  design(
    'retro',
    'Level Meter',
    'レベルメーター',
    { ortho: 6.55, bg: '#03070b', zoom: 1.04 },
    {
      name: 'Phosphor cells',
      style: 'diodes',
      position: [0, 0.13, 0],
      scale: [1, 1.08, 1],
      settings: { rows: 31, columns: 64, width: 0.07, spacing: 0.02, depth: 0.03, gain: 1.26 },
      palette: ['#158d9e', '#75fbc3', '#d5ef55', '#ffae3c', '#f45367'],
      material: { shading: 'unlit' },
    },
    waveform({
      name: 'Monitor trace',
      position: [0, -1.63, 0.05],
      settings: { count: 200, radius: 2.17, lineWidth: 2.6, maxHeight: 0.14 },
      palette: ['#28575d', '#82ded0'],
    }),
  ),
  design(
    'orbit',
    'Liquid Pearl',
    '液体の真珠',
    { eye: [0, 0, 7.15], bg: '#030514', zoom: 1.05 },
    {
      name: 'Polar filaments',
      style: 'globe',
      rotation: [-8, -12, -15],
      settings: { radius: 1.73, count: 150, gain: 1.17, speed: 0.74, maxHeight: 1.06 },
      palette: ['#3640bd', '#3ddfff', '#c1fdff', '#da86ff', '#ffb984'],
      material: { shading: 'unlit' },
      motions: [sway('rotation.y', 8, 38)],
    },
    particle({
      name: 'Peripheral ions',
      position: [0, 0, -1.8],
      settings: {
        count: 120,
        width: 0.039,
        spread: 1.8,
        radius: 1.2,
        speed: 0.25,
        lifetime: 12,
        maxHeight: 3.8,
      },
      palette: ['#3047a4', '#4e8de6', '#afbceb'],
    }),
  ),
  design(
    'abstract',
    'Prism Current',
    'プリズム・カレント',
    { eye: [0, 0, 8], bg: '#0b0e16' },
    {
      name: 'Prism Current',
      style: 'prism',
      settings: { count: 74, radius: 1.9, width: 0.1 },
      palette: ['#64ffd3', '#71daff', '#aca3ff', '#ffc399'],
    },
  ),
  design(
    'minimal',
    'Polar Needle',
    '極の針',
    { ortho: 6.5, aim: [0, 0.35, 0], bg: '#0b1014' },
    {
      shape: 'line',
      settings: { count: 40, width: 0.125, lineWidth: 4, minHeight: 0.12, maxHeight: 1.2 },
      palette: chalk,
    },
    waveform({
      name: 'Brass datum',
      position: [0, -0.28, -0.05],
      settings: { count: 96, radius: 2.13, lineWidth: 2.2, maxHeight: 0.018 },
      palette: ['#4e402f', '#c09260'],
    }),
  ),
  design(
    'minimal',
    'Quiet Interval',
    '静かな間隔',
    { ortho: 5.2, bg: '#031011' },
    {
      shape: 'dot',
      layout: 'symmetric',
      settings: { count: 27, width: 0.118, spacing: 0.1 },
      palette: moss,
    },
    waveform({
      name: 'Undertrace',
      position: [0, -0.23, -0.04],
      settings: { radius: 2.15, maxHeight: 0.2, lineWidth: 3 },
      palette: ['#20464b', '#67837d'],
    }),
  ),
  design(
    'minimal',
    'Single Trace',
    '一本の軌跡',
    { eye: [0, 0, 7.6], bg: '#080912' },
    waveform({ settings: { count: 230, lineWidth: 4.4, radius: 2.35, maxHeight: 1.1 }, palette: chalk }),
    waveform({
      name: 'Afterline',
      position: [0, -0.09, -0.07],
      settings: { count: 180, radius: 2.35, maxHeight: 1.2, lineWidth: 2.2 },
      palette: ['#343359', '#975d9d'],
    }),
  ),
  design(
    'minimal',
    'Porcelain',
    '白磁',
    { eye: [0, 0.2, 6.2], bg: '#11161a', ambient: 0.56, key: '#fff4cf', rim: '#86d3e8' },
    {
      style: 'orb',
      settings: { radius: 1.43, maxHeight: 0.7, speed: 0.2 },
      palette: chalk,
      material: { roughness: 0.1, metalness: 0.3 },
    },
    ticks('Broken halo', 1.77, 35, 0.026, 0.09, ['#596670', '#bd936c'], 265),
  ),
  design(
    'minimal',
    'Open Dial',
    '開いた文字盤',
    { ortho: 5.9, bg: '#070e13' },
    {
      layout: 'arc',
      shape: 'rounded',
      settings: {
        radius: 2,
        startAngle: -210,
        arc: 240,
        count: 41,
        maxHeight: 0.85,
        minHeight: 0.18,
        width: 0.08,
      },
      palette: ice,
    },
    ticks('Inner scale', 1.53, 18, 0.045, 0.15, ['#31495a', '#a5bead'], 220),
  ),
  design(
    'bars',
    'Twin Rail',
    '双軌',
    { ortho: 6.65, bg: '#100e16' },
    {
      layout: 'symmetric',
      position: [0, 0.13, 0],
      modulations: [response('settings.maxHeight', 45, 130, 0.65, 310, 'left')],
      settings: { count: 49, width: 0.08, maxHeight: 1.6 },
      palette: amber,
    },
    {
      layout: 'symmetric',
      rotation: [0, 0, 180],
      position: [0, -0.13, 0],
      modulations: [response('settings.maxHeight', 350, 1800, 0.55, 210, 'right')],
      settings: { count: 49, width: 0.08, maxHeight: 0.95 },
      palette: rose,
    },
  ),
  design(
    'bars',
    'Stairwell',
    '階段室',
    { eye: [2.6, 2.95, 6.5], aim: [0, 0.15, 0], bg: '#071412', rim: '#58d2a5' },
    ...[-1, 0, 1].map(
      (i): LayerDesign => ({
        name: ['Lower flight', 'Landing', 'Upper flight'][i + 1],
        shape: 'rounded',
        position: [i * 0.36, i * 0.34, i === 0 ? 0 : -i * 0.55],
        rotation: [0, 9, 15],
        settings: {
          count: 23,
          width: 0.158,
          spacing: 0.044,
          depth: 0.26,
          minHeight: 0.19,
          maxHeight: 0.55 + 0.23 * (1 + i),
          reverse: i === 1,
        },
        palette: [
          ['#165856', '#39a698'],
          ['#277869', '#90edac'],
          ['#789c68', '#f0e5ad'],
        ][i + 1],
      }),
    ),
  ),
  design(
    'bars',
    'Crystal Organ',
    '水晶のオルガン',
    { eye: [2.4, 2.0, 7.1], aim: [0, 0.52, 0], bg: '#050c16', rim: '#54c9ff' },
    {
      shape: 'triangle',
      settings: { count: 39, width: 0.135, depth: 0.45, minHeight: 0.28, maxHeight: 2.8 },
      material: { metalness: 0.7, roughness: 0.2 },
      palette: ice,
    },
    {
      name: 'Lower pipes',
      shape: 'triangle',
      position: [0, -0.06, -0.08],
      rotation: [0, 0, 180],
      settings: { count: 28, width: 0.15, depth: 0.35, maxHeight: 0.76, minHeight: 0.12 },
      palette: ['#43305c', '#8154af', '#a6a5ed'],
      material: { roughness: 0.24, metalness: 0.35 },
    },
  ),
  design(
    'bars',
    'Comb Filter',
    '櫛状フィルター',
    { ortho: 5.4, aim: [0, 0.45, 0], bg: '#100711' },
    {
      shape: 'line',
      settings: { count: 81, width: 0.048, lineWidth: 3.2, maxHeight: 2.1, minHeight: 0.08 },
      palette: rose,
    },
    waveform({ position: [0, 0.05, 0.1], settings: { radius: 1.95, maxHeight: 0.27 }, palette: chalk }),
  ),
  design(
    'bars',
    'Offset Columns',
    '交差列',
    { eye: [2.5, 2.45, 7.3], aim: [0, 0.62, -0.22], bg: '#100c18', rim: '#8e70ff' },
    {
      shape: 'rounded',
      rotation: [0, 14, 0],
      settings: { count: 18, width: 0.21, maxHeight: 2.5 },
      palette: amber,
    },
    {
      shape: 'bar',
      position: [0, 0, -1],
      rotation: [0, -18, 0],
      settings: { count: 31, width: 0.13, maxHeight: 1.55, reverse: true },
      palette: ice,
    },
  ),
  design(
    'radial',
    'Nested Orbit',
    '入れ子軌道',
    { eye: [0, 0.45, 7.35], bg: '#061216' },
    {
      layout: 'rings',
      shape: 'sphere',
      rotation: [25, 12, -10],
      settings: { count: 180, radius: 2.2, width: 0.085 },
      motions: [spin('rotation.z', 60)],
      palette: moss,
    },
    body('Jade heart', 0.5, ['#24465f', '#97dabf', '#e8d3a0']),
  ),
  design(
    'radial',
    'Eclipse Gate',
    '日食の門',
    {},
    {
      layout: 'ellipse',
      shape: 'triangle',
      rotation: [18, 23, 20],
      settings: { radius: 1.45, count: 60, width: 0.12, maxHeight: 0.7, inward: true },
      palette: amber,
    },
    {
      style: 'orb',
      settings: { radius: 0.65, maxHeight: 0.5 },
      material: { metalness: 0.8 },
      palette: rose,
    },
    orbiter('Distant moon', [1.65, 0.72, -0.4], 0.2, ['#687eae', '#d7dafa']),
  ),
  design(
    'radial',
    'Coiled Signal',
    '螺旋信号',
    { eye: [0, 1, 8] },
    {
      layout: 'spiral',
      shape: 'cube',
      rotation: [25, 0, -18],
      settings: { count: 126, width: 0.09, radius: 2.2 },
      motions: [sway('rotation.x', 15)],
      palette: rose,
    },
    {
      name: 'Copper filament',
      layout: 'spiral',
      shape: 'dot',
      rotation: [-26, 0, -20],
      settings: { count: 104, width: 0.048, radius: 1.75, startAngle: 125 },
      palette: ['#8f475b', '#e99f8e'],
      motions: [spin('rotation.z', -30, 24)],
    },
  ),
  design(
    'radial',
    'East West',
    '東と西',
    { ortho: 5.4, bg: '#0b0e18' },
    {
      layout: 'arc',
      settings: { arc: 145, startAngle: 18, radius: 1.5, count: 51, maxHeight: 0.95 },
      palette: amber,
    },
    {
      layout: 'arc',
      settings: { arc: 145, startAngle: 198, radius: 1.5, count: 36, maxHeight: 0.75, inward: true },
      palette: ice,
    },
  ),
  design(
    'waves',
    'Oscillograph',
    'オシログラフ',
    { ortho: 5.15, bg: '#00100e' },
    waveform({ settings: { count: 256, lineWidth: 4.8, radius: 2.35, maxHeight: 1.45 }, palette: moss }),
    ticks('Reference rule', 1, 42, 0.04, 0.065, ['#1a4d43', '#47896b'], 360, 'line'),
  ),
  design(
    'waves',
    'Phase Portrait',
    '位相の肖像',
    { eye: [0, 0, 6.65], bg: '#0e0818', trail: 0.3 },
    {
      style: 'lissajous',
      settings: { count: 192, lineWidth: 3.2, radius: 2, gain: 2.0 },
      palette: rose,
      material: { shading: 'unlit' },
    },
    ticks('Phase boundary', 2.14, 72, 0.025, 0.065, ['#413b68', '#66719b']),
  ),
  design(
    'waves',
    'Crossfeed',
    'クロスフィード',
    { ortho: 5.55, bg: '#040b19' },
    waveform({
      rotation: [0, 0, 20],
      settings: { radius: 2.35, maxHeight: 1.2, lineWidth: 4.8 },
      palette: ice,
    }),
    waveform({
      rotation: [0, 0, -25],
      position: [0, 0, -0.15],
      settings: { reverse: true, radius: 1.8 },
      palette: amber,
    }),
  ),
  design(
    'waves',
    'Stereo Window',
    'ステレオ窓',
    { ortho: 5.5, bg: '#091117' },
    {
      style: 'lissajous',
      scale: [0.95, 0.95, 1],
      settings: { count: 192, lineWidth: 2.9, radius: 1.65, gain: 2.15 },
      palette: chalk,
    },
    waveform({ position: [0, -1.45, 0], settings: { maxHeight: 0.45, radius: 1.35 }, palette: rose }),
    ticks('Open instrument bezel', 1.88, 56, 0.035, 0.09, ['#2f4350', '#638088'], 265),
  ),
  design(
    'waves',
    'Ribbon Stack',
    '重なるリボン',
    { eye: [2.5, 2.3, 6.7], bg: '#07101b' },
    ...[-1, 0, 1].map((i) =>
      waveform({
        position: [0, i * 0.3, i * 0.8],
        settings: { radius: 1.9, maxHeight: 1.1 + i * 0.22, lineWidth: 3 + i },
        palette: i < 0 ? ['#21334f', '#6e91b8'] : i === 0 ? ice : amber,
      }),
    ),
  ),
  design(
    'retro',
    'Cartridge',
    'カートリッジ',
    { eye: [1.8, 1.6, 6.4], aim: [0, -0.1, 0], bg: '#170f0c' },
    led(12, 20, { rotation: [0, -9, 0], palette: amber }),
    {
      shape: 'cube',
      position: [0, -1, 0],
      settings: { count: 16, width: 0.25, spacing: 0.025 },
      palette: chalk,
    },
  ),
  design(
    'retro',
    'Inverted Display',
    '反転表示',
    { ortho: 7.15, bg: '#080b13' },
    {
      name: 'Upper diode bank',
      style: 'diodes',
      position: [0, 0.74, 0],
      settings: { rows: 10, columns: 52, width: 0.095, spacing: 0.028, gain: 1.05, depth: 0.035 },
      palette: ['#195084', '#2ad7cf', '#a7ffba'],
      material: { shading: 'unlit' },
    },
    {
      name: 'Return bank',
      style: 'diodes',
      position: [0, -0.65, 0],
      rotation: [0, 0, 180],
      settings: {
        rows: 8,
        columns: 52,
        width: 0.095,
        spacing: 0.028,
        gain: 0.85,
        reverse: true,
        depth: 0.035,
      },
      palette: ['#41217d', '#945afa', '#fd9bac'],
      material: { shading: 'unlit' },
    },
  ),
  design(
    'retro',
    'Phosphor Scan',
    '蛍光走査',
    { ortho: 4.85, bg: '#06100d' },
    terrain('spectrogram', { settings: { columns: 72, history: 60, radius: 2.17 }, palette: moss }),
    waveform({ position: [0, 0.1, 0.04], settings: { radius: 2.05, maxHeight: 0.55 }, palette: chalk }),
  ),
  design(
    'retro',
    'Pocket Radio',
    'ポケットラジオ',
    { ortho: 5.65, bg: '#160e12' },
    led(6, 14, { position: [-0.55, 0, 0], scale: [0.65, 0.65, 1], palette: amber }),
    {
      layout: 'arc',
      shape: 'dot',
      position: [1.65, 0, 0],
      settings: { arc: 290, startAngle: -235, radius: 0.6, count: 19, width: 0.065 },
      palette: rose,
    },
  ),
  design(
    'neon',
    'Afterimage',
    '残光',
    { eye: [0, 0.12, 7.7], bloom: 0.39, trail: 0.41, bg: '#090512' },
    {
      style: 'tunnel',
      settings: { rows: 18, radius: 1.56, depth: 0.73, lineWidth: 3.1 },
      material: { blend: 'add' },
      palette: rose,
    },
  ),
  design(
    'neon',
    'Electric Spine',
    '光る背骨',
    { bg: '#070913', bloom: 0.38, zoom: 1.18 },
    {
      layout: 'path',
      shape: 'line',
      settings: {
        count: 96,
        radius: 2.33,
        path: 'M 5 50 C 25 -15 75 115 95 50',
        maxHeight: 0.8,
        lineWidth: 2.8,
      },
      palette: ice,
      motions: [sway('rotation.z', 10)],
    },
    {
      name: 'Low filament',
      layout: 'path',
      shape: 'dot',
      position: [0, -0.06, -0.09],
      settings: { count: 142, radius: 2.33, width: 0.043, path: 'M 5 50 C 25 -15 75 115 95 50' },
      palette: ['#3d5075', '#8061a6'],
    },
  ),
  design(
    'neon',
    'Ion Mesh',
    'イオン格子',
    { eye: [0.35, 0.28, 7.8], bg: '#031112', bloom: 0.12 },
    {
      name: 'Auroral mesh',
      style: 'globe',
      settings: { radius: 1.65, count: 105, speed: 1.25, maxHeight: 1.32, gain: 1.3 },
      palette: ['#175873', '#52e0a7', '#c1ffd4', '#ffe9a2'],
      material: { shading: 'unlit' },
    },
    {
      name: 'Wire core',
      style: 'polygon',
      settings: { count: 52, radius: 0.9, maxHeight: 0.9 },
      palette: ['#15505c', '#6fcda3'],
      material: { wireframe: true },
      motions: [spin('rotation.y', 85, 14)],
    },
    particle({
      name: 'Ion field',
      settings: { count: 170, width: 0.047, radius: 1.1, spread: 1.7, maxHeight: 3 },
      palette: ['#18645e', '#6df4a0'],
    }),
  ),
  design(
    'neon',
    'Signal Arch',
    '光のアーチ',
    { bloom: 0.4 },
    {
      layout: 'arc',
      shape: 'ribbon',
      settings: { arc: 180, startAngle: 0, count: 85, radius: 1.4, maxHeight: 0.85 },
      palette: rose,
    },
    waveform({ settings: { radius: 1.4, maxHeight: 0.5, lineWidth: 4 }, palette: ice }),
    ticks('Inner beadwork', 1.17, 52, 0.042, 0.06, ['#75508c', '#efaaab'], 172),
  ),
  design(
    'neon',
    'Laser Harp',
    'レーザーハープ',
    { eye: [2.3, 1.8, 6.6], aim: [0, 0.72, 0], bloom: 0.3, bg: '#080813' },
    {
      layout: 'grid',
      shape: 'line',
      settings: {
        columns: 12,
        count: 108,
        width: 0.22,
        depth: 0.3,
        minHeight: 0.5,
        maxHeight: 2,
        lineWidth: 2,
      },
      palette: ice,
    },
    {
      name: 'Soundboard',
      layout: 'grid',
      shape: 'cube',
      position: [0, -0.11, 0],
      settings: { count: 108, columns: 12, width: 0.15, depth: 0.23, spacing: 0.11, gain: 0.28 },
      palette: ['#262340', '#574772'],
    },
  ),
  design(
    'cinema',
    'Horizon Line',
    '地平線',
    { eye: [0, 1.58, 6.9], aim: [0, 0.45, -0.25], bg: '#111323' },
    terrain('waterfall', {
      settings: { radius: 2.8, depth: 0.5, columns: 80, history: 48, maxHeight: 1.22 },
      palette: chalk,
    }),
  ),
  design(
    'cinema',
    'Slow Eclipse',
    '静かな日食',
    { bg: '#130c19', orbit: 12, ambient: 0.3, key: '#ffb87b', rim: '#6c81e4' },
    {
      style: 'orb',
      settings: { radius: 1.61, maxHeight: 0.7, speed: 0.11 },
      material: { metalness: 0.8, roughness: 0.18 },
      palette: amber,
      pulse: 'emission',
    },
    {
      layout: 'ellipse',
      shape: 'line',
      rotation: [62, 0, -25],
      settings: { radius: 2, count: 96, minHeight: 0.1, maxHeight: 0.4 },
      palette: rose,
    },
  ),
  design(
    'cinema',
    'Deep Focus',
    '深い焦点',
    { eye: [0, 0.25, 7.8], bg: '#080a16', ambient: 0.4, key: '#ffcd94', rim: '#6ebcff' },
    {
      name: 'Distant companion',
      style: 'galaxy',
      position: [-1.4, 0.55, -3.5],
      rotation: [7, -22, 34],
      settings: { radius: 1.7, count: 200, spread: 0.85, gain: 0.83, speed: 0.48 },
      palette: ['#23358c', '#4e81c8', '#96d3d0', '#ffab74'],
      material: { shading: 'unlit' },
    },
    {
      name: 'Foreground lens',
      style: 'polygon',
      position: [0.95, -0.45, 0.15],
      rotation: [12, -23, 17],
      settings: { count: 23, radius: 1.0, maxHeight: 0.55 },
      material: { metalness: 0.56, roughness: 0.21 },
      palette: ['#2f3459', '#b39a8c', '#ffcd77'],
      motions: [sway('rotation.y', 8, 19)],
    },
    particle({
      name: 'Defocused dust',
      position: [0, 0.25, -1],
      settings: { count: 100, speed: 0.33, lifetime: 10, width: 0.053, spread: 1.45, maxHeight: 2.6 },
      palette: ['#625266', '#c79d83'],
    }),
  ),
  design(
    'cinema',
    'Dune Study',
    '砂丘習作',
    { eye: [3, 2.2, 7], orbit: 10, bg: '#170e16', ambient: 0.48, key: '#ffd2a0', rim: '#ab69a8' },
    terrain('terrain', {
      settings: { radius: 2.4, depth: 0.5, maxHeight: 1.55, history: 60, columns: 70 },
      material: { roughness: 0.88 },
      palette: amber,
    }),
  ),
  design(
    'cinema',
    'Long Exposure',
    '長時間露光',
    { eye: [1, 1, 8], bg: '#090e1a' },
    {
      style: 'prism',
      scale: [1.55, 0.45, 1],
      rotation: [10, -24, -12],
      settings: { radius: 1.3, count: 50, speed: 0.25 },
      palette: chalk,
    },
    {
      name: 'Violet exposure',
      style: 'prism',
      scale: [1.5, 0.22, 0.58],
      rotation: [0, -30, -4],
      position: [0, -0.32, -0.3],
      settings: { radius: 1.28, count: 30, speed: 0.18 },
      palette: ['#42395b', '#817193', '#675a7d'],
    },
  ),
  design(
    'grid',
    'Block District',
    'ブロック街区',
    { eye: [3.1, 3.4, 7.55], aim: [0, 0.55, 0], bg: '#071018', key: '#bfe5ff', rim: '#fca86f' },
    {
      name: 'Tower district',
      layout: 'grid',
      position: [-0.83, 0, 0],
      settings: {
        count: 96,
        columns: 8,
        width: 0.18,
        spacing: 0.064,
        depth: 0.19,
        minHeight: 0.1,
        maxHeight: 2.3,
      },
      palette: ['#335378', '#59b6c5', '#baf4c8'],
    },
    {
      name: 'Low courts',
      layout: 'grid',
      position: [1.12, 0, -0.2],
      settings: {
        count: 56,
        columns: 7,
        width: 0.21,
        spacing: 0.072,
        depth: 0.24,
        minHeight: 0.12,
        maxHeight: 0.74,
        reverse: true,
      },
      palette: ['#765155', '#ed967a', '#fdddac'],
    },
    {
      name: 'Transit lane',
      shape: 'dot',
      position: [0.12, 0.045, 0],
      rotation: [0, 90, 0],
      settings: { count: 18, width: 0.037, spacing: 0.16, gain: 0.2 },
      palette: ['#86a3bd', '#e6efcb'],
    },
  ),
  design(
    'grid',
    'Floating Tiles',
    '浮遊タイル',
    { eye: [2.35, 4.6, 6.1], key: '#c2ffda', rim: '#d2a593', bg: '#071511' },
    {
      layout: 'grid',
      shape: 'cube',
      settings: { count: 100, columns: 10, width: 0.22, depth: 0.25, spacing: 0.13 },
      palette: moss,
      motions: [sway('rotation.y', 18)],
    },
    {
      name: 'Suspended foundation',
      layout: 'grid',
      shape: 'cube',
      position: [0.09, -0.65, -0.1],
      settings: { count: 81, columns: 9, width: 0.21, depth: 0.23, spacing: 0.14, gain: 0.28 },
      palette: ['#1e3a47', '#386a67'],
    },
  ),
  design(
    'grid',
    'Needle Field',
    '針の平原',
    { eye: [3.8, 3.2, 6.48], aim: [0, 0.63, 0], bg: '#0c0915' },
    {
      layout: 'grid',
      shape: 'line',
      settings: {
        count: 400,
        columns: 20,
        width: 0.18,
        depth: 0.17,
        spacing: 0.045,
        maxHeight: 2.5,
        lineWidth: 2.8,
      },
      palette: rose,
    },
    {
      name: 'Roots',
      layout: 'grid',
      shape: 'dot',
      rotation: [-4, 0, 0],
      position: [0, -0.08, 0],
      settings: { count: 400, columns: 20, width: 0.07, depth: 0.11, spacing: 0.12, gain: 0.26 },
      palette: ['#224154', '#7d61ac'],
    },
  ),
  design(
    'grid',
    'Pyramid Array',
    'ピラミッド群',
    {
      eye: [2.45, 2.4, 6.2],
      aim: [0, 0.48, 0],
      key: '#ffd58c',
      rim: '#b5568a',
      ambient: 0.48,
      bg: '#130e17',
    },
    {
      layout: 'grid',
      shape: 'triangle',
      settings: {
        count: 81,
        columns: 9,
        width: 0.35,
        depth: 0.35,
        spacing: 0.09,
        minHeight: 0.18,
        maxHeight: 1.8,
      },
      material: { metalness: 0.45 },
      palette: amber,
    },
  ),
  design(
    'grid',
    'Double Deck',
    '二重デッキ',
    { eye: [2.9, 2.1, 6.7], bg: '#071019' },
    {
      layout: 'grid',
      shape: 'dot',
      rotation: [-90, 0, 0],
      settings: { count: 64, columns: 8, width: 0.18, depth: 0.2, spacing: 0.22 },
      palette: amber,
    },
    {
      layout: 'grid',
      position: [0, -0.85, 0],
      settings: { count: 64, columns: 8, width: 0.2, depth: 0.2, spacing: 0.18, maxHeight: 0.72 },
      palette: ice,
    },
  ),
  design(
    'land',
    'Cascade',
    'カスケード',
    { eye: [-0.8, 3.8, 5.5], aim: [0, 0.55, -0.1], bg: '#041019', key: '#99ddea', rim: '#79a5ef' },
    terrain('waterfall', {
      settings: {
        columns: 72,
        history: 66,
        radius: 2.15,
        depth: 0.47,
        minHeight: 0.12,
        maxHeight: 1.38,
      },
      palette: ['#135887', '#4ca8cc', '#c4f4e3'],
    }),
  ),
  design(
    'land',
    'Fault Lines',
    '断層線',
    { eye: [3, 2.7, 7], orbit: 16 },
    terrain('terrain', {
      material: { wireframe: true },
      settings: { radius: 2, depth: 0.48, columns: 36, history: 30, maxHeight: 2 },
      palette: moss,
    }),
    terrain('terrain', {
      name: 'Obsidian base',
      position: [0, -0.038, -0.01],
      settings: { radius: 2, depth: 0.48, columns: 36, history: 30, maxHeight: 2 },
      palette: ['#10151e', '#1c3e45', '#365253'],
      material: { roughness: 0.89 },
    }),
  ),
  design(
    'land',
    'Spectral Map',
    '周波数地図',
    { ortho: 5 },
    terrain('spectrogram', {
      settings: { radius: 2, columns: 96, history: 96 },
      palette: rose,
      material: { colorMode: 'height', shading: 'unlit' },
    }),
    waveform({
      name: 'Live header',
      position: [0, 1.77, 0.1],
      settings: { count: 176, radius: 1.88, maxHeight: 0.18, lineWidth: 2.9 },
      palette: ['#9b789e', '#fcb6be'],
    }),
  ),
  design(
    'land',
    'Rift Valley',
    '裂谷',
    { eye: [2.35, 3.2, 6.5], aim: [0, 0.5, -0.2], bg: '#100b19', key: '#e5ccd0', rim: '#8756cd' },
    terrain('terrain', { position: [-1.15, 0, 0], scale: [0.55, 1, 1], palette: amber }),
    terrain('waterfall', {
      position: [1.15, 0, 0],
      scale: [0.55, 0.75, 1],
      rotation: [0, 180, 0],
      palette: ice,
    }),
  ),
  design(
    'land',
    'Tidal Shelf',
    '潮の棚',
    { eye: [-2.4, 2.45, 6], aim: [0, 0.21, 0], bg: '#09141b', ambient: 0.45, rim: '#88d5d1' },
    terrain('waterfall', {
      settings: { columns: 64, history: 70, depth: 0.48, radius: 1.95, maxHeight: 0.85 },
      palette: ['#234353', '#4e6c75', '#9fb9b4'],
    }),
    particle({
      settings: { count: 130, spread: 1, radius: 1.35, width: 0.072, maxHeight: 1.55 },
      palette: ice,
    }),
  ),
  design(
    'orbit',
    'Transit Tube',
    '通過管',
    { eye: [0.3, 0.35, 7.65], bg: '#040d13' },
    {
      style: 'tunnel',
      settings: { rows: 27, radius: 1.7, depth: 0.69, lineWidth: 2.5, count: 48 },
      palette: ice,
    },
  ),
  design(
    'orbit',
    'Orbital Pins',
    '球面ピン',
    { eye: [0, 0.15, 7.1], orbit: 18, ambient: 0.72, rim: '#8ac9dc', bg: '#080d18' },
    {
      layout: 'sphere',
      shape: 'triangle',
      settings: { count: 250, radius: 1.25, width: 0.085, maxHeight: 0.6, minHeight: 0.09 },
      palette: moss,
      motions: [spin('rotation.y', 90)],
    },
    body('Indigo core', 1.05, ['#1e1c40', '#6356a1', '#9296d4']),
  ),
  design(
    'orbit',
    'Glass Satellite',
    'ガラス衛星',
    {},
    {
      style: 'orb',
      settings: { radius: 1.05, count: 74 },
      palette: ice,
      material: { metalness: 0.76, roughness: 0.18 },
    },
    {
      layout: 'circle',
      shape: 'sphere',
      rotation: [57, 9, -18],
      settings: { radius: 2.05, count: 42, width: 0.065 },
      palette: amber,
      motions: [spin('rotation.z', 120)],
    },
    orbiter('Small moon', [-1.92, 0.75, -0.3], 0.24, ['#4a759b', '#a9d8dd']),
  ),
  design(
    'orbit',
    'Hex Passage',
    '六角回廊',
    { eye: [0.2, -0.2, 7] },
    {
      style: 'tunnel',
      settings: { count: 8, rows: 15, depth: 0.85, radius: 1.6, speed: 0.6, lineWidth: 4.5 },
      palette: rose,
      rotation: [0, 0, 18],
    },
    {
      name: 'Inner gate',
      style: 'tunnel',
      position: [0, 0, -2.75],
      rotation: [0, 0, 31],
      settings: { count: 8, rows: 8, radius: 0.86, depth: 0.36, lineWidth: 3, speed: -0.26 },
      palette: ['#28476f', '#5a8bba', '#adced4'],
    },
  ),
  design(
    'dust',
    'Fireflies',
    '蛍',
    { eye: [0, 0.22, 6.8], bg: '#06100f' },
    particle({
      settings: {
        count: 320,
        width: 0.11,
        spread: 1.1,
        radius: 1.1,
        maxHeight: 3,
        lifetime: 5.5,
        speed: 0.7,
      },
      palette: moss,
      pulse: 'radius',
    }),
    particle({
      name: 'Distant canopy',
      position: [0, 0.18, -1.15],
      settings: {
        count: 125,
        width: 0.055,
        spread: 1.9,
        radius: 1.13,
        lifetime: 9,
        maxHeight: 3.7,
        speed: 0.36,
      },
      palette: ['#275561', '#84a885', '#f1d78d'],
    }),
  ),
  design(
    'dust',
    'Meteor Rain',
    '流星雨',
    { eye: [0, 1, 8], trail: 0.46 },
    particle({
      shape: 'mesh',
      rotation: [0, 0, -28],
      settings: { count: 180, width: 0.07, gravity: 5, lifetime: 2.5, maxHeight: 3.5, spread: 0.9 },
      palette: ice,
    }),
    particle({
      name: 'Distant shower',
      shape: 'triangle',
      rotation: [0, 0, -38],
      position: [-0.45, 0.5, -1.7],
      settings: {
        count: 140,
        width: 0.042,
        spread: 1.5,
        radius: 1.4,
        gravity: 3,
        lifetime: 3.6,
        speed: 0.75,
        maxHeight: 4.5,
      },
      palette: ['#394871', '#647ea7', '#7eb9ba'],
    }),
    {
      name: 'Meteor',
      style: 'polygon',
      position: [0.75, -0.43, 0.6],
      scale: [1.7, 0.65, 0.7],
      rotation: [0, 7, -28],
      settings: { radius: 0.29, count: 18, maxHeight: 0.9 },
      palette: amber,
      motions: [sway('position.y', 0.15, 3.2)],
    },
  ),
  design(
    'dust',
    'Fountain',
    '噴水',
    { eye: [2.2, 1.7, 6.45], aim: [0, 0.15, 0], bg: '#070e15', rim: '#48c5db' },
    particle({
      shape: 'sphere',
      settings: {
        count: 500,
        radius: 0.69,
        spread: 1.35,
        gravity: 6,
        maxHeight: 6,
        lifetime: 2,
        width: 0.078,
      },
      position: [0, 0.75, 0],
      palette: rose,
    }),
    ticks(
      'Basin',
      1.4,
      65,
      0.045,
      0.12,
      ['#2c7486', '#6aa0b2'],
      360,
      'circle',
      [68, 0, 0],
      [0, -0.72, 0],
    ),
  ),
  design(
    'dust',
    'Paper Drift',
    '紙片の漂い',
    { orbit: 17 },
    particle({
      shape: 'triangle',
      settings: {
        count: 90,
        width: 0.12,
        radius: 1.1,
        spread: 1.25,
        maxHeight: 3.2,
        lifetime: 9,
        speed: 0.7,
      },
      material: { shading: 'standard', blend: 'normal' },
      palette: ['#83698f', '#e0ad92', '#ffebbe'],
    }),
    particle({
      name: 'Distant scraps',
      shape: 'triangle',
      position: [0, 0.2, -1.4],
      rotation: [0, -12, 18],
      settings: {
        count: 115,
        width: 0.08,
        radius: 1.4,
        spread: 1.45,
        maxHeight: 3.5,
        lifetime: 7,
        speed: 0.58,
      },
      palette: ['#364168', '#637f96', '#a5b8b2'],
    }),
  ),
  design(
    'abstract',
    'Facet Atlas',
    '面のアトラス',
    { orbit: 20 },
    {
      style: 'polygon',
      settings: { count: 24, radius: 1.6, maxHeight: 1.5 },
      palette: amber,
      motions: [spin('rotation.y', 95)],
      material: { metalness: 0.5, roughness: 0.25 },
    },
    ticks('Survey arc', 1.97, 49, 0.04, 0.09, ['#52506d', '#b09a98'], 228, 'arc', [22, -14, 32]),
  ),
  design(
    'abstract',
    'Knot Script',
    '結び目の曲線',
    { ortho: 6 },
    {
      layout: 'path',
      shape: 'mesh',
      settings: {
        count: 83,
        width: 0.08,
        radius: 2,
        path: 'M 50 50 C -15 -20 -10 120 50 50 C 115 -20 110 120 50 50 Z',
        closed: true,
      },
      palette: rose,
      motions: [sway('rotation.z', 18)],
    },
    {
      name: 'Dust stroke',
      layout: 'path',
      shape: 'dot',
      rotation: [0, 0, 8],
      position: [0, -0.06, -0.09],
      settings: {
        count: 134,
        width: 0.029,
        radius: 2.12,
        path: 'M 50 50 C -15 -20 -10 120 50 50 C 115 -20 110 120 50 50 Z',
        closed: true,
      },
      palette: ['#365977', '#87a4b2'],
      motions: [sway('rotation.z', 4, 20)],
    },
  ),
  design(
    'abstract',
    'Open Scaffold',
    '開放骨格',
    { eye: [2, 2.2, 6.45], bg: '#080d15', ambient: 0.73, rim: '#874ff2' },
    {
      style: 'polygon',
      settings: { radius: 1.7, count: 59 },
      material: { wireframe: true },
      palette: ice,
    },
    {
      style: 'polygon',
      settings: { count: 9, radius: 0.77 },
      motions: [spin('rotation.x', 120)],
      palette: moss,
    },
  ),
  design(
    'abstract',
    'Folded Paper',
    '折り紙',
    { eye: [1, 1, 8] },
    {
      layout: 'spiral',
      shape: 'triangle',
      settings: { count: 45, radius: 1.8, width: 0.23, depth: 0.4, maxHeight: 0.9 },
      rotation: [28, -18, 0],
      palette: chalk,
      motions: [sway('rotation.y', 22)],
    },
    {
      name: 'Counterfold',
      layout: 'spiral',
      shape: 'triangle',
      rotation: [-24, -8, 32],
      settings: { count: 33, radius: 1.34, width: 0.13, depth: 0.22, maxHeight: 0.68, startAngle: 80 },
      palette: ['#6e4964', '#dfa58e', '#fedac1'],
      motions: [sway('rotation.y', -15, 16)],
    },
  ),
]
