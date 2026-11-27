import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ClipboardPaste, Copy, Download, Lock, RotateCcw } from 'lucide-react'
import { createLayer } from './model'
import type { AudioFrame } from './analysis'
import type { Layer, Project } from './model'
import { loadLayerPreset, saveLayerPreset } from './storage'
import type { PanelProps } from './Layers'
import {
  Choice,
  Color,
  Field,
  Line,
  Section,
  Toggle,
  translator,
  PanelContext,
  useCompactPanel,
  type Category,
} from './InspectorFields'
import { AssetInput, BindingEditor, BoundNumber, VectorInputs } from './PropertyControls'
import type { AssetImporter } from './PropertyControls'
import { Appearance, layerModTargets, ShapeProperties, type LayerDelta } from './LayerAppearance'
import { SceneProperties } from './SceneProperties'
import { term } from './panelLanguage'
import './panels.css'

export interface InspectorProps extends PanelProps {
  onPreview?: (p: Project) => void
  onAsset?: AssetImporter
  analysisPanel?: ReactNode
  backgroundIsVideo?: boolean
  getAudioFrame?: () => AudioFrame | undefined
}

function isDescendant(parent: Layer, id: string, layers: Layer[]) {
  const visited = new Set<string>()
  for (let l: Layer | undefined = parent; l; l = layers.find((p) => p.id === l?.parentId)) {
    if (l.id === id || visited.has(l.id)) return true
    visited.add(l.id)
  }
  return false
}

function copyable(layer: Layer) {
  const { style, layout, shape, settings, material, text, imageId, effects, modulations, motions, opacity } =
    layer
  return structuredClone({
    style,
    layout,
    shape,
    settings,
    material,
    text,
    imageId,
    effects,
    modulations,
    motions,
    opacity,
  })
}

