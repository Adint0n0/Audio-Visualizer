import { MAX_MEDIA_SECONDS } from '../analysis'
import { validPixelSize } from './resolution'

export type Container = 'mp4' | 'webm'

export interface ExportOptions {
  container: Container
  videoCodec: 'avc' | 'vp9' | 'av1'
  width: number
  height: number
  fps: number
  start: number
  end: number
  quantizer?: number
  videoBitrate: number
  audioBitrate: number
  audioPolicy?: 'original' | 'compatible'
}

export function frameCount(options: Pick<ExportOptions, 'start' | 'end' | 'fps'>) {
  return Math.ceil((options.end - options.start) * options.fps - 1e-9)
}

export function validateExport(o: ExportOptions) {
  if (
    !['mp4', 'webm'].includes(o.container) ||
    !['avc', 'av1', 'vp9'].includes(o.videoCodec) ||
    (o.container === 'webm' && o.videoCodec === 'avc')
  )
    throw new Error('Invalid codec/container / 形式とコーデックの組み合わせが無効です')
  if (!validPixelSize(o))
    throw new Error('Maximum 4096 px per side and 8,847,360 pixels / 最大辺4096・8847360画素まで')
  if (o.videoCodec === 'avc' && (o.width % 2 || o.height % 2))
    throw new Error('H.264 requires even dimensions / H.264は幅・高さを偶数にしてください')
  if (!Number.isFinite(o.fps) || o.fps < 1 || o.fps > 60) throw new Error('FPS must be 1–60 / FPSは1〜60です')
  if (
    !Number.isFinite(o.start) ||
    !Number.isFinite(o.end) ||
    o.start < 0 ||
    o.end > MAX_MEDIA_SECONDS ||
    o.end <= o.start ||
    frameCount(o) < 1
  )
    throw new Error('Invalid export range / 書き出し範囲が無効です')
  if (o.quantizer !== undefined && (!Number.isInteger(o.quantizer) || o.quantizer < 0 || o.quantizer > 51))
    throw new Error('Quantizer must be 0–51 / 量子化値は0〜51です')
  if (![o.videoBitrate, o.audioBitrate].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 1_000_000_000))
    throw new Error('Invalid bitrate / ビットレートが無効です')
}

export function estimateBytes(o: ExportOptions) {
  return Math.ceil((((o.end - o.start) * (o.videoBitrate + o.audioBitrate)) / 8) * 1.08) + 65536
}
