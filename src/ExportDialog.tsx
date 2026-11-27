import { useEffect, useRef, useState } from 'react'
import { X, Download, Film } from 'lucide-react'
import type { MediaSourceData } from './media'
import {
  exportMovie,
  probeExport,
  estimateBytes,
  validateExport,
  frameCount,
  type AudioMode,
  type ExportOptions,
} from './export'
import { defaultOutput, parseOutputSettings, type OutputSettings, type TimelineRange } from './model'
import './export.css'

type ExportRenderer = {
  canvas: HTMLCanvasElement
  renderFrame(time: number): Promise<void> | void
  dispose(): Promise<void> | void
}
interface ExportDialogProps {
  lang: 'ja' | 'en'
  name?: string
  duration: number
  media: MediaSourceData | null
  sourceSize?: [number, number]
  initialRange: [number, number]
  initialOutput?: OutputSettings
  onSaveOutput?(output: OutputSettings, range: TimelineRange): void
  createRenderer(
    width: number,
    height: number,
    times: Iterable<number>,
  ): ExportRenderer | Promise<ExportRenderer>
  onClose(): void
}

const SIZES = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1080, 1920],
  [1080, 1080],
]
const RATES = [
  [24, 1],
  [24000, 1001],
  [25, 1],
  [30, 1],
  [30000, 1001],
  [50, 1],
  [60, 1],
  [60000, 1001],
]
const CODEC = { avc: 'H.264', vp9: 'VP9', av1: 'AV1' }
type Candidate = { codec: ExportOptions['videoCodec']; audioMode: AudioMode; audioCodec?: string }

