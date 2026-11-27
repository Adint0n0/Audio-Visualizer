import { createLayer, parseLayer, type Style, type Layer, type VisualSettings } from '../model'
import { createElements } from './elements'
import { createOrb, createCurve, createField } from './surfaces'
import { createPrism } from './prism'
import { createGalaxy } from './galaxy'
import { createRadial } from './radial'
import { createGlobe } from './globe'
import { createDiodes } from './diodes'
import type { Visual } from './common'

type Field = keyof VisualSettings
export interface RenderPlugin {
  readonly style: Style
  readonly fields: readonly Field[]
  defaults: () => Layer
  validate: (value: unknown) => Layer
  create: (layer: Layer) => Visual
}
const common: Field[] = ['gain', 'minHeight', 'maxHeight', 'baseline', 'reverse', 'mirror']
const curve: Field[] = ['count', 'radius', 'lineWidth', 'speed']
const field: Field[] = ['columns', 'history', 'radius', 'depth']
function define(style: Style, create: RenderPlugin['create'], fields: Field[]): RenderPlugin {
  return {
    style,
    fields,
    create,
    defaults: () => createLayer('visualizer', style),
    validate(value) {
      const l = parseLayer(value)
      if (l.style !== style || l.kind !== 'visualizer') throw Error('Unexpected visualizer plugin')
      return l
    },
  }
}
export const plugins: Readonly<Record<Style, RenderPlugin>> = {
  galaxy: define('galaxy', createGalaxy, ['count', 'radius', 'gain', 'speed', 'spread']),
  radial: define('radial', createRadial, ['count', 'radius', 'gain', 'speed', 'width', 'maxHeight']),
  globe: define('globe', createGlobe, ['count', 'radius', 'gain', 'speed', 'maxHeight']),
  diodes: define('diodes', createDiodes, [
    'rows',
    'columns',
    'width',
    'spacing',
    'depth',
    'baseline',
    'gain',
    'reverse',
    'mirror',
  ]),
  spectrum: define('spectrum', createElements, [
    ...common,
    'count',
    'radius',
    'width',
    'spacing',
    'depth',
    'startAngle',
    'arc',
    'columns',
    'inward',
    'corner',
    'lineWidth',
    'path',
    'closed',
    'tangent',
  ]),
  led: define('led', createElements, [...common, 'rows', 'columns', 'spacing', 'width', 'depth']),
  particles: define('particles', createElements, [
    ...common,
    'count',
    'radius',
    'width',
    'lifetime',
    'gravity',
    'speed',
    'spread',
  ]),
  prism: define('prism', createPrism, ['count', 'radius', 'gain', 'speed']),
  waveform: define('waveform', createCurve, [...common, ...curve]),
  lissajous: define('lissajous', createCurve, [...common, ...curve]),
  tunnel: define('tunnel', createCurve, [...common, ...curve, 'rows', 'depth', 'startAngle']),
  waterfall: define('waterfall', createField, [...common, ...field]),
  spectrogram: define('spectrogram', createField, [...common, ...field]),
  terrain: define('terrain', createField, [...common, ...field, 'speed']),
  orb: define('orb', createOrb, [...common, 'radius', 'count', 'speed']),
  polygon: define('polygon', createOrb, [...common, 'radius', 'count', 'speed']),
}