export function Inspector(props: InspectorProps) {
  const { project, selection, onChange, onPreview, lang, advanced, onAsset } = props
  const t = translator(lang),
    fmt = (s: string) => term(lang, s)
  const [tab, setTab] = useState<'object' | 'scene'>('object')
  const [copied, setCopied] = useState<Layer | null>(null)
  const live = useRef(project)
  useLayoutEffect(() => {
    live.current = project
  }, [project])
  const l = project.layers.find((layer) => layer.id === selection[selection.length - 1])
  const page = !l || tab === 'scene' ? 'scene' : 'object'
  const compact = useCompactPanel()
  const [chosenCategory, chooseCategory] = useState<Category | null>(null)
  const categories: { id: Category; label: string }[] = []
  function add(id: Category, en: string, ja: string) {
    categories.push({ id, label: t(en, ja) })
  }
  if (page === 'scene') {
    add('background', 'Background', '背景')
    add('camera', 'Output camera', '出力カメラ')
    if (advanced) {
      add('lighting', 'Lighting', '照明')
      add('effects', 'Scene effects', 'シーン効果')
    }
  } else if (l && !l.locked) {
    if (l.kind === 'visualizer') {
      add('visual', 'Visualizer', 'ビジュアライザー')
      if (l.style === 'spectrum' && l.layout === 'path') add('path', 'Custom path', 'カスタムパス')
      if (advanced) add('geometry', 'Geometry', 'ジオメトリ')
    }
    if (l.kind === 'text') add('text', 'Text', 'テキスト')
    if (l.kind === 'image' && onAsset) add('image', 'Image', '画像')
    if (l.kind !== 'group') add('appearance', 'Appearance', '外観')
    add('transform', 'Transform', 'トランスフォーム')
  }
  if (advanced && (page === 'scene' || (l && !l.locked))) {
    add('audio', 'Audio mappings', '音声による変調')
    add('motion', 'Motion', '自動アニメーション')
    if (page === 'object') add('presets', 'Layer settings', 'レイヤー設定')
    if (page === 'scene' && props.analysisPanel) add('analysis', 'Audio analysis', '音声解析')
  }
  const category = compact
    ? ((categories.find((c) => c.id === chosenCategory) ?? categories[0])?.id ?? null)
    : null
  function mutate(layerId: string, delta: LayerDelta, apply: (p: Project) => void) {
    const p = live.current
    if (!p.layers.some((layer) => layer.id === layerId && !layer.locked)) return
    apply({
      ...p,
      layers: p.layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              ...(typeof delta === 'function' ? delta(layer) : delta),
            }
          : layer,
      ),
    })
  }
  function patch(delta: LayerDelta) {
    if (l) mutate(l.id, delta, onChange)
  }
  const preview =
    onPreview &&
    ((delta: Partial<Layer>) => {
      if (l) mutate(l.id, delta, onPreview)
    })
  const editText = (delta: Partial<Layer['text']>) => {
    if (l) patch((current) => ({ text: { ...current.text, ...delta } }))
  }
  function presetDownload(layer: Layer) {
    const blob = saveLayerPreset(layer),
      url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (layer.name.replace(/[\\/:*?"<>|]/g, '-') || 'layer') + '.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 15000)
  }
  const panel = (
    <section className="ip-panel" aria-label={t('Properties', 'プロパティ')}>
      <div className="ip-tabs">
        <button aria-pressed={page === 'object'} disabled={!l} onClick={() => setTab('object')}>
          {t('Layer', 'レイヤー')}
        </button>
        <button aria-pressed={page === 'scene'} onClick={() => setTab('scene')}>
          {t('Scene', 'シーン')}
        </button>
      </div>
      {compact && categories.length > 0 && (
        <label className="ip-category">
          <span>{t('Category', '設定項目')}</span>
          <select
            aria-label={t('Settings category', '設定カテゴリー')}
            value={category ?? ''}
            onChange={(e) => {
              chooseCategory(e.currentTarget.value as Category)
              e.currentTarget.closest('.dock-scroll')?.scrollTo({ top: 0 })
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ip-scroll">
        {page === 'scene' ? (
          <SceneProperties {...props} />
        ) : (
          l && (
            <div key={l.id}>
              <div className="ip-layer-caption">
                <span className="ip-dot" />
                <strong>{l.name}</strong>
                {l.locked && <Lock size={13} aria-label={t('Locked', 'ロック中')} />}
              </div>
              {l.locked ? (
                <button
                  className="ip-action"
                  onClick={() =>
                    onChange({
                      ...project,
                      layers: project.layers.map((v) => (v.id === l.id ? { ...v, locked: false } : v)),
                    })
                  }
                >
                  {t('Unlock to edit', 'ロック解除して編集')}
                </button>
              ) : (
                <>
                  {l.kind === 'visualizer' && (
                    <ShapeProperties
                      layer={l}
                      patch={patch}
                      preview={preview}
                      lang={lang}
                      advanced={advanced}
                    />
                  )}
                  {l.kind === 'text' && (
                    <Section category="text" title={t('Text', 'テキスト')} open>
                      <Line
                        label={t('Content', '内容')}
                        multiline
                        value={l.text.content}
                        limit={4096}
                        onChange={(content) => editText({ content })}
                      />
                      <Choice
                        label={t('Typeface', 'フォント')}
                        value={l.text.font}
                        values={Array.from(
                          new Set([
                            l.text.font,
                            'sans-serif',
                            'serif',
                            'monospace',
                            'DM Sans Variable',
                            'IBM Plex Mono',
                          ]),
                        )}
                        format={(v) =>
                          l.text.fontId && v === l.text.font ? t('Imported font', '読み込みフォント') : v
                        }
                        onChange={(font) => editText({ font, fontId: null })}
                      />
                      {onAsset && (
                        <AssetInput
                          lang={lang}
                          label={t('Load local font', '端末のフォントを読み込む')}
                          accept=".ttf,.otf,.woff,.woff2"
                          onFile={(file) =>
                            onAsset(file, 'font', (id) => editText({ fontId: id, font: 'asset-' + id }))
                          }
                        />
                      )}
                      <BoundNumber
                        field="size"
                        label={t('Text size', '文字サイズ')}
                        value={l.text.size}
                        onChange={(size) => editText({ size })}
                      />
                      <Choice
                        label={t('Align', '揃え')}
                        value={l.text.align}
                        values={['left', 'center', 'right']}
                        format={fmt}
                        onChange={(align) => editText({ align })}
                      />
                      {advanced && (
                        <>
                          {(
                            [
                              ['tracking', t('Letter spacing', '字間')],
                              ['leading', t('Line height', '行間')],
                              ['strokeWidth', t('Outline width', '縁取り幅')],
                              ['shadow', t('Shadow blur', '影のぼかし')],
                            ] as const
                          ).map(([key, label]) => (
                            <BoundNumber
                              key={key}
                              field={key}
                              label={label}
                              value={l.text[key]}
                              onChange={(v) => editText({ [key]: v })}
                            />
                          ))}
                          <Color
                            label={t('Outline color', '縁取り色')}
                            value={l.text.stroke}
                            onChange={(stroke) => editText({ stroke })}
                          />
                        </>
                      )}
                    </Section>
                  )}
                  {l.kind === 'image' && onAsset && (
                    <Section category="image" title={t('Image', '画像')} open>
                      <AssetInput
                        lang={lang}
                        label={l.imageId ? t('Replace image', '画像を変更') : t('Choose image', '画像を選択')}
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onFile={(f) => onAsset(f, 'image', (imageId) => patch({ imageId }))}
                        remove={l.imageId ? () => patch({ imageId: null }) : undefined}
                      />
                    </Section>
                  )}
                  {l.kind !== 'group' && (
                    <Appearance layer={l} patch={patch} lang={lang} advanced={advanced} onAsset={onAsset} />
                  )}
                  <Section
                    category="transform"
                    title={t('Transform', 'トランスフォーム')}
                    open={l.kind === 'group'}
                  >
                    {(
                      ['position', 'rotation', 'scale', ...(advanced ? (['pivot'] as const) : [])] as const
                    ).map((key) => (
                      <VectorInputs
                        label={fmt(key) + (key === 'rotation' ? ' (°)' : '')}
                        key={key}
                        field={key}
                        value={l[key]}
                        linked={key === 'scale' && l.lockAspect}
                        onChange={(v) => patch({ [key]: v })}
                        onPreview={preview && ((v) => preview({ [key]: v }))}
                      />
                    ))}
                    {l.kind === 'group' && (
                      <BoundNumber
                        field="opacity"
                        label={fmt('opacity')}
                        value={l.opacity}
                        slider
                        onChange={(opacity) => patch({ opacity })}
                      />
                    )}
                    <Toggle
                      label={t('Uniform scaling', '等比スケール')}
                      value={l.lockAspect}
                      onChange={(lockAspect) => patch({ lockAspect })}
                    />
                    {advanced && (
                      <>
                        <Toggle
                          label={t('Screen space', '画面に固定')}
                          value={l.screenSpace}
                          onChange={(screenSpace) => patch({ screenSpace })}
                        />
                        <Toggle
                          label={t('Depth test', '深度テスト')}
                          value={l.depthTest}
                          onChange={(depthTest) => patch({ depthTest })}
                        />
                        <Field label={t('Parent group', '親グループ')}>
                          <select
                            value={l.parentId ?? ''}
                            onChange={(e) => patch({ parentId: e.target.value || null })}
                          >
                            <option value="">{t('Scene root', 'シーン直下')}</option>
                            {project.layers
                              .filter((p) => p.kind === 'group' && !isDescendant(p, l.id, project.layers))
                              .map((p) => (
                                <option value={p.id} key={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </Field>
                      </>
                    )}
                    <button
                      className="ip-action"
                      onClick={() =>
                        patch({
                          position: [0, 0, 0],
                          rotation: [0, 0, 0],
                          scale: [1, 1, 1],
                          pivot: [0, 0, 0],
                        })
                      }
                    >
                      <RotateCcw size={13} />
                      {t('Reset transform', '変形をリセット')}
                    </button>
                  </Section>
                  {advanced && (
                    <>
                      <BindingEditor
                        getAudioFrame={props.getAudioFrame}
                        lang={lang}
                        data={l}
                        targets={layerModTargets(l)}
                        onChange={patch}
                      />
                      <Section category="presets" title={t('Layer settings', 'レイヤー設定')}>
                        <Line
                          label={t('Layer name', 'レイヤー名')}
                          limit={180}
                          value={l.name}
                          onChange={(name) => patch({ name: name.trim() || fmt(l.kind) })}
                        />
                        <button className="ip-action" onClick={() => setCopied(structuredClone(l))}>
                          <Copy size={13} />
                          {t('Copy settings', '設定をコピー')}
                        </button>
                        <button
                          className="ip-action"
                          disabled={copied?.kind !== l.kind}
                          onClick={() => {
                            if (copied?.kind === l.kind) patch(copyable(copied))
                          }}
                        >
                          <ClipboardPaste size={13} />
                          {t('Paste settings', '設定を貼り付け')}
                        </button>
                        <button className="ip-action" onClick={() => presetDownload(l)}>
                          <Download size={13} />
                          {t('Save layer preset', 'レイヤープリセットを保存')}
                        </button>
                        <AssetInput
                          lang={lang}
                          label={t('Load layer preset', 'レイヤープリセットを読み込む')}
                          accept=".json,application/json"
                          onFile={async (file) => {
                            const loaded = await loadLayerPreset(file)
                            if (loaded.kind !== l.kind)
                              throw new Error(
                                t(
                                  'Choose a preset of the same layer type',
                                  '同じ種類のレイヤープリセットを選択してください',
                                ),
                              )
                            patch({ ...loaded, id: l.id, parentId: l.parentId })
                          }}
                        />
                        <button
                          className="ip-action"
                          onClick={() => patch(copyable(createLayer(l.kind, l.style)))}
                        >
                          <RotateCcw size={13} />
                          {t('Reset appearance and mappings', '外観と変調をリセット')}
                        </button>
                      </Section>
                    </>
                  )}
                </>
              )}
            </div>
          )
        )}
      </div>
    </section>
  )
  return <PanelContext.Provider value={{ lang, category }}>{panel}</PanelContext.Provider>
}
