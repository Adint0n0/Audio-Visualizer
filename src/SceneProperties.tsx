import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { AudioFrame } from './analysis'
import type { Project } from './model'
import { SCENE_TARGETS } from './model'
import { Choice, Color, Section, Toggle, translator } from './InspectorFields'
import type { Language } from './InspectorFields'
import { AssetInput, BindingEditor, BoundNumber, VectorInputs } from './PropertyControls'
import type { AssetImporter } from './PropertyControls'
import { term } from './panelLanguage'

export function SceneProperties({
  project,
  onChange,
  onPreview,
  lang,
  advanced,
  onAsset,
  backgroundIsVideo,
  analysisPanel,
  getAudioFrame,
}: {
  project: Project
  onChange: (p: Project) => void
  onPreview?: (p: Project) => void
  lang: Language
  advanced?: boolean
  onAsset?: AssetImporter
  backgroundIsVideo?: boolean
  analysisPanel?: ReactNode
  getAudioFrame?: () => AudioFrame | undefined
}) {
  const t = translator(lang)
  const fmt = (s: string) => term(lang, s)
  const latest = useRef(project)
  useLayoutEffect(() => {
    latest.current = project
  }, [project])
  const bg = project.background
  const cam = project.camera
  const patchBg = (delta: Partial<typeof bg>) => onChange({ ...project, background: { ...bg, ...delta } })
  const previewBg = (delta: Partial<typeof bg>) =>
    onPreview?.({ ...project, background: { ...bg, ...delta } })
  const patchCam = (delta: Partial<typeof cam>) => onChange({ ...project, camera: { ...cam, ...delta } })
  return (
    <>
      <Section category="background" title={t('Background', '背景')} open>
        <Color label={t('Backdrop', '背景色')} value={bg.color} onChange={(color) => patchBg({ color })} />
        {backgroundIsVideo ? (
          <small className="ip-help">{t('Original video background', '元動画を背景に使用中')}</small>
        ) : (
          onAsset && (
            <AssetInput
              lang={lang}
              label={
                bg.imageId
                  ? t('Replace background', '背景画像を変更')
                  : t('Choose background image', '背景画像を選択')
              }
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              remove={bg.imageId ? () => patchBg({ imageId: null }) : undefined}
              onFile={(file) =>
                onAsset(file, 'image', (imageId) => {
                  const current = latest.current
                  if (current.mediaId !== project.mediaId) return
                  onChange({
                    ...current,
                    background: { ...current.background, imageId },
                  })
                })
              }
            />
          )
        )}
        {(bg.imageId || backgroundIsVideo) && (
          <Choice
            label={t('Image fit', '背景の表示方法')}
            value={bg.fit}
            values={['contain', 'cover', 'stretch']}
            format={fmt}
            onChange={(fit) => patchBg({ fit })}
          />
        )}
        {advanced &&
          (bg.imageId || backgroundIsVideo) &&
          (
            [
              ['zoom', fmt('zoom'), '×'],
              ['x', t('Horizontal offset', '水平位置'), '%'],
              ['y', t('Vertical offset', '垂直位置'), '%'],
              ['rotation', fmt('rotation'), '°'],
              ['brightness', fmt('brightness'), ''],
              ['contrast', t('Contrast', 'コントラスト'), ''],
              ['saturation', t('Saturation', '彩度'), ''],
              ['blur', t('Blur', 'ぼかし'), 'px'],
              ['hue', fmt('hue'), '°'],
            ] as const
          ).map(([key, label, unit]) => (
            <BoundNumber
              key={key}
              field={key}
              label={label}
              unit={unit}
              value={bg[key]}
              onChange={(v) => patchBg({ [key]: v })}
              onPreview={(v) => previewBg({ [key]: v })}
            />
          ))}
      </Section>
      <Section category="camera" title={t('Output camera', '出力カメラ')} open={!advanced}>
        <Choice
          label={t('Projection', '投影法')}
          value={cam.projection}
          values={['perspective', 'orthographic']}
          format={fmt}
          onChange={(projection) => patchCam({ projection })}
        />
        <BoundNumber
          field="zoom"
          label={fmt('zoom')}
          unit="×"
          value={cam.zoom}
          onChange={(zoom) => patchCam({ zoom })}
        />
        {advanced && (
          <>
            <VectorInputs
              label={fmt('position')}
              field="position"
              value={cam.position}
              onChange={(position) => patchCam({ position })}
            />
            <VectorInputs
              label={t('Look at', '注視点')}
              field="position"
              value={cam.target}
              onChange={(target) => patchCam({ target })}
            />
            {cam.projection === 'perspective' ? (
              <BoundNumber
                field="fov"
                label={fmt('fov')}
                value={cam.fov}
                unit="°"
                slider
                onChange={(fov) => patchCam({ fov })}
              />
            ) : (
              <BoundNumber
                field="orthoSize"
                label={t('Ortho size', '正投影サイズ')}
                value={cam.orthoSize}
                onChange={(orthoSize) => patchCam({ orthoSize })}
              />
            )}
            <BoundNumber
              field="near"
              label={t('Near clipping', '近クリップ')}
              max={Math.min(100, cam.far - 0.001)}
              step={0.001}
              value={cam.near}
              onChange={(near) => patchCam({ near })}
            />
            <BoundNumber
              field="far"
              label={t('Far clipping', '遠クリップ')}
              min={Math.max(1, cam.near + 0.001)}
              value={cam.far}
              onChange={(far) => patchCam({ far })}
            />
            <BoundNumber
              field="roll"
              label={fmt('roll')}
              value={cam.roll}
              unit="°"
              onChange={(roll) => patchCam({ roll })}
            />
            <BoundNumber
              field="orbit"
              label={fmt('orbit')}
              value={cam.orbit}
              unit="°"
              onChange={(orbit) => patchCam({ orbit })}
            />
          </>
        )}
      </Section>
      {advanced && (
        <>
          <Section category="lighting" title={t('Lighting', '照明')}>
            {(['ambient', 'directional', 'point', 'spot'] as const).map((key) => {
              const lamp = project.lights[key]
              const patch = (delta: Partial<typeof lamp>) =>
                onChange({
                  ...project,
                  lights: { ...project.lights, [key]: { ...lamp, ...delta } },
                })
              return (
                <Section key={key} title={fmt(key)}>
                  <Color label={fmt('color')} value={lamp.color} onChange={(color) => patch({ color })} />
                  <BoundNumber
                    field="intensity"
                    label={t('Intensity', '強度')}
                    value={lamp.intensity}
                    onChange={(intensity) => patch({ intensity })}
                  />
                  {key !== 'ambient' && (
                    <>
                      <VectorInputs
                        label={fmt('position')}
                        field="position"
                        value={lamp.position}
                        onChange={(position) => patch({ position })}
                      />
                      <Toggle
                        label={t('Cast shadows', '影を落とす')}
                        value={lamp.shadow}
                        onChange={(shadow) => patch({ shadow })}
                      />
                    </>
                  )}
                </Section>
              )
            })}
          </Section>
          <Section category="effects" title={t('Scene effects', 'シーン効果')}>
            {(
              [
                ['bloom', fmt('bloom')],
                ['trail', t('Trails', '残像')],
              ] as const
            ).map(([key, label]) => (
              <BoundNumber
                key={key}
                field={key}
                label={label}
                value={project.effects[key]}
                slider
                onChange={(v) =>
                  onChange({
                    ...project,
                    effects: { ...project.effects, [key]: v },
                  })
                }
              />
            ))}
            <BoundNumber
              field="seed"
              label={t('Random seed', '乱数シード')}
              value={project.seed}
              step={1}
              onChange={(seed) => onChange({ ...project, seed })}
            />
          </Section>
          <BindingEditor
            getAudioFrame={getAudioFrame}
            data={project}
            targets={SCENE_TARGETS}
            onChange={(delta) => onChange({ ...project, ...delta })}
            lang={lang}
          />
          {analysisPanel}
        </>
      )}
    </>
  )
}
