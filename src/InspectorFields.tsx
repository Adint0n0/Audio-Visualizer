import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'

export type Language = 'en' | 'ja'
export type Translate = (en: string, ja: string) => string
export const translator =
  (lang: Language): Translate =>
  (en, ja) =>
    lang === 'ja' ? ja : en

export type Category =
  | 'visual'
  | 'geometry'
  | 'path'
  | 'text'
  | 'image'
  | 'appearance'
  | 'transform'
  | 'audio'
  | 'motion'
  | 'presets'
  | 'background'
  | 'camera'
  | 'lighting'
  | 'effects'
  | 'analysis'
export const PanelContext = createContext<{ lang: Language; category: Category | null }>({
  lang: 'en',
  category: null,
})
const panelQuery = '(max-width: 900px), (max-height: 560px) and (pointer: coarse)'
function watchCompact(callback: () => void) {
  const media = window.matchMedia(panelQuery)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
export function useCompactPanel() {
  return useSyncExternalStore(
    watchCompact,
    () => window.matchMedia(panelQuery).matches,
    () => false,
  )
}

export function Section({
  title,
  children,
  open = false,
  onToggle,
  category,
}: {
  title: string
  children: ReactNode
  open?: boolean
  onToggle?: (open: boolean) => void
  category?: Category
}) {
  const active = useContext(PanelContext).category
  if (active && category && category !== active) return null
  return (
    <details
      className="ip-section"
      data-current-category={(category && active === category) || undefined}
      open={category && active === category ? true : open}
      onToggle={
        onToggle
          ? (e) => {
              if (e.target === e.currentTarget) onToggle(e.currentTarget.open)
            }
          : undefined
      }
    >
      <summary>{title}</summary>
      <div className="ip-section-body">{children}</div>
    </details>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ip-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export interface NumericProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  slider?: boolean
  onChange(value: number): void
  onPreview?(value: number): void
}

// Keep a transient draft while typing or dragging. A completed gesture produces one history entry.
export function Numeric({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  slider,
  onChange,
  onPreview,
}: NumericProps) {
  const { lang, category } = useContext(PanelContext)
  const t = translator(lang)
  const id = useId()
  const gesture = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const original = useRef<number | null>(null)
  const transient = (raw: string) => {
    if (original.current === null) original.current = value
    setDraft(raw)
    const number = Number(raw)
    if (raw.trim() && Number.isFinite(number) && number >= min && number <= max) onPreview?.(number)
  }
  const finish = (raw: string, cancel = false) => {
    const start = original.current
    if (start === null) return
    original.current = null
    setDraft(null)
    const parsed = Number(raw)
    if (cancel || !raw.trim() || !Number.isFinite(parsed)) {
      onPreview?.(start)
      return
    }
    const number = Math.min(max, Math.max(min, step === 1 ? Math.round(parsed) : parsed))
    if (number !== start) onChange(number)
    else onPreview?.(start)
  }
  const quantize = (n: number) =>
    Math.max(min, Math.min(max, Number((min + Math.round((n - min) / step) * step).toPrecision(12))))
  const bump = (sign: 1 | -1) => onChange(quantize(value + sign * step))
  const pointerValue = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = e.currentTarget.getBoundingClientRect()
    const thumbRadius = 12
    const fraction = Math.max(
      0,
      Math.min(1, (e.clientX - track.left - thumbRadius) / Math.max(1, track.width - thumbRadius * 2)),
    )
    return String(quantize(min + fraction * (max - min)))
  }
  const stopTouch = (cancel: boolean, e: React.PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current
    if (!drag || drag.id !== e.pointerId) return
    gesture.current = null
    if (cancel || drag.axis === 'y') {
      finish('', true)
      return
    }
    const raw = pointerValue(e)
    transient(raw)
    finish(raw)
  }
  return (
    <div className="ip-numeric">
      <label htmlFor={id}>{label}</label>
      <span className="ip-stepper">
        {category && (
          <button
            type="button"
            className="ip-step"
            aria-label={label + ' ' + t('decrease', 'を減らす')}
            disabled={value <= min}
            onClick={() => bump(-1)}
          >
            −
          </button>
        )}
        <span className="ip-number-box">
          <input
            id={id}
            type="number"
            inputMode={min < 0 ? 'text' : step === 1 ? 'numeric' : 'decimal'}
            enterKeyHint="done"
            min={min}
            max={max}
            step={step}
            value={draft ?? value}
            onChange={(e) => transient(e.target.value)}
            onBlur={(e) => finish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                finish('', true)
                e.currentTarget.blur()
              }
            }}
          />
          {unit && <small>{unit}</small>}
        </span>
        {category && (
          <button
            type="button"
            className="ip-step"
            aria-label={label + ' ' + t('increase', 'を増やす')}
            disabled={value >= max}
            onClick={() => bump(1)}
          >
            +
          </button>
        )}
      </span>
      {slider && (
        <div
          className="ip-slider-area"
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget || !e.isPrimary || e.button !== 0) return
            gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = gesture.current
            if (!drag || e.pointerId !== drag.id) return
            const dx = Math.abs(e.clientX - drag.x),
              dy = Math.abs(e.clientY - drag.y)
            if (!drag.axis && Math.max(dx, dy) > 7) drag.axis = dx > dy ? 'x' : 'y'
            if (drag.axis === 'x') transient(pointerValue(e))
          }}
          onPointerUp={(e) => stopTouch(false, e)}
          onPointerCancel={(e) => stopTouch(true, e)}
          onLostPointerCapture={(e) => stopTouch(true, e)}
        >
          <input
            className="ip-slider"
            aria-label={label}
            type="range"
            value={Number(draft ?? value)}
            min={min}
            max={max}
            step={step}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onChange={(e) => transient(e.target.value)}
            onPointerUp={(e) => finish(e.currentTarget.value)}
            onPointerCancel={() => finish('', true)}
            onKeyUp={(e) => finish(e.currentTarget.value)}
            onBlur={(e) => finish(e.currentTarget.value)}
          />
        </div>
      )}
    </div>
  )
}

export function Line({
  label,
  value,
  onChange,
  multiline,
  limit = 512,
}: {
  label: string
  value: string
  onChange(value: string): void
  multiline?: boolean
  limit?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const props = {
    value: draft ?? value,
    maxLength: limit,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (draft !== null && e.currentTarget.value !== value) onChange(e.currentTarget.value)
      setDraft(null)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && e.key === 'Enter') e.currentTarget.blur()
    },
  }
  return (
    <Field label={label}>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
    </Field>
  )
}

export function Choice<T extends string>({
  label,
  value,
  values,
  onChange,
  format,
}: {
  label: string
  value: T
  values: readonly T[]
  onChange(value: T): void
  format?: (value: T) => string
}) {
  return (
    <Field label={label}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {values.map((choice) => (
          <option key={choice} value={choice}>
            {format?.(choice) ?? choice}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange(value: boolean): void
}) {
  return (
    <label className="ip-toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Color({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange(value: string): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    const node = input.current
    if (!node) return
    // Native change is emitted when the color picker closes. React change can fire
    // on each intermediate input event while the picker is still open.
    function commit() {
      const color = node!.value
      if (color !== value) onChange(color)
      setDraft(null)
    }
    node.addEventListener('change', commit)
    return () => node.removeEventListener('change', commit)
  }, [value, onChange])
  return (
    <Field label={label}>
      <span className="ip-color">
        <input
          ref={input}
          type="color"
          aria-label={label}
          value={draft ?? value}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <small>{(draft ?? value).toUpperCase()}</small>
      </span>
    </Field>
  )
}
