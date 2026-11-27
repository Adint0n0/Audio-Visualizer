import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'en' | 'ja'
export type Translate = (en: string, ja: string) => string
export const translator =
  (lang: Language): Translate =>
  (en, ja) =>
    lang === 'ja' ? ja : en

export function Section({
  title,
  children,
  open = false,
  onToggle,
}: {
  title: string
  children: ReactNode
  open?: boolean
  onToggle?: (open: boolean) => void
}) {
  return (
    <details
      className="ip-section"
      open={open}
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
  const id = useId()
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
  return (
    <div className="ip-numeric">
      <label htmlFor={id}>{label}</label>
      <span className="ip-number-box">
        <input
          id={id}
          type="number"
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
      {slider && (
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
