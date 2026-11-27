import { useState } from 'react'
import { Music2, Trash2, Upload, Waypoints, ChevronUp, ChevronDown } from 'lucide-react'
import { defaultModulation, defaultMotion, numericBounds } from './model'
import type { AudioFrame } from './analysis'
import type { Layer, Modulation, Motion, Project, Target, Vec3 } from './model'
import { Choice, Numeric, Section, Toggle, translator } from './InspectorFields'
import type { Language, NumericProps } from './InspectorFields'
import { term } from './panelLanguage'

export type AssetImporter = (
  file: File,
  kind: 'image' | 'font',
  attach: (assetId: string) => void,
) => Promise<void>
export function AssetInput({
  label,
  accept,
  onFile,
  remove,
  lang,
}: {
  label: string
  accept: string
  onFile: (file: File) => Promise<void>
  remove?: () => void
  lang: Language
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = translator(lang)
  return (
    <div>
      <div className="ip-inline">
        <label className="ip-file">
          <Upload size={13} />
          {busy ? t('Reading…', '読み込み中…') : label}
          <input
            type="file"
            aria-label={label}
            accept={accept}
            disabled={busy}
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (!file) return
              setError('')
              setBusy(true)
              try {
                await onFile(file)
              } catch (error) {
                setError(
                  t('Could not import file', '読み込みに失敗しました') +
                    ' · ' +
                    String(error instanceof Error ? error.message : error),
                )
              } finally {
                setBusy(false)
              }
            }}
          />
        </label>
        {remove && (
          <button
            onClick={remove}
            title={t('Remove asset', '素材を外す')}
            aria-label={t('Remove asset', '素材を外す')}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="ip-error">
          {error}
        </p>
      )}
    </div>
  )
}

export function BoundNumber({
  field,
  ...props
}: { field: string } & Omit<NumericProps, 'min' | 'max'> & {
    min?: number
    max?: number
  }) {
  const [min, max] = numericBounds(field)
  return <Numeric min={min} max={max} {...props} />
}

export function VectorInputs({
  label,
  field,
  value,
  onChange,
  onPreview,
  linked = false,
}: {
  label: string
  field: string
  value: Vec3
  onChange: (v: Vec3) => void
  onPreview?: (v: Vec3) => void
  linked?: boolean
}) {
  function edit(index: number, v: number): Vec3 {
    const next = [...value] as Vec3
    if (linked)
      return value.map((n) =>
        Math.max(0.001, Math.min(1000, n * (v / Math.max(0.001, value[index])))),
      ) as Vec3
    next[index] = v
    return next
  }
  return (
    <fieldset className="ip-vector">
      <legend>{label}</legend>
      <div>
        {['X', 'Y', 'Z'].map((axis, index) => (
          <BoundNumber
            key={axis}
            field={field + '.' + axis.toLowerCase()}
            label={axis}
            value={value[index]}
            onChange={(v) => onChange(edit(index, v))}
            onPreview={onPreview && ((v) => onPreview(edit(index, v)))}
          />
        ))}
      </div>
    </fieldset>
  )
}

