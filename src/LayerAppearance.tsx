import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { LAYOUTS, MOD_TARGETS, SHAPES, STYLES } from './model'
import type { Layer, Material, Style, VisualSettings } from './model'
import { Choice, Color, Line, Section, Toggle, translator } from './InspectorFields'
import type { Language } from './InspectorFields'
import { AssetInput, BoundNumber } from './PropertyControls'
import type { AssetImporter } from './PropertyControls'
import { readPath, samplePath } from './render/path'
import { PathEditor } from './PathEditor'
import { term } from './panelLanguage'

type NumericSetting = {
  [K in keyof VisualSettings]: VisualSettings[K] extends number ? K : never
}[keyof VisualSettings]
const styleFields: Record<Style, readonly NumericSetting[]> = {
  spectrum: ['width', 'spacing', 'minHeight', 'maxHeight', 'baseline', 'depth'],
  waveform: ['radius', 'maxHeight', 'lineWidth', 'baseline'],
  lissajous: ['radius', 'lineWidth', 'baseline'],
  led: ['rows', 'columns', 'width', 'spacing', 'depth', 'baseline'],
  spectrogram: ['columns', 'history', 'radius', 'baseline'],
  waterfall: ['columns', 'history', 'radius', 'depth', 'minHeight', 'maxHeight', 'baseline'],
  terrain: ['columns', 'history', 'radius', 'depth', 'minHeight', 'maxHeight', 'speed', 'baseline'],
  orb: ['radius', 'maxHeight', 'speed', 'baseline'],
  polygon: ['radius', 'maxHeight', 'speed', 'baseline'],
  tunnel: ['radius', 'depth', 'rows', 'lineWidth', 'startAngle', 'speed', 'baseline'],
  particles: ['lifetime', 'speed', 'gravity', 'spread', 'width', 'radius', 'maxHeight', 'baseline'],
  prism: ['radius', 'speed'],
  galaxy: ['radius', 'spread', 'speed'],
  radial: ['radius', 'width', 'maxHeight', 'speed'],
  diodes: ['rows', 'columns', 'width', 'spacing', 'depth', 'baseline'],
  globe: ['radius', 'maxHeight', 'speed'],
}
const emissiveStyles: readonly Style[] = ['prism', 'galaxy', 'radial', 'diodes', 'globe']
const shaderOnly: readonly Style[] = ['galaxy', 'radial', 'diodes', 'globe']
const hasSurfaceMaterial = (layer: Layer) =>
  layer.kind !== 'visualizer' || !emissiveStyles.includes(layer.style)

const unitFor: Partial<Record<NumericSetting, string>> = {
  lifetime: 's',
  startAngle: '°',
  arc: '°',
  lineWidth: 'px',
}
export type LayerDelta = Partial<Layer> | ((layer: Layer) => Partial<Layer>)
export interface AppearanceProps {
  layer: Layer
  patch: (delta: LayerDelta) => void
  preview?: (delta: Partial<Layer>) => void
  lang: Language
  advanced?: boolean
  onAsset?: AssetImporter
}

function geometryFields(l: Layer) {
  const fields = new Set(styleFields[l.style])
  const orbit = ['circle', 'ellipse', 'arc', 'rings', 'spiral'].includes(l.layout)
  if (l.style === 'spectrum') {
    if (orbit || l.layout === 'sphere' || l.layout === 'path') fields.add('radius')
    if (orbit) {
      fields.add('startAngle')
      fields.add('arc')
    }
    if (l.layout === 'grid') fields.add('columns')
    if (l.shape === 'line') fields.add('lineWidth')
    if (!['line', 'symmetric', 'grid'].includes(l.layout)) fields.delete('spacing')
    if (['cube', 'dot', 'sphere', 'mesh'].includes(l.shape)) {
      fields.delete('minHeight')
      fields.delete('maxHeight')
      if (l.layout !== 'grid') fields.delete('depth')
    }
    if (l.shape === 'ribbon' && l.layout !== 'grid') fields.delete('depth')
  }
  if ((l.style === 'spectrum' || l.style === 'particles') && l.shape === 'rounded') fields.add('corner')
  return fields
}

