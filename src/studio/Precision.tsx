import { useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { MathUtils, Quaternion, Vector3 } from 'three'
import { numericBounds, type Layer, type Vec3 } from '../model'
import { Dialog } from './Dialog'
import type { Lang } from './hooks'
import { angles, clampTransform, quat, type Projection, type Snap } from './transform'

export function Precision({
  lang,
  layer,
  projection,
  matchScale,
  change,
  close,
}: {
  lang: Lang
  layer: Layer
  projection: () => Projection | null
  matchScale?: () => Vec3 | undefined
  change: (value: Partial<Layer>) => void
  close: () => void
}) {
  const t = (en: string, ja: string) => (lang === 'ja' ? ja : en)
  const [field, setField] = useState<'position' | 'rotation' | 'scale' | 'pivot'>('position')
  const [space, setSpace] = useState<'local' | 'world'>('local')
  const modes = {
    position: t('Position', '位置'),
    rotation: t('Rotation', '回転'),
    scale: t('Scale', '拡大率'),
    pivot: t('Pivot', '回転中心'),
  }
  function set(i: number, value: number) {
    if (!Number.isFinite(value)) return
    const [min, max] = numericBounds(field + '.' + 'xyz'[i])
    const copy = [...layer[field]] as Vec3
    copy[i] = MathUtils.clamp(value, min, max)
    if (field === 'scale' && layer.lockAspect) {
      const ratio = copy[i] / layer.scale[i]
      change({ scale: layer.scale.map((v) => MathUtils.clamp(v * ratio, min, max)) as Vec3 })
      return
    }
    change({ [field]: copy })
  }
  function step(i: number, dir: number) {
    const basis = new Vector3().setComponent(i, 1),
      p = projection()
    if (field === 'rotation') {
      if (space === 'world' && p) basis.applyQuaternion(p.parent.clone().invert())
      const current = quat(layer.rotation),
        delta = new Quaternion().setFromAxisAngle(basis, MathUtils.degToRad(5 * dir))
      change({ rotation: angles(space === 'local' ? current.multiply(delta) : delta.multiply(current)) })
    } else if (field === 'position') {
      if (space === 'world' && p) basis.copy(p.localFromWorld(basis).sub(p.localFromWorld(new Vector3())))
      if (space === 'local') basis.applyQuaternion(quat(layer.rotation))
      const v = new Vector3(...layer.position).addScaledVector(basis, 0.1 * dir)
      change({ position: clampTransform('position', v.toArray() as Vec3) })
    } else set(i, layer[field][i] + 0.05 * dir)
  }
  return (
    <Dialog title={t('Precise transform', '精密変形')} lang={lang} close={close}>
      <div className="precision-tabs">
        {Object.entries(modes).map(([id, label]) => (
          <button
            key={id}
            className="btn"
            aria-pressed={id === field}
            onClick={() => setField(id as typeof field)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="precision-space">
        {(field === 'position' || field === 'rotation') && (
          <label>
            {t('Adjustment axes', '調整軸')}{' '}
            <select value={space} onChange={(e) => setSpace(e.target.value as typeof space)}>
              <option value="local">{t('Local', 'ローカル')}</option>
              <option value="world">{t('World', 'ワールド')}</option>
            </select>
          </label>
        )}
        <span>
          {field === 'scale' || field === 'pivot'
            ? t('Layer-local axes', 'レイヤーのローカル軸')
            : t('Fields use parent coordinates', '数値欄は親座標')}
        </span>
      </div>
      {layer[field].map((value, i) => (
        <div className="precision-row" key={field + i}>
          <button
            className="btn"
            aria-label={t('Decrease', '減らす') + ' ' + 'XYZ'[i]}
            onClick={() => step(i, -1)}
          >
            <Minus size={18} />
          </button>
          <label>
            {'XYZ'[i]}
            <input
              key={field + i + value}
              type="number"
              inputMode="decimal"
              step="any"
              defaultValue={Number(value.toFixed(4))}
              onBlur={(e) => {
                if (e.target.valueAsNumber !== Number(value.toFixed(4))) set(i, e.target.valueAsNumber)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </label>
          <button
            className="btn"
            aria-label={t('Increase', '増やす') + ' ' + 'XYZ'[i]}
            onClick={() => step(i, 1)}
          >
            <Plus size={18} />
          </button>
        </div>
      ))}
      <div className="dialog-actions">
        {field === 'scale' && (
          <>
            <button
              className="btn"
              aria-pressed={layer.lockAspect}
              onClick={() => change({ lockAspect: !layer.lockAspect })}
            >
              {t('Lock proportions', '比率を固定')}
            </button>
            {matchScale && (
              <button
                className="btn"
                onClick={() => {
                  const scale = matchScale()
                  if (scale) change({ scale })
                }}
              >
                {t('Match neighboring width', '隣のレイヤーと幅を揃える')}
              </button>
            )}
          </>
        )}
        <button
          className="btn"
          onClick={() => change({ [field]: field === 'scale' ? [1, 1, 1] : [0, 0, 0] })}
        >
          <RotateCcw size={16} />
          {t('Reset', 'リセット')} {modes[field]}
        </button>
      </div>
    </Dialog>
  )
}
export function SnapSettings({
  lang,
  snap,
  change,
  close,
}: {
  lang: Lang
  snap: Snap
  change: (snap: Snap) => void
  close: () => void
}) {
  const t = (en: string, ja: string) => (lang === 'ja' ? ja : en)
  const toggles = {
    enabled: t('Snapping', 'スナップ'),
    canvas: t('Canvas edges and center', 'キャンバスの辺と中心'),
    neighbors: t('Layer edges and centers', '他レイヤーの辺と中心'),
    grid: t('Coordinate grid (0.25 units)', '座標グリッド（0.25単位）'),
    haptic: t('Vibration if supported', '対応端末で振動'),
  }
  const angleSteps = [0, 1, 5, 10, 15, 30, 45, 90]
  const changeNumber = (key: 'angle' | 'scale' | 'distance', value: number, max: number) =>
    change({ ...snap, [key]: MathUtils.clamp(value || 0, 0, max) })
  return (
    <Dialog title={t('Snap guides', 'スナップガイド')} lang={lang} close={close}>
      <div className="snap-settings">
        {(Object.keys(toggles) as (keyof typeof toggles)[]).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={snap[key]}
              onChange={(e) => change({ ...snap, [key]: e.target.checked })}
            />
            {toggles[key]}
          </label>
        ))}
        <label>
          {t('Guide distance (px)', '吸着距離 (px)')}
          <input
            type="number"
            min="0"
            max="30"
            value={snap.distance}
            onChange={(e) => changeNumber('distance', +e.target.value, 30)}
          />
        </label>
        <label>
          {t('Angle step (°)', '角度の刻み (°)')}
          <select
            aria-label={t('Angle preset', '角度プリセット')}
            value={angleSteps.includes(snap.angle) ? snap.angle : 'custom'}
            onChange={(e) => {
              if (e.target.value !== 'custom') changeNumber('angle', +e.target.value, 180)
            }}
          >
            {angleSteps.map((angle) => (
              <option key={angle} value={angle}>
                {angle ? angle + '°' : t('Off', 'オフ')}
              </option>
            ))}
            <option value="custom" disabled>
              {t('Custom', 'カスタム')}
            </option>
          </select>
          <input
            aria-label={t('Angle step (°)', '角度の刻み (°)')}
            type="number"
            min="0"
            max="180"
            value={snap.angle}
            onChange={(e) => changeNumber('angle', +e.target.value, 180)}
          />
        </label>
        <label>
          {t('Additional scale step (%)', '倍率の追加刻み (%)')}
          <input
            type="number"
            min="0"
            max="500"
            value={snap.scale * 100}
            onChange={(e) => changeNumber('scale', +e.target.value / 100, 5)}
          />
        </label>
      </div>
    </Dialog>
  )
}