type Bindings = Pick<Project | Layer, 'motions' | 'modulations'>
export function BindingEditor({
  data,
  targets,
  onChange,
  lang,
  getAudioFrame,
}: {
  data: Bindings
  targets: readonly Target[]
  onChange: (delta: Partial<Bindings>) => void
  lang: Language
  getAudioFrame?: () => AudioFrame | undefined
}) {
  const t = translator(lang)
  const fmt = (v: string) => term(lang, v)
  const [showMeters, setShowMeters] = useState(false)
  const frame = showMeters && data.modulations.length ? getAudioFrame?.() : undefined
  const updateMod = (index: number, delta: Partial<Modulation>) =>
    onChange({
      modulations: data.modulations.map((m, i) => (i === index ? { ...m, ...delta } : m)),
    })
  const updateMotion = (index: number, delta: Partial<Motion>) =>
    onChange({
      motions: data.motions.map((m, i) => (i === index ? { ...m, ...delta } : m)),
    })
  const reorder = <T,>(entries: T[], i: number, shift: number) => {
    const result = [...entries]
    const [current] = result.splice(i, 1)
    result.splice(i + shift, 0, current)
    return result
  }
  const controls = (index: number, length: number, move: (step: number) => void, remove: () => void) => (
    <div className="ip-inline ip-end">
      <button
        aria-label={t('Evaluate earlier', '評価順を上げる')}
        disabled={!index}
        onClick={() => move(-1)}
      >
        <ChevronUp size={14} />
      </button>
      <button
        aria-label={t('Evaluate later', '評価順を下げる')}
        disabled={index === length - 1}
        onClick={() => move(1)}
      >
        <ChevronDown size={14} />
      </button>
      <button aria-label={t('Remove mapping', '割り当てを削除')} onClick={remove}>
        <Trash2 size={14} />
      </button>
    </div>
  )
  return (
    <>
      <Section
        onToggle={setShowMeters}
        title={t('Audio mappings', '音声による変調') + ' (' + data.modulations.length + ')'}
      >
        {data.modulations.map((m, i) => (
          <div className="ip-binding" key={i}>
            <Toggle
              label={t('Mapping', '割り当て') + ' ' + (i + 1)}
              value={m.enabled}
              onChange={(enabled) => updateMod(i, { enabled })}
            />
            <Choice
              label={t('Target', '対象')}
              value={m.target}
              values={targets.includes(m.target) ? targets : [m.target, ...targets]}
              format={(v) =>
                targets.includes(v)
                  ? fmt(v)
                  : fmt(v) + ' (' + t('inactive for style', 'このスタイルでは無効') + ')'
              }
              onChange={(target) => updateMod(i, { target })}
            />
            {frame && (
              <label className="ip-meter">
                {t('Input level', '入力レベル')}
                <meter min={0} max={1} value={frame.resolveMod?.(m) ?? 0} />
              </label>
            )}
            <Choice
              label={t('Signal', '信号')}
              value={m.source}
              values={['rms', 'peak', 'onset', 'band']}
              format={fmt}
              onChange={(source) => updateMod(i, { source })}
            />
            <Choice
              label={t('Channel', 'チャンネル')}
              value={m.channel}
              values={['mono', 'left', 'right', 'mid', 'side']}
              format={fmt}
              onChange={(channel) => updateMod(i, { channel })}
            />
            {m.source === 'band' && (
              <>
                <BoundNumber
                  field="lowHz"
                  label={t('Low cutoff', '下限周波数')}
                  unit="Hz"
                  max={m.highHz}
                  value={m.lowHz}
                  onChange={(lowHz) => updateMod(i, { lowHz })}
                />
                <BoundNumber
                  field="highHz"
                  label={t('High cutoff', '上限周波数')}
                  unit="Hz"
                  min={m.lowHz}
                  value={m.highHz}
                  onChange={(highHz) => updateMod(i, { highHz })}
                />
              </>
            )}
            {(
              [
                ['curve', t('Curve exponent', 'カーブ指数')],
                ['sensitivity', t('Sensitivity', '感度')],
                ['offset', t('Offset', 'オフセット')],
                ['min', t('Output floor', '出力下限')],
                ['max', t('Output ceiling', '出力上限')],
                ['attack', t('Attack', 'アタック')],
                ['release', t('Release', 'リリース')],
              ] as const
            ).map(([key, label]) => (
              <BoundNumber
                key={key}
                field={key}
                label={label}
                value={m[key]}
                {...(key === 'min' ? { max: m.max } : key === 'max' ? { min: m.min } : {})}
                unit={key === 'attack' || key === 'release' ? 'ms' : undefined}
                onChange={(v) => updateMod(i, { [key]: v })}
              />
            ))}
            <Toggle
              label={t('Invert', '反転')}
              value={m.invert}
              onChange={(invert) => updateMod(i, { invert })}
            />
            <Choice
              label={t('Combine', '合成方法')}
              value={m.mode}
              values={['add', 'multiply', 'replace']}
              format={fmt}
              onChange={(mode) => updateMod(i, { mode })}
            />
            {controls(
              i,
              data.modulations.length,
              (step) => onChange({ modulations: reorder(data.modulations, i, step) }),
              () =>
                onChange({
                  modulations: data.modulations.filter((_, j) => i !== j),
                }),
            )}
          </div>
        ))}
        <button
          className="ip-action"
          disabled={data.modulations.length >= 32}
          onClick={() =>
            onChange({
              modulations: [...data.modulations, defaultModulation(targets[0])],
            })
          }
        >
          <Music2 size={14} />
          {t('Add audio mapping', '音声変調を追加')}
        </button>
      </Section>
      <Section title={t('Motion', '自動アニメーション') + ' (' + data.motions.length + ')'}>
        {data.motions.map((m, i) => (
          <div className="ip-binding" key={i}>
            <Toggle
              label={t('Motion', '動き') + ' ' + (i + 1)}
              value={m.enabled}
              onChange={(enabled) => updateMotion(i, { enabled })}
            />
            <Choice
              label={t('Target', '対象')}
              value={m.target}
              values={targets.includes(m.target) ? targets : [m.target, ...targets]}
              format={(v) =>
                targets.includes(v)
                  ? fmt(v)
                  : fmt(v) + ' (' + t('inactive for style', 'このスタイルでは無効') + ')'
              }
              onChange={(target) => updateMotion(i, { target })}
            />
            <Choice
              label={t('Wave shape', '波形')}
              value={m.wave}
              values={['sine', 'triangle', 'saw', 'spin', 'noise', 'orbit']}
              format={fmt}
              onChange={(wave) => updateMotion(i, { wave })}
            />
            {(
              [
                ['period', t('Period', '周期'), 's'],
                ['amplitude', t('Amplitude', '振幅'), ''],
                ['phase', t('Phase', '位相'), '°'],
              ] as const
            ).map(([key, label, unit]) => (
              <BoundNumber
                key={key}
                field={key}
                label={label}
                unit={unit}
                value={m[key]}
                onChange={(v) => updateMotion(i, { [key]: v })}
              />
            ))}
            {controls(
              i,
              data.motions.length,
              (step) => onChange({ motions: reorder(data.motions, i, step) }),
              () => onChange({ motions: data.motions.filter((_, j) => i !== j) }),
            )}
          </div>
        ))}
        <button
          className="ip-action"
          disabled={data.motions.length >= 32}
          onClick={() => onChange({ motions: [...data.motions, defaultMotion(targets[0])] })}
        >
          <Waypoints size={14} />
          {t('Add motion', '動きを追加')}
        </button>
      </Section>
    </>
  )
}
