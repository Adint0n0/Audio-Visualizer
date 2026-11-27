import { useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  ChevronDown,
  FileMusic,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Scissors,
  Upload,
} from 'lucide-react'
import type { MediaSourceData } from '../media'
import type { Lang } from './hooks'
export function clock(seconds: number, precise = false) {
  const ms = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * 1000))
  return (
    String(Math.floor(ms / 60000)).padStart(2, '0') +
    ':' +
    String(Math.floor(ms / 1000) % 60).padStart(2, '0') +
    (precise ? '.' + String(ms % 1000).padStart(3, '0') : '')
  )
}
type Props = {
  lang: Lang
  media: MediaSourceData | null
  time: number
  playing: boolean
  play: () => void
  seek: (n: number) => void
  range: [number, number]
  setRange: (v: [number, number]) => void
  previewRange: (v: [number, number] | null) => void
  loop: boolean
  setLoop: (b: boolean) => void
  mute: boolean
  setMute: (b: boolean) => void
  importFile: () => void
}
export function Timeline({
  lang,
  media,
  time,
  playing,
  play,
  seek,
  range,
  setRange,
  previewRange,
  loop,
  setLoop,
  mute,
  setMute,
  importFile,
}: Props) {
  const ja = lang === 'ja',
    duration = media?.duration || 0
  const canvas = useRef<HTMLCanvasElement>(null)
  const [editRange, setEditRange] = useState(false)
  const draft = useRef<[number, number] | null>(null)
  const drag = useRef<'start' | 'end' | 'seek' | null>(null)
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      const w = Math.max(1, el.clientWidth),
        h = Math.max(1, el.clientHeight),
        ratio = window.devicePixelRatio || 1
      el.width = w * ratio
      el.height = h * ratio
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      const peaks = media?.waveform
      ctx.fillStyle = '#79c5aa'
      if (peaks?.length)
        for (let x = 1; x < w; x += 3) {
          const start = Math.floor((x / w) * peaks.length),
            end = Math.min(peaks.length, Math.max(start + 1, Math.floor(((x + 3) / w) * peaks.length)))
          let peak = 0
          for (let i = start; i < end; i++) peak = Math.max(peak, peaks[i])
          const amp = Math.max(1, Math.min(1, peak * 1.35) * (h - 5))
          ctx.fillRect(x, (h - amp) / 2, 2, amp)
        }
    }
    const observer = new ResizeObserver(draw)
    observer.observe(el)
    draw()
    return () => observer.disconnect()
  }, [media])
  const pct = (s: number) => (duration ? Math.min(100, Math.max(0, (100 * s) / duration)) : 0)
  const adjust = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(),
      t = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration))
    if (drag.current === 'start')
      previewRange((draft.current = [Math.min(t, Math.max(0, range[1] - 0.05)), range[1]]))
    if (drag.current === 'end')
      previewRange((draft.current = [range[0], Math.max(t, Math.min(duration, range[0] + 0.05))]))
    if (drag.current === 'seek') seek(t)
  }
  return (
    <section className="timeline">
      <div className="timeline-head">
        <h2>
          <AudioLines size={16} />
          {ja ? 'タイムライン' : 'Timeline'}
        </h2>
        <div className="transport">
          <button
            className="icon-btn"
            onClick={() => seek(range[0])}
            aria-label={ja ? '先頭へ' : 'Start of range'}
          >
            <SkipBack size={14} />
          </button>
          <button
            disabled={!media}
            className="play-btn"
            onClick={play}
            aria-label={playing ? (ja ? '一時停止' : 'Pause') : ja ? '再生' : 'Play'}
          >
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <button
            className="icon-btn"
            onClick={() => seek(range[1])}
            aria-label={ja ? '末尾へ' : 'End of range'}
          >
            <SkipForward size={14} />
          </button>
          <span className="clock">
            {clock(time, true)} <em>/ {clock(duration)}</em>
          </span>
        </div>
        <div className="timeline-tools">
          <button
            title={ja ? 'ループ' : 'Loop range'}
            aria-pressed={loop}
            className={'icon-btn ' + (loop ? 'on' : '')}
            onClick={() => setLoop(!loop)}
          >
            <Repeat2 size={16} />
          </button>
          <button
            className="icon-btn"
            title={ja ? 'ミュート' : 'Mute monitor'}
            aria-pressed={mute}
            onClick={() => setMute(!mute)}
          >
            {mute ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className={'text-btn ' + (editRange ? 'on' : '')} onClick={() => setEditRange(!editRange)}>
            <Scissors size={13} />
            {ja ? '範囲' : 'Range'}
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
      {editRange && (
        <div className="range-fields">
          {(['start', 'end'] as const).map((k, i) => (
            <label key={k}>
              {i ? (ja ? '終了 (秒)' : 'End (s)') : ja ? '開始 (秒)' : 'Start (s)'}{' '}
              <input
                type="number"
                step=".01"
                min={i ? range[0] + 0.01 : 0}
                max={i ? duration : range[1] - 0.01}
                value={Number(range[i].toFixed(3))}
                onChange={(e) => {
                  const t = e.target.valueAsNumber
                  if (Number.isFinite(t) && t >= 0 && t <= duration && (i ? t > range[0] : t < range[1]))
                    setRange(i ? [range[0], t] : [t, range[1]])
                }}
              />
            </label>
          ))}
        </div>
      )}
      <div className="tracks">
        <div className="track-label">
          <span className="track-icon">
            <FileMusic size={17} />
          </span>
          <div>
            <strong>{media?.name || '—'}</strong>
            <small>{ja ? 'ソース音声' : 'Source audio'}</small>
          </div>
          <button className="icon-btn" aria-label={ja ? '素材を変更' : 'Replace source'} onClick={importFile}>
            <Upload size={13} />
          </button>
        </div>
        <div
          className="track-region"
          tabIndex={0}
          role="slider"
          aria-label={ja ? '再生位置' : 'Playhead'}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={time}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              seek(Math.max(0, Math.min(duration, time + (e.key === 'ArrowRight' ? 1 : -1) * 0.1)))
            }
          }}
          onPointerDown={(e) => {
            drag.current = ((e.target as HTMLElement).dataset.handle as 'start' | 'end') || 'seek'
            e.currentTarget.setPointerCapture(e.pointerId)
            adjust(e)
          }}
          onPointerMove={(e) => {
            if (drag.current) adjust(e)
          }}
          onPointerUp={() => {
            if (draft.current) setRange(draft.current)
            draft.current = null
            drag.current = null
          }}
          onPointerCancel={() => {
            draft.current = null
            drag.current = null
            previewRange(null)
          }}
        >
          <div className="ruler">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{clock((duration * i) / 6)}</span>
            ))}
          </div>
          <div className="waveform">
            <canvas ref={canvas} />
          </div>
          {editRange && (
            <>
              <div className="range-handle" data-handle="start" style={{ left: pct(range[0]) + '%' }} />
              <div className="range-handle" data-handle="end" style={{ left: pct(range[1]) + '%' }} />
            </>
          )}
          <i className="playhead" style={{ left: pct(time) + '%' }} />
        </div>
      </div>
    </section>
  )
}