export function ExportDialog({
  lang,
  name = 'Formant',
  media,
  duration,
  sourceSize,
  initialRange,
  initialOutput = defaultOutput,
  onSaveOutput,
  createRenderer,
  onClose,
}: ExportDialogProps) {
  const t = (en: string, ja: string) => (lang === 'ja' ? ja : en)
  const [settings, set] = useState<ExportOptions>(() => ({
    ...initialOutput,
    start: initialRange[0],
    end: initialRange[1],
  }))
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [probing, setProbing] = useState(true)
  const [probeError, setProbeError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState([0, 0])
  const [resultUrl, setResultUrl] = useState('')
  const [sizePreset, setSizePreset] = useState(() => {
    const i = SIZES.findIndex(([w, h]) => w === initialOutput.width && h === initialOutput.height)
    return i < 0 ? 'custom' : String(i)
  })
  const [ratePreset, setRatePreset] = useState(() => {
    const i = RATES.findIndex(([n, d]) => n / d === initialOutput.fps)
    return i < 0 ? 'custom' : String(i)
  })
  const [selectedCodec, selectCodec] = useState<ExportOptions['videoCodec']>(initialOutput.videoCodec)
  const controller = useRef<AbortController | null>(null)
  const result = useRef<{ url: string; dispose(): Promise<void> } | null>(null)
  const probeQueue = useRef(Promise.resolve())
  const mounted = useRef(true)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)

  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement
    closeButton.current?.focus()
    return () => {
      mounted.current = false
      controller.current?.abort()
      if (result.current) {
        URL.revokeObjectURL(result.current.url)
        void result.current.dispose().catch(console.error)
        result.current = null
      }
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  useEffect(() => {
    let active = true
    const scanController = new AbortController()
    setCandidates([])
    setProbing(true)
    setProbeError('')
    const codecs: ExportOptions['videoCodec'][] =
      settings.container === 'mp4' ? ['avc', 'av1', 'vp9'] : ['vp9', 'av1']
    // Reject invalid settings immediately, even while a previous native codec trial shuts down.
    try {
      if (settings.end > duration + 1e-6)
        throw new Error('Range exceeds media duration / 素材の時間を超えています')
      validateExport({ ...settings, videoCodec: codecs[codecs.length - 1] })
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error))
      setProbing(false)
      return
    }
    const scan = async () => {
      if (!active) return
      const good: Candidate[] = [],
        errors: string[] = []
      try {
        for (const codec of codecs) {
          if (!active) return
          const check = await probeExport(
            { ...settings, videoCodec: codec },
            media?.audioTrack ?? null,
            media?.startTimestamp ?? 0,
            scanController.signal,
          )
          if (!active) return
          if (check.supported) {
            good.push({ codec, audioMode: check.audioMode, audioCodec: check.audioCodec })
            setCandidates([...good])
          } else errors.push(CODEC[codec] + ' · ' + check.reason)
        }
        if (!good.length) setProbeError(errors.join('\n'))
      } catch (e) {
        if (active) setProbeError(e instanceof Error ? e.message : String(e))
      } finally {
        if (active) setProbing(false)
      }
    }
    // Devices may have only one hardware encoder. Never overlap old and new size trials.
    const id = setTimeout(() => {
      probeQueue.current = probeQueue.current.then(scan, scan)
    }, 300)
    return () => {
      active = false
      clearTimeout(id)
      scanController.abort()
    }
  }, [settings, media, duration])

  const update = (partial: Partial<ExportOptions>) => {
    if (result.current) {
      URL.revokeObjectURL(result.current.url)
      void result.current.dispose().catch(console.error)
      result.current = null
      setResultUrl('')
    }
    setError('')
    setCandidates([])
    setProbing(true)
    set((o) => ({ ...o, ...partial }))
  }
  const candidate = candidates.find((c) => c.codec === selectedCodec) ?? candidates[0]
  const start = async () => {
    if (!candidate || busy) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true)
    setError('')
    setProgress([0, 0])
    let renderer: Awaited<ReturnType<ExportDialogProps['createRenderer']>> | undefined
    try {
      const times = function* () {
        const count = frameCount(settings)
        for (let i = 0; i < count; i++) yield settings.start + i / settings.fps
      }
      renderer = await createRenderer(settings.width, settings.height, times())
      const file = await exportMovie({
        options: { ...settings, videoCodec: candidate.codec },
        audioTrack: media?.audioTrack ?? null,
        origin: media?.startTimestamp ?? 0,
        canvas: renderer.canvas,
        renderFrame: (time) => renderer!.renderFrame(time),
        signal: abort.signal,
        onProgress: (f, eta) => {
          if (mounted.current) setProgress([f, eta])
        },
      })
      if (!mounted.current || abort.signal.aborted) {
        await file.dispose()
        return
      }
      const url = URL.createObjectURL(file.blob)
      result.current = { url, dispose: file.dispose }
      setResultUrl(url)
    } catch (e) {
      if (mounted.current)
        setError(
          abort.signal.aborted
            ? t('Export canceled', '書き出しをキャンセルしました')
            : e instanceof Error
              ? e.message
              : String(e),
        )
    } finally {
      try {
        await renderer?.dispose()
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e))
      }
      if (mounted.current) setBusy(false)
      controller.current = null
    }
  }
  const close = () => {
    controller.current?.abort()
    // Only persist a complete, valid edit. A half-entered dimension can be discarded by closing.
    const videoCodec =
      candidate?.codec ?? (settings.container === 'webm' && selectedCodec === 'avc' ? 'vp9' : selectedCodec)
    const options = { ...settings, videoCodec }
    if (onSaveOutput && options.end <= duration) {
      let output: OutputSettings | undefined
      try {
        validateExport(options)
        output = parseOutputSettings(options)
      } catch {
        /* The form displays its validation error. */
      }
      if (output)
        onSaveOutput(
          output,
          options.start === 0 && options.end === duration ? null : [options.start, options.end],
        )
    }
    onClose()
  }
  const audioLabel =
    candidate?.audioMode === 'copy'
      ? candidate.audioCodec?.toUpperCase() + ' · ' + t('Original packets', '元音声をコピー')
      : candidate?.audioMode === 'silent'
        ? t('No audio in range', 'この範囲に音声なし')
        : settings.container === 'mp4'
          ? 'AAC'
          : 'Opus'
  const numberField = (
    label: string,
    value: number,
    change: (n: number) => void,
    step: number,
    min: number,
    max: number,
  ) => (
    <label className="field">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => change(e.target.valueAsNumber)}
        step={step}
        min={min}
        max={max}
      />
    </label>
  )
  return (
    <div className="modal-backdrop">
      <section
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
          if (e.key === 'Tab') {
            const nodes = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
              ) ?? [],
            ).filter((n) => !n.matches(':disabled'))
            const first = nodes[0],
              last = nodes.at(-1)
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            }
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header>
          <h2 id="export-title">
            <Film size={20} />
            {t('Export video', '動画を書き出す')}
          </h2>
          <button className="icon-btn" aria-label={t('Close', '閉じる')} onClick={close} ref={closeButton}>
            <X size={18} />
          </button>
        </header>
        <fieldset disabled={busy} className="export-fields">
          <label className="field">
            {t('Format', '形式')}
            <select
              value={settings.container}
              onChange={(e) => update({ container: e.target.value as ExportOptions['container'] })}
            >
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
            </select>
          </label>
          <label className="field">
            {t('Video codec', '映像コーデック')}
            <select
              value={candidate?.codec ?? ''}
              disabled={!candidates.length || !!resultUrl}
              onChange={(e) => selectCodec(e.target.value as ExportOptions['videoCodec'])}
            >
              {!candidates.length && <option value="">—</option>}
              {candidates.map((c) => (
                <option key={c.codec} value={c.codec}>
                  {CODEC[c.codec]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Resolution', '解像度')}
            <select
              value={sizePreset}
              onChange={(e) => {
                const v = e.target.value
                setSizePreset(v)
                const size = v === 'original' ? sourceSize : SIZES[Number(v)]
                if (size) update({ width: size[0], height: size[1] })
              }}
            >
              {SIZES.map(([w, h], i) => (
                <option key={i} value={i}>
                  {w} × {h}
                </option>
              ))}
              {sourceSize && <option value="original">{t('Original', '元動画サイズ')}</option>}
              <option value="custom">{t('Custom', 'カスタム')}</option>
            </select>
          </label>
          <label className="field">
            {t('Frame rate', 'フレームレート')}
            <select
              value={ratePreset}
              onChange={(e) => {
                const v = e.target.value
                setRatePreset(v)
                const r = RATES[Number(v)]
                if (r) update({ fps: r[0] / r[1] })
              }}
            >
              {RATES.map(([n, d], i) => (
                <option key={i} value={i}>
                  {+(n / d).toFixed(3)} fps
                </option>
              ))}
              <option value="custom">{t('Custom', 'カスタム')}</option>
            </select>
          </label>
          {sizePreset === 'custom' && (
            <>
              {numberField(
                t('Width (px)', '幅 (px)'),
                settings.width,
                (n) => update({ width: n }),
                1,
                2,
                4096,
              )}
              {numberField(
                t('Height (px)', '高さ (px)'),
                settings.height,
                (n) => update({ height: n }),
                1,
                2,
                4096,
              )}
            </>
          )}
          {ratePreset === 'custom' &&
            numberField('FPS', settings.fps, (n) => update({ fps: n }), 0.001, 1, 60)}
          <label className="field">
            {t('Rate control', '品質制御')}
            <select
              value={settings.quantizer === undefined ? 'bitrate' : 'quality'}
              onChange={(e) => update({ quantizer: e.target.value === 'quality' ? 22 : undefined })}
            >
              <option value="bitrate">{t('Target bitrate', '目標ビットレート')}</option>
              <option value="quality">{t('Constant quality', '一定品質')}</option>
            </select>
          </label>
          {settings.quantizer !== undefined ? (
            numberField(
              t('Quantizer (lower = finer)', '量子化値（小さいほど高品質）'),
              settings.quantizer,
              (n) => update({ quantizer: n }),
              1,
              0,
              51,
            )
          ) : (
            <>
              <label className="field">
                {t('Quality preset', '品質プリセット')}
                <select
                  value={
                    [8, 16, 40, 80].includes(settings.videoBitrate / 1e6) ? settings.videoBitrate : 'custom'
                  }
                  onChange={(e) => {
                    if (e.target.value !== 'custom') update({ videoBitrate: Number(e.target.value) })
                  }}
                >
                  {[8, 16, 40, 80].map((v) => (
                    <option key={v} value={v * 1e6}>
                      {v} Mbps
                    </option>
                  ))}
                  <option value="custom" disabled>
                    {t('Manual', '手動')}
                  </option>
                </select>
              </label>
              {numberField(
                t('Video (Mbps)', '映像 (Mbps)'),
                settings.videoBitrate / 1e6,
                (n) => update({ videoBitrate: Math.round(n * 1e6) }),
                0.1,
                0.1,
                1000,
              )}
            </>
          )}
          {media?.audioTrack && (
            <label className="field">
              {t('Audio format', '音声形式')}
              <select
                value={settings.audioPolicy ?? 'original'}
                onChange={(e) => update({ audioPolicy: e.target.value as ExportOptions['audioPolicy'] })}
              >
                <option value="original">{t('Preserve source if possible', '可能なら元音声を保持')}</option>
                <option value="compatible">{settings.container === 'mp4' ? 'AAC' : 'Opus'}</option>
              </select>
            </label>
          )}
          {media?.audioTrack &&
            candidate?.audioMode !== 'copy' &&
            candidate?.audioMode !== 'silent' &&
            numberField(
              (settings.container === 'mp4' ? 'AAC' : 'Opus') + ' (kbps)',
              settings.audioBitrate / 1000,
              (n) => update({ audioBitrate: n * 1000 }),
              1,
              8,
              512,
            )}
          {numberField(
            t('Start (s)', '開始 (秒)'),
            settings.start,
            (n) => update({ start: n }),
            0.001,
            0,
            duration,
          )}
          {numberField(
            t('End (s)', '終了 (秒)'),
            settings.end,
            (n) => update({ end: n }),
            0.001,
            0,
            duration,
          )}
        </fieldset>
        <div className="export-info" role="status">
          {candidate && (
            <span>
              {audioLabel} ·{' '}
              {settings.quantizer === undefined
                ? '≈ ' + (estimateBytes(settings) / 1e6).toFixed(1) + ' MB'
                : t('Variable file size', '出力サイズは映像に依存')}
            </span>
          )}
          {probing && <span>{t('Testing encoders…', 'エンコーダーを検証中…')}</span>}
        </div>
        {settings.container === 'mp4' && (settings.width % 2 !== 0 || settings.height % 2 !== 0) && (
          <p className="export-info">
            {t('H.264 requires even width and height.', 'H.264は幅・高さとも偶数が必要です。')}
          </p>
        )}
        {(error || probeError) && (
          <p role="alert" className="export-error">
            {error || probeError}
          </p>
        )}
        {busy && (
          <div className="export-info" role="status">
            <progress max={1} value={progress[0]} />
            <span>
              {Math.round(progress[0] * 100)}% · ≈ {Math.ceil(progress[1])} s
            </span>
          </div>
        )}
        <footer>
          {busy ? (
            <button className="btn" onClick={() => controller.current?.abort()}>
              {t('Cancel export', '書き出しをキャンセル')}
            </button>
          ) : resultUrl ? (
            <a
              className="btn primary"
              href={resultUrl}
              download={name.replace(/[\\/:*?"<>|]/g, '_') + '.' + settings.container}
            >
              <Download size={16} />
              {t('Download video', '動画をダウンロード')}
            </a>
          ) : (
            <button className="btn primary" disabled={!candidate || probing} onClick={() => void start()}>
              {t('Render video', '書き出し開始')}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
