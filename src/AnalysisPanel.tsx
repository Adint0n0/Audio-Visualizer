import { useEffect, useState } from 'react'
import {
  analysisChoices,
  analysisRanges,
  defaultAnalysis,
  fftSizes,
  validateAnalysis,
  type AnalysisSettings,
} from './analysis'

type Lang = 'ja' | 'en'
const labels: Record<keyof AnalysisSettings, [string, string]> = {
  fftSize: ['FFT サイズ', 'FFT size'],
  channel: ['入力チャンネル', 'Input channel'],
  window: ['窓関数', 'Window'],
  distribution: ['周波数分布', 'Frequency scale'],
  aggregation: ['帯域集約', 'Band aggregation'],
  amplitude: ['振幅変換', 'Amplitude mapping'],
  normalization: ['正規化', 'Normalization'],
  minHz: ['最低周波数 (Hz)', 'Low frequency (Hz)'],
  maxHz: ['最高周波数 (Hz)', 'High frequency (Hz)'],
  gain: ['入力ゲイン', 'Input gain'],
  exponent: ['指数', 'Exponent'],
  floorDb: ['ノイズフロア (dB)', 'Noise floor (dB)'],
  threshold: ['振幅しきい値', 'Amplitude threshold'],
  dynamicRangeDb: ['ダイナミックレンジ (dB)', 'Dynamic range (dB)'],
  attackMs: ['アタック (ms)', 'Attack (ms)'],
  releaseMs: ['リリース (ms)', 'Release (ms)'],
  timeSmoothMs: ['時間平滑化 (ms)', 'Time smoothing (ms)'],
  frequencySmooth: ['周波数平滑化 (帯域数)', 'Frequency smoothing (bands)'],
  holdMs: ['ピーク保持 (ms)', 'Peak hold (ms)'],
  decayMs: ['ピーク減衰 (ms)', 'Peak decay (ms)'],
  outMin: ['出力下限', 'Output minimum'],
  outMax: ['出力上限', 'Output maximum'],
}
const jaChoices: Record<string, string> = {
  mono: 'モノラル',
  left: '左',
  right: '右',
  mid: 'Mid（中央）',
  side: 'Side（差分）',
  hann: 'ハン',
  hamming: 'ハミング',
  blackman: 'ブラックマン',
  rectangular: '矩形',
  linear: '線形',
  log: '対数',
  mel: 'Mel',
  bark: 'Bark',
  octave: 'オクターブ',
  peak: 'ピーク',
  mean: '平均',
  rms: '実効値',
  db: 'デシベル',
  power: '指数',
  fixed: '固定',
  adaptive: 'フレームごと',
  song: '全曲基準',
}
export function AnalysisPanel({
  settings,
  onApply,
  lang,
  busy = false,
}: {
  settings: AnalysisSettings
  onApply: (settings: AnalysisSettings) => void
  lang: Lang
  busy?: boolean
}) {
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState(false)
  useEffect(() => {
    setDraft(settings)
    setError(false)
  }, [settings])
  const t = (ja: string, en: string) => (lang === 'ja' ? ja : en)
  const label = (k: keyof AnalysisSettings) => labels[k][lang === 'ja' ? 0 : 1]
  return (
    <details className="ip-section">
      <summary>{t('音声解析', 'Audio analysis')}</summary>
      <fieldset disabled={busy} className="ip-fields">
        <label>
          {label('fftSize')}{' '}
          <select value={draft.fftSize} onChange={(e) => setDraft({ ...draft, fftSize: +e.target.value })}>
            {fftSizes.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {(Object.keys(analysisChoices) as (keyof typeof analysisChoices)[]).map((k) => (
          <label key={k}>
            {label(k)}{' '}
            <select value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
              {analysisChoices[k].map((v) => (
                <option key={v} value={v}>
                  {lang === 'ja' ? jaChoices[v] : v}
                </option>
              ))}
            </select>
          </label>
        ))}
        {(Object.keys(analysisRanges) as (keyof typeof analysisRanges)[]).map((k) => {
          const [min, max, step] = analysisRanges[k]
          return (
            <label key={k}>
              {label(k)}{' '}
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isNaN(draft[k]) ? '' : draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.valueAsNumber })}
              />
            </label>
          )
        })}
        <button
          type="button"
          onClick={() => {
            try {
              const next = validateAnalysis(draft)
              setError(false)
              onApply(next)
            } catch {
              setError(true)
            }
          }}
        >
          {t('解析設定を適用', 'Apply analysis settings')}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(false)
            setDraft({ ...defaultAnalysis })
          }}
        >
          {t('初期値に戻す', 'Restore defaults')}
        </button>
        {error && (
          <p role="alert">
            {t(
              '数値、周波数、出力範囲を確認してください。',
              'Check the values, frequency range and output range.',
            )}
          </p>
        )}
      </fieldset>
    </details>
  )
}
