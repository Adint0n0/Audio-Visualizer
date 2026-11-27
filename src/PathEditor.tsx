import { useRef, useState } from 'react'
import { Check, Plus, Minus, Spline } from 'lucide-react'
import { samplePath } from './render/path'
import { Numeric, translator } from './InspectorFields'
import type { Language } from './InspectorFields'

type Point = [number, number]
const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10))

export function PathEditor({
  value,
  closed,
  lang,
  onChange,
}: {
  value: string
  closed: boolean
  lang: Language
  onChange: (path: string) => void
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [index, setIndex] = useState(0)
  const [invalid, setInvalid] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const t = translator(lang)
  function start() {
    try {
      // Sampling is explicit. Curved paths keep their original Béziers until Apply.
      setPoints(samplePath(value, 12, closed).map((p) => [clamp(50 + p.x * 44), clamp(50 - p.y * 44)]))
      setIndex(0)
      setInvalid(false)
    } catch {
      setInvalid(true)
    }
  }
  function place(i: number, p: Point) {
    setPoints((old) => old?.map((v, j) => (i === j ? p : v)) ?? null)
  }
  function move(e: React.PointerEvent) {
    const transform = svg.current?.getScreenCTM()
    if (!transform || drag.current === null) return
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(transform.inverse())
    place(drag.current, [clamp(point.x), clamp(point.y)])
  }
  if (!points)
    return (
      <>
        <button className="ip-action" onClick={start}>
          <Spline size={13} />
          {t('Edit as polyline', '折れ線として編集')}
        </button>
        {invalid && (
          <small role="alert">{t('Path has no drawable length', '描画できる長さがありません')}</small>
        )}
      </>
    )
  const d = points.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(' ') + (closed ? ' Z' : '')
  return (
    <div className="ip-path-edit">
      <svg
        ref={svg}
        viewBox="-6 -6 112 112"
        aria-label={t('Editable polyline', '編集用折れ線')}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
        {points.map(([cx, cy], i) => (
          <g
            key={i}
            onPointerDown={(e) => {
              e.preventDefault()
              setIndex(i)
              drag.current = i
              svg.current?.setPointerCapture(e.pointerId)
            }}
          >
            <circle cx={cx} cy={cy} r={5} fill="transparent" />
            <circle
              cx={cx}
              cy={cy}
              r={i === index ? 2.5 : 1.7}
              fill={i === index ? '#fff' : 'currentColor'}
            />
          </g>
        ))}
      </svg>
      <label>
        {t('Control point', '制御点')}{' '}
        <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
          {points.map((_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      {(['X', 'Y'] as const).map((axis, i) => (
        <Numeric
          key={axis}
          label={axis}
          min={0}
          max={100}
          step={0.1}
          value={points[index][i]}
          onChange={(v) => place(index, i === 0 ? [v, points[index][1]] : [points[index][0], v])}
        />
      ))}
      <div className="ip-inline">
        <button
          aria-label={t('Insert point', '制御点を追加')}
          disabled={points.length >= 100}
          onClick={() => {
            const p = points[index],
              next = points[index + 1] ?? (closed ? points[0] : p),
              insert: Point = [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2]
            const result = [...points]
            result.splice(index + 1, 0, insert)
            setPoints(result)
            setIndex(index + 1)
          }}
        >
          <Plus size={14} />
        </button>
        <button
          aria-label={t('Remove point', '制御点を削除')}
          disabled={points.length <= 2}
          onClick={() => {
            setPoints(points.filter((_, i) => i !== index))
            setIndex(Math.max(0, index - 1))
          }}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => {
            onChange(d)
            setPoints(null)
          }}
        >
          <Check size={14} />
          {t('Apply path', '適用')}
        </button>
        <button onClick={() => setPoints(null)}>{t('Cancel', '取消')}</button>
      </div>
    </div>
  )
}
