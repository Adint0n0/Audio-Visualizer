import {
  createLayer,
  createProject,
  defaultMotion,
  defaultModulation,
  type Layout,
  type Material,
  type Motion,
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
  create: () => Project
}

const ice = ['#48e7d1', '#99d6ff', '#c0b5ff'],
  amber = ['#ed633b', '#ffae62', '#fff0bd'],
  rose = ['#7e69fd', '#e989c0', '#ffd1b2'],
  moss = ['#389b87', '#95d89f', '#eff9b2'],
  chalk = ['#848eac', '#e3e9f0']
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
}
function buildLayer(design: LayerDesign, i: number) {
  const { settings, material, palette = ice, motions = [], pulse, ...fields } = design
  const l = createLayer('visualizer', design.style)
  Object.assign(l, structuredClone(fields), {
    name: design.name ?? [design.style ?? 'Spectrum', design.layout].filter(Boolean).join(' · '),
    motions: structuredClone(motions),
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
  return {
    id: en.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category,
    name: { en, ja },
    create() {
      const p = createProject(en)
      p.layers = layers.map(buildLayer)
      p.seed = Array.from(en).reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0)
      p.camera.position = stage.eye ? [...stage.eye] : [0, 0, 7.4]
      if (stage.aim) p.camera.target = [...stage.aim]
      if (stage.ortho) {
        p.camera.projection = 'orthographic'
        p.camera.orthoSize = stage.ortho
      }
      if (stage.bg) p.background.color = stage.bg
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
  settings: { lineWidth: 4, ...extras.settings },
})
const led = (rows: number, columns: number, extras: LayerDesign = {}): LayerDesign => ({
  style: 'led',
  settings: { rows, columns, width: 4.4 / columns, spacing: 0.025 },
  ...extras,
})
const terrain = (style: 'terrain' | 'waterfall' | 'spectrogram', extras: LayerDesign = {}): LayerDesign => ({
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
const lens: Stage = { eye: [3, 3.2, 8], aim: [0, 0.2, 0] }
const top: Stage = { eye: [0, 5, 6], aim: [0, 0.2, 0] }
const prism = design(
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
)
export const templates: Template[] = [
  prism,
  design(
    'minimal',
    'Polar Needle',
    '極の針',
    { ortho: 6 },
    {
      shape: 'line',
      settings: { count: 32, width: 0.14, lineWidth: 4, minHeight: 0.12, maxHeight: 1.2 },
      palette: chalk,
    },
  ),
  design(
    'minimal',
    'Quiet Interval',
    '静かな間隔',
    { ortho: 6.4 },
    {
      shape: 'dot',
      layout: 'symmetric',
      settings: { count: 31, width: 0.1, spacing: 0.07 },
      palette: moss,
    },
  ),
  design(
    'minimal',
    'Single Trace',
    '一本の軌跡',
    {},
    waveform({ settings: { count: 128, lineWidth: 3.8, radius: 1.75, maxHeight: 1.1 }, palette: chalk }),
  ),
  design(
    'minimal',
    'Porcelain',
    '白磁',
    {},
    {
      style: 'orb',
      settings: { radius: 1.28, maxHeight: 0.7, speed: 0.2 },
      palette: chalk,
      material: { roughness: 0.1, metalness: 0.3 },
    },
  ),
  design(
    'minimal',
    'Open Dial',
    '開いた文字盤',
    { ortho: 6.5 },
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
  ),

  design(
    'bars',
    'Twin Rail',
    '双軌',
    { ortho: 6.6 },
    {
      layout: 'symmetric',
      position: [0, 0.13, 0],
      settings: { count: 49, width: 0.08, maxHeight: 1.6 },
      palette: amber,
    },
    {
      layout: 'symmetric',
      rotation: [0, 0, 180],
      position: [0, -0.13, 0],
      settings: { count: 49, width: 0.08, maxHeight: 0.95 },
      palette: rose,
    },
  ),
  design('bars', 'Stairwell', '階段室', lens, {
    shape: 'cube',
    rotation: [0, 0, 25],
    settings: { count: 27, width: 0.14, spacing: 0.03, depth: 0.22 },
    palette: moss,
  }),
  design('bars', 'Crystal Organ', '水晶のオルガン', lens, {
    shape: 'triangle',
    settings: { count: 36, width: 0.13, depth: 0.45, minHeight: 0.28, maxHeight: 2.8 },
    material: { metalness: 0.7, roughness: 0.2 },
    palette: ice,
  }),
  design(
    'bars',
    'Comb Filter',
    '櫛状フィルター',
    { ortho: 6 },
    {
      shape: 'line',
      settings: { count: 81, width: 0.048, lineWidth: 1.8, maxHeight: 2.1, minHeight: 0.08 },
      palette: rose,
    },
    waveform({ position: [0, 0.05, 0.1], settings: { radius: 1.95, maxHeight: 0.27 }, palette: chalk }),
  ),
  design(
    'bars',
    'Offset Columns',
    '交差列',
    { eye: [2, 2.3, 8] },
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
    'Halo Index',
    '光輪の目盛',
    {},
    {
      layout: 'circle',
      shape: 'line',
      settings: { count: 96, radius: 1.45, maxHeight: 0.85, minHeight: 0.15, lineWidth: 3 },
      palette: ice,
    },
  ),
  design(
    'radial',
    'Nested Orbit',
    '入れ子軌道',
    {},
    {
      layout: 'rings',
      shape: 'sphere',
      settings: { count: 180, radius: 2.2, width: 0.085 },
      motions: [spin('rotation.z', 60)],
      palette: moss,
    },
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
  ),
  design(
    'radial',
    'East West',
    '東と西',
    {},
    {
      layout: 'arc',
      settings: { arc: 145, startAngle: 18, radius: 1.5, count: 44, maxHeight: 0.95 },
      palette: amber,
    },
    {
      layout: 'arc',
      settings: { arc: 145, startAngle: 198, radius: 1.5, count: 31, maxHeight: 0.75, inward: true },
      palette: ice,
    },
  ),

  design(
    'waves',
    'Oscillograph',
    'オシログラフ',
    { ortho: 5 },
    waveform({ settings: { count: 256, lineWidth: 3, maxHeight: 1.45 }, palette: moss }),
  ),
  design(
    'waves',
    'Phase Portrait',
    '位相の肖像',
    {},
    {
      style: 'lissajous',
      settings: { count: 192, lineWidth: 3.5, radius: 2 },
      palette: rose,
      material: { shading: 'unlit' },
    },
  ),
  design(
    'waves',
    'Crossfeed',
    'クロスフィード',
    {},
    waveform({ rotation: [0, 0, 25], palette: ice }),
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
    {},
    {
      style: 'lissajous',
      scale: [0.95, 0.95, 1],
      settings: { count: 192, lineWidth: 3.5 },
      palette: chalk,
    },
    waveform({ position: [0, -1.45, 0], settings: { maxHeight: 0.45, radius: 1.35 }, palette: rose }),
  ),
  design(
    'waves',
    'Ribbon Stack',
    '重なるリボン',
    lens,
    ...[-1, 0, 1].map((i) =>
      waveform({
        position: [0, i * 0.3, i * 0.8],
        settings: { radius: 1.9, maxHeight: 1.1 + i * 0.22, lineWidth: 3 + i },
        palette: i ? ice : rose,
      }),
    ),
  ),

  design(
    'retro',
    'Level Meter',
    'レベルメーター',
    { ortho: 6 },
    led(14, 32, { palette: moss, material: { colorMode: 'height', shading: 'unlit' } }),
  ),
  design(
    'retro',
    'Cartridge',
    'カートリッジ',
    { eye: [2, 2, 8] },
    led(9, 16, { rotation: [0, -9, 0], palette: amber }),
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
    {},
    led(7, 21, { position: [0, 0.6, 0], palette: ice }),
    led(5, 21, { position: [0, -0.55, 0], rotation: [0, 0, 180], palette: rose }),
  ),
  design(
    'retro',
    'Phosphor Scan',
    '蛍光走査',
    { bg: '#06100d' },
    terrain('spectrogram', { settings: { columns: 28, history: 18, radius: 1.65 }, palette: moss }),
    waveform({ position: [0, 0.1, 0.04], settings: { radius: 1.55, maxHeight: 0.55 }, palette: chalk }),
  ),
  design(
    'retro',
    'Pocket Radio',
    'ポケットラジオ',
    { ortho: 6.8 },
    led(5, 12, { position: [-0.55, 0, 0], scale: [0.65, 0.65, 1], palette: amber }),
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
    { bloom: 0.52, trail: 0.38 },
    {
      style: 'tunnel',
      settings: { rows: 14, radius: 1.7, depth: 0.65, lineWidth: 2 },
      material: { blend: 'add' },
      palette: rose,
    },
  ),
  design(
    'neon',
    'Electric Spine',
    '光る背骨',
    { bloom: 0.45 },
    {
      layout: 'path',
      shape: 'line',
      settings: {
        count: 96,
        radius: 2,
        path: 'M 5 50 C 25 -15 75 115 95 50',
        maxHeight: 0.8,
        lineWidth: 2.8,
      },
      palette: ice,
      motions: [sway('rotation.z', 10)],
    },
  ),
  design(
    'neon',
    'Ion Mesh',
    'イオン格子',
    { bloom: 0.25 },
    {
      style: 'orb',
      material: { wireframe: true, emission: 1 },
      settings: { radius: 1.65, count: 42 },
      palette: moss,
    },
    particle({ settings: { count: 180, width: 0.07, radius: 1, spread: 1.4 }, palette: rose }),
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
  ),
  design(
    'neon',
    'Laser Harp',
    'レーザーハープ',
    { eye: [2, 1.5, 8], bloom: 0.25 },
    {
      layout: 'grid',
      shape: 'line',
      settings: {
        columns: 12,
        count: 72,
        width: 0.22,
        depth: 0.3,
        minHeight: 0.24,
        maxHeight: 2,
        lineWidth: 2,
      },
      palette: ice,
    },
  ),

  design(
    'cinema',
    'Horizon Line',
    '地平線',
    { eye: [0, 1.35, 7], bg: '#111323' },
    terrain('waterfall', {
      settings: { radius: 2.8, depth: 0.5, columns: 80, history: 48, maxHeight: 0.95 },
      palette: chalk,
    }),
  ),
  design(
    'cinema',
    'Slow Eclipse',
    '静かな日食',
    { bg: '#170e16', orbit: 8 },
    {
      style: 'orb',
      settings: { radius: 1.48, maxHeight: 0.7, speed: 0.11 },
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
    { eye: [0, 0.6, 8] },
    particle({
      shape: 'sphere',
      settings: { count: 170, spread: 1.3, radius: 1.3, maxHeight: 3, lifetime: 9, width: 0.078 },
      palette: chalk,
    }),
    {
      style: 'polygon',
      settings: { count: 12, radius: 0.68, maxHeight: 0.5 },
      material: { metalness: 0.9 },
      palette: amber,
    },
  ),
  design(
    'cinema',
    'Dune Study',
    '砂丘習作',
    { eye: [3, 2.2, 7], orbit: 10, bg: '#171216' },
    terrain('terrain', {
      settings: { radius: 2.4, depth: 0.5, maxHeight: 1.45, history: 60, columns: 70 },
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
  ),

  design('grid', 'Block District', 'ブロック街区', lens, {
    layout: 'grid',
    settings: {
      count: 150,
      columns: 15,
      width: 0.2,
      spacing: 0.08,
      depth: 0.2,
      minHeight: 0.07,
      maxHeight: 1.85,
    },
    palette: ice,
  }),
  design('grid', 'Floating Tiles', '浮遊タイル', top, {
    layout: 'grid',
    shape: 'cube',
    settings: { count: 100, columns: 10, width: 0.22, depth: 0.25, spacing: 0.13 },
    palette: moss,
    motions: [sway('rotation.y', 18)],
  }),
  design('grid', 'Needle Field', '針の平原', lens, {
    layout: 'grid',
    shape: 'line',
    settings: {
      count: 400,
      columns: 20,
      width: 0.18,
      depth: 0.17,
      spacing: 0.045,
      maxHeight: 2.5,
      lineWidth: 2,
    },
    palette: rose,
  }),
  design('grid', 'Pyramid Array', 'ピラミッド群', lens, {
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
  }),
  design(
    'grid',
    'Double Deck',
    '二重デッキ',
    { eye: [3, 2.2, 8] },
    {
      layout: 'grid',
      shape: 'dot',
      rotation: [-90, 0, 0],
      settings: { count: 64, columns: 8, width: 0.18, depth: 0.2, spacing: 0.22 },
      palette: chalk,
    },
    {
      layout: 'grid',
      position: [0, -0.85, 0],
      settings: { count: 64, columns: 8, width: 0.2, depth: 0.2, spacing: 0.18, maxHeight: 0.72 },
      palette: ice,
    },
  ),

  design('land', 'Cascade', 'カスケード', top, terrain('waterfall', { palette: ice })),
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
  ),
  design(
    'land',
    'Rift Valley',
    '裂谷',
    { eye: [3, 3.8, 7] },
    terrain('terrain', { position: [-1.15, 0, 0], scale: [0.55, 1, 1], palette: amber }),
    terrain('waterfall', {
      position: [1.15, 0, 0],
      scale: [0.55, 0.75, 1],
      rotation: [0, 180, 0],
      palette: rose,
    }),
  ),
  design(
    'land',
    'Tidal Shelf',
    '潮の棚',
    { eye: [-2.3, 2.8, 7] },
    terrain('waterfall', {
      settings: { columns: 64, history: 70, depth: 0.48, radius: 1.95, maxHeight: 0.85 },
      palette: chalk,
    }),
    particle({
      settings: { count: 130, spread: 1, radius: 1.35, width: 0.072, maxHeight: 1.55 },
      palette: ice,
    }),
  ),

  design(
    'orbit',
    'Liquid Pearl',
    '液体の真珠',
    {},
    {
      style: 'orb',
      settings: { radius: 1.6, count: 100, maxHeight: 1.2 },
      material: { shading: 'glass', roughness: 0.13 },
      palette: rose,
    },
  ),
  design(
    'orbit',
    'Transit Tube',
    '通過管',
    { eye: [0.4, 0.35, 7] },
    {
      style: 'tunnel',
      settings: { rows: 22, radius: 1.65, depth: 0.8, lineWidth: 2.5, count: 48 },
      palette: ice,
    },
  ),
  design(
    'orbit',
    'Orbital Pins',
    '球面ピン',
    { orbit: 18 },
    {
      layout: 'sphere',
      shape: 'triangle',
      settings: { count: 250, radius: 1.25, width: 0.085, maxHeight: 0.6, minHeight: 0.09 },
      palette: moss,
      motions: [spin('rotation.y', 90)],
    },
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
  ),

  design(
    'dust',
    'Fireflies',
    '蛍',
    {},
    particle({
      settings: {
        count: 320,
        width: 0.085,
        spread: 1.1,
        radius: 1.1,
        maxHeight: 3,
        lifetime: 5.5,
        speed: 0.7,
      },
      palette: moss,
      pulse: 'radius',
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
  ),
  design(
    'dust',
    'Fountain',
    '噴水',
    lens,
    particle({
      shape: 'sphere',
      settings: {
        count: 340,
        radius: 0.58,
        spread: 1.35,
        gravity: 6,
        maxHeight: 6,
        lifetime: 2,
        width: 0.078,
      },
      position: [0, 0.75, 0],
      palette: rose,
    }),
  ),
  design(
    'dust',
    'Binary Stars',
    '連星',
    {},
    particle({
      position: [-1.05, 0, 0],
      settings: { count: 190, radius: 0.72, spread: 0.75, width: 0.11, lifetime: 4 },
      palette: amber,
    }),
    particle({
      position: [1.05, 0, 0],
      rotation: [0, 0, 180],
      settings: { count: 240, radius: 0.73, spread: 0.74, width: 0.087, lifetime: 5 },
      palette: ice,
    }),
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
      palette: chalk,
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
  ),
  design(
    'abstract',
    'Open Scaffold',
    '開放骨格',
    lens,
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
  ),
]