export function layerModTargets(l: Layer) {
  const fields = geometryFields(l)
  return MOD_TARGETS.filter((target) => {
    if (target.startsWith('settings.')) {
      const key = target.slice(9)
      return l.kind === 'visualizer' && (key === 'gain' || fields.has(key as NumericSetting))
    }
    if (target.startsWith('effects.')) return l.kind !== 'group'
    if (target.startsWith('material.')) {
      return (
        l.kind !== 'group' &&
        (target === 'material.hue' || (hasSurfaceMaterial(l) && l.material.shading !== 'unlit'))
      )
    }
    return true
  })
}

export function ShapeProperties({ layer: l, patch, preview, lang, advanced }: AppearanceProps) {
  const t = translator(lang)
  const fmt = (s: string) => term(lang, s)
  const settings = l.settings
  const update = (delta: Partial<VisualSettings>) => patch({ settings: { ...settings, ...delta } })
  const fields = geometryFields(l)
  const orbit = ['circle', 'ellipse', 'arc', 'rings', 'spiral'].includes(l.layout)
  const [pathError, setPathError] = useState('')
  const applyPath = (raw: string) => {
    const path = readPath(raw)
    if (path.length > 32768) throw new Error(t('Path is too long', 'パスが長すぎます'))
    samplePath(path, 8, settings.closed)
    update({ path })
    setPathError('')
  }
  function numberField(key: NumericSetting, slider = false) {
    return (
      <BoundNumber
        key={key}
        field={key}
        label={
          key === 'count' && l.style === 'galaxy'
            ? t('Star density', '星の密度')
            : key === 'gain'
              ? t('Sensitivity', '感度')
              : fmt(key === 'arc' ? 'arcAngle' : key)
        }
        value={settings[key]}
        slider={slider}
        step={['count', 'rows', 'columns', 'history'].includes(key) ? 1 : 0.01}
        unit={unitFor[key]}
        {...(key === 'minHeight'
          ? { max: settings.maxHeight }
          : key === 'maxHeight'
            ? { min: settings.minHeight }
            : key === 'count' && l.style === 'galaxy'
              ? { min: 22 }
              : key === 'count' && l.style === 'radial'
                ? { min: 24 }
                : key === 'count' && l.style === 'prism'
                  ? { min: 8, max: 160 }
                  : {})}
        onChange={(v) => update({ [key]: v })}
        onPreview={preview && ((v) => preview({ settings: { ...settings, [key]: v } }))}
      />
    )
  }
  return (
    <>
      <Section category="visual" title={t('Visualizer', 'ビジュアライザー')} open>
        <Choice
          label={t('Style', 'スタイル')}
          value={l.style}
          values={STYLES}
          format={fmt}
          onChange={(style) => patch({ style })}
        />
        {advanced && l.style !== 'spectrum' && (
          <small className="ip-help">
            {t('This style uses a dedicated layout.', 'このスタイルは専用の配置を使用します。')}
          </small>
        )}
        {l.style === 'spectrum' && (
          <Choice
            label={t('Layout', '配置')}
            value={l.layout}
            values={LAYOUTS}
            format={fmt}
            onChange={(layout) => patch({ layout })}
          />
        )}
        {(l.style === 'spectrum' || l.style === 'particles') && (
          <Choice
            label={t('Shape', '形状')}
            value={l.shape}
            values={SHAPES}
            format={fmt}
            onChange={(shape) => patch({ shape })}
          />
        )}
        {!['led', 'diodes', 'spectrogram', 'waterfall', 'terrain'].includes(l.style) &&
          numberField('count', true)}
        {numberField('gain', true)}
      </Section>
      {l.style === 'spectrum' && l.layout === 'path' && (
        <Section category="path" title={t('Custom path', 'カスタムパス')} open>
          <Line
            label={t('Path data (SVG d)', 'パスデータ（SVG d）')}
            value={settings.path}
            multiline
            limit={32768}
            onChange={(s) => {
              try {
                applyPath(s)
              } catch {
                setPathError(t('Enter a drawable SVG path.', '描画できる SVG パスを入力してください。'))
              }
            }}
          />
          <AssetInput
            lang={lang}
            label={t('Import SVG path', 'SVG パスを読み込む')}
            accept="image/svg+xml,.svg"
            onFile={async (file) => {
              if (file.size > 100000) throw new Error(t('Maximum size is 100 KB', '上限は 100 KB です'))
              applyPath(await file.text())
            }}
          />
          <PathEditor
            key={settings.path}
            value={settings.path}
            closed={settings.closed}
            lang={lang}
            onChange={(s) => {
              try {
                applyPath(s)
              } catch {
                setPathError(
                  t('Use at least two distinct points.', '異なる制御点を2点以上配置してください。'),
                )
              }
            }}
          />
          {pathError && (
            <small role="alert" className="ip-error">
              {pathError}
            </small>
          )}
          <Toggle label={fmt('closed')} value={settings.closed} onChange={(closed) => update({ closed })} />
          <Toggle
            label={fmt('tangent')}
            value={settings.tangent}
            onChange={(tangent) => update({ tangent })}
          />
        </Section>
      )}
      {advanced && (
        <Section category="geometry" title={t('Geometry', 'ジオメトリ')}>
          {Array.from(fields).map((key) => numberField(key))}
          {!['spectrogram', 'waterfall', 'terrain', 'galaxy', 'globe', 'radial'].includes(l.style) && (
            <Toggle label={fmt('mirror')} value={settings.mirror} onChange={(mirror) => update({ mirror })} />
          )}
          {!['galaxy', 'globe', 'radial'].includes(l.style) && (
            <Toggle
              label={fmt('reverse')}
              value={settings.reverse}
              onChange={(reverse) => update({ reverse })}
            />
          )}
          {l.style === 'spectrum' && (orbit || l.layout === 'sphere') && (
            <Toggle label={fmt('inward')} value={settings.inward} onChange={(inward) => update({ inward })} />
          )}
          {l.style === 'spectrum' && orbit && (
            <Toggle
              label={fmt('tangent')}
              value={settings.tangent}
              onChange={(tangent) => update({ tangent })}
            />
          )}
        </Section>
      )}
    </>
  )
}

export function Appearance({ layer: l, patch, lang, advanced, onAsset }: AppearanceProps) {
  const t = translator(lang),
    fmt = (s: string) => term(lang, s)
  const m = l.material
  const edit = (delta: Partial<Material>) => patch({ material: { ...m, ...delta } })
  const gradient = l.kind === 'visualizer' && m.colorMode !== 'solid'
  const stopEdit = (i: number, delta: Partial<Material['stops'][number]>) =>
    edit({
      stops: m.stops.map((s, j) => (i === j ? { ...s, ...delta } : s)).sort((a, b) => a.at - b.at),
    })
  function addStop() {
    const sorted = m.stops.slice().sort((a, b) => a.at - b.at)
    let start = 0,
      end = sorted[0].at
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[i + 1]?.at ?? 1
      if (next - sorted[i].at > end - start) {
        start = sorted[i].at
        end = next
      }
    }
    edit({
      stops: [...sorted, { at: (start + end) / 2, color: m.color }].sort((a, b) => a.at - b.at),
    })
  }
  return (
    <Section category="appearance" title={t('Appearance', '外観')} open>
      {l.kind === 'visualizer' && (
        <Choice
          label={t('Color mapping', '配色')}
          value={m.colorMode}
          values={['solid', 'frequency', 'height', 'position', 'cycle']}
          format={fmt}
          onChange={(colorMode) => edit({ colorMode })}
        />
      )}
      {(!gradient || (advanced && m.shading !== 'unlit' && hasSurfaceMaterial(l))) && (
        <Color
          label={gradient ? t('Emission color', '発光色') : fmt('color')}
          value={m.color}
          onChange={(color) => edit({ color })}
        />
      )}
      {gradient && (
        <>
          <div
            className="ip-gradient"
            aria-hidden="true"
            style={{
              background:
                m.stops.length === 1
                  ? m.stops[0].color
                  : 'linear-gradient(90deg,' +
                    m.stops.map((s) => s.color + ' ' + s.at * 100 + '%').join(',') +
                    ')',
            }}
          />
          {m.stops.map((s, i) => (
            <div className="ip-stops" key={i}>
              <Color
                label={t('Stop ', '色 ') + (i + 1)}
                value={s.color}
                onChange={(color) => stopEdit(i, { color })}
              />
              {advanced && (
                <>
                  <BoundNumber
                    field="at"
                    value={s.at}
                    label={t('Position', '位置')}
                    onChange={(at) => stopEdit(i, { at })}
                  />
                  <button
                    aria-label={t('Remove color stop', '色を削除')}
                    disabled={m.stops.length === 1}
                    onClick={() => edit({ stops: m.stops.filter((_, j) => i !== j) })}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
          {advanced && (
            <button className="ip-action" disabled={m.stops.length >= 128} onClick={addStop}>
              <Plus size={14} />
              {t('Add color stop', '色を追加')}
            </button>
          )}
        </>
      )}
      <BoundNumber
        field="opacity"
        label={fmt('opacity')}
        value={l.opacity}
        slider
        onChange={(opacity) => patch({ opacity })}
      />
      {advanced && (
        <>
          {hasSurfaceMaterial(l) && (
            <Choice
              label={t('Shading', 'シェーディング')}
              value={m.shading}
              values={['unlit', 'standard', 'glass']}
              format={fmt}
              onChange={(shading) => edit({ shading })}
            />
          )}
          {(['bloom', 'trail'] as const).map((key) => (
            <BoundNumber
              key={key}
              field={key}
              label={
                key === 'bloom' ? t('Layer bloom', 'レイヤーのブルーム') : t('Layer trails', 'レイヤーの残像')
              }
              value={l.effects[key]}
              slider
              onChange={(v) => patch({ effects: { ...l.effects, [key]: v } })}
            />
          ))}
          <Choice
            label={t('Blend mode', 'ブレンドモード')}
            value={m.blend}
            values={['normal', 'add', 'multiply']}
            format={fmt}
            onChange={(blend) => edit({ blend })}
          />
          {hasSurfaceMaterial(l) &&
            m.shading !== 'unlit' &&
            (['metalness', 'roughness', 'emission'] as const).map((key) => (
              <BoundNumber
                key={key}
                field={key}
                label={fmt(key)}
                value={m[key]}
                slider
                onChange={(v) => edit({ [key]: v })}
              />
            ))}
          {l.kind === 'visualizer' && !shaderOnly.includes(l.style) && (
            <Toggle
              label={t('Wireframe', 'ワイヤーフレーム')}
              value={m.wireframe}
              onChange={(wireframe) => edit({ wireframe })}
            />
          )}
          {hasSurfaceMaterial(l) && (
            <Toggle label={t('Shadows', '影')} value={m.shadow} onChange={(shadow) => edit({ shadow })} />
          )}
          {l.kind === 'visualizer' && hasSurfaceMaterial(l) && onAsset && (
            <AssetInput
              lang={lang}
              label={t('Choose texture', 'テクスチャを選択')}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onFile={(f) =>
                onAsset(f, 'image', (textureId) =>
                  patch((current) => ({ material: { ...current.material, textureId } })),
                )
              }
              remove={m.textureId ? () => edit({ textureId: null }) : undefined}
            />
          )}
        </>
      )}
    </Section>
  )
}
