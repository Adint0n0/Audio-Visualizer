import {
  BlobSource,
  CanvasSink,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  type InputTrack,
} from 'mediabunny'
import {
  MAX_MEDIA_SECONDS,
  analysisBytes,
  readFrame,
  silentFrame,
  validateAnalysis,
  type AnalysisSettings,
  type AudioFrame,
  type FeatureData,
} from './analysis'
import { localFormats } from './mediaFormats'
import type { AnalysisJob } from './analysis.worker'

export interface MediaOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  analysis?: Partial<AnalysisSettings>
}
export interface MediaSourceData {
  file: File
  name: string
  url: string
  input: Input
  audioTrack: InputAudioTrack | null
  videoTrack: InputVideoTrack | null
  videoStart: number
  startTimestamp: number
  duration: number
  width: number
  height: number
  hasAudio: boolean
  hasVideo: boolean
  isHDR: boolean
  sampleRate: number
  channels: number
  waveform: Float32Array
  analysis: AnalysisSettings
  frame(time: number): AudioFrame
  videoAt(time: number): Promise<HTMLCanvasElement | OffscreenCanvas | null>
  videoFrames(times: Iterable<number>): AsyncGenerator<HTMLCanvasElement | OffscreenCanvas | null, void>
  reanalyze(settings: Partial<AnalysisSettings>, opts?: Omit<MediaOptions, 'analysis'>): Promise<void>
  dispose(): void
}
function abortError() {
  return new DOMException('Cancelled / キャンセルしました', 'AbortError')
}

function checkMemoryBudget(bytes: number, retained: number) {
  const device = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const heap = (performance as Performance & { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } })
    .memory
  const reserve = 16 * 1024 ** 2 // Decoder, conversion buffers and the bounded PCM window.
  const deviceBudget = device ? (device * 1024 ** 3) / 4 : Infinity
  const heapBudget = heap ? Math.max(0, heap.jsHeapSizeLimit - heap.usedJSHeapSize) * 0.7 : Infinity
  if (bytes + reserve + retained > deviceBudget || bytes + reserve > heapBudget) {
    throw Error('Insufficient memory for this analysis length / 素材の解析に必要なメモリを確保できません')
  }
}

function analyze(job: AnalysisJob, signal: AbortSignal, progress?: MediaOptions['onProgress']) {
  return new Promise<FeatureData>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    const clean = () => {
      worker.terminate()
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      clean()
      reject(abortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = ({ data }) => {
      if (typeof data.progress === 'number') {
        progress?.(data.progress)
        return
      }
      clean()
      if (data.error) reject(Error(data.error))
      else if (data.data) resolve(data.data)
      else reject(Error('Invalid analysis worker response / 音声解析の応答が無効です'))
    }
    worker.onmessageerror = () => {
      clean()
      reject(Error('Analysis transfer failed / 解析データの転送に失敗しました'))
    }
    worker.onerror = (event) => {
      clean()
      reject(Error(event.message || 'Analysis worker failed / 音声解析に失敗しました'))
    }
    try {
      worker.postMessage(job)
    } catch (e) {
      clean()
      reject(e)
    }
  })
}

export async function openMedia(file: File, opts: MediaOptions = {}): Promise<MediaSourceData> {
  opts.signal?.throwIfAborted()
  const input = new Input({ source: new BlobSource(file), formats: localFormats })
  let disposed = false
  let job: AbortController | undefined
  let url: string | undefined
  let features: FeatureData | undefined
  const dispose = () => {
    if (disposed) return
    disposed = true
    job?.abort()
    features = undefined
    input.dispose()
    if (url) URL.revokeObjectURL(url)
  }
  opts.signal?.addEventListener('abort', dispose, { once: true })
  try {
    const [audioTrack, videoTrack] = await Promise.all([
      input.getPrimaryAudioTrack(),
      input.getPrimaryVideoTrack(),
    ])
    const selected: InputTrack[] = []
    if (audioTrack) selected.push(audioTrack)
    if (videoTrack) selected.push(videoTrack)
    if (!selected.length) throw Error('No audio or video track / 音声・映像トラックがありません')
    const [firstTimestamp, end] = await Promise.all([
      input.getFirstTimestamp(selected),
      input.computeDuration(selected),
    ])
    // Negative AAC/Opus preroll belongs to the decoder and is outside the playable project interval.
    const start = Math.max(0, firstTimestamp)
    const duration = end - start
    if (!(duration > 0 && Number.isFinite(duration)))
      throw Error('Invalid media duration / 素材の長さを読み取れません')
    if (duration > MAX_MEDIA_SECONDS)
      throw Error('Input exceeds 30 minutes / 30 分を超える素材は読み込めません')
    const [width, height, isHDR, audioOK, videoOK, sampleRate, channels, firstVideo] = await Promise.all([
      videoTrack?.getDisplayWidth() ?? 0,
      videoTrack?.getDisplayHeight() ?? 0,
      videoTrack?.hasHighDynamicRange() ?? false,
      audioTrack?.canDecode() ?? true,
      videoTrack?.canDecode() ?? true,
      audioTrack?.getSampleRate() ?? 0,
      audioTrack?.getNumberOfChannels() ?? 0,
      videoTrack?.getFirstTimestamp() ?? 0,
    ])
    if (!audioOK || !videoOK)
      throw Error(
        'This browser cannot decode the selected track codec / このブラウザは素材のコーデックをデコードできません',
      )
    if (width * height > 33554432)
      throw Error(
        'Input exceeds the 32-megapixel decode limit / 入力映像の画素数がデコード上限を超えています',
      )
    opts.signal?.throwIfAborted()
    const canvasSink = videoTrack ? new CanvasSink(videoTrack, { poolSize: 1 }) : null
    url = URL.createObjectURL(file)
    const media: MediaSourceData = {
      file,
      name: file.name,
      url,
      input,
      audioTrack,
      videoTrack,
      startTimestamp: start,
      videoStart: Math.max(0, firstVideo - start),
      duration,
      width,
      height,
      isHDR,
      sampleRate,
      channels,
      hasAudio: !!audioTrack,
      hasVideo: !!videoTrack,
      waveform: new Float32Array([0]),
      analysis: validateAnalysis(opts.analysis),
      frame: (t) => (features ? readFrame(features, t) : silentFrame),
      async videoAt(t) {
        if (!canvasSink || t < 0 || t > duration) return null
        return (await canvasSink.getCanvas(start + t))?.canvas ?? null
      },
      async *videoFrames(times) {
        if (!canvasSink) return
        // This iterator reuses a decoder as timestamps advance, including repeated frames in low/VFR material.
        const pts = function* () {
          for (const t of times) yield start + t
        }
        for await (const frame of canvasSink.canvasesAtTimestamps(pts())) yield frame?.canvas ?? null
      },
      async reanalyze(settings, options = {}) {
        if (disposed || options.signal?.aborted) throw abortError()
        const validated = validateAnalysis(settings)
        if (!audioTrack) {
          media.analysis = validated
          return
        }
        checkMemoryBudget(
          analysisBytes(duration, validated.normalization),
          features ? analysisBytes(duration, 'fixed') : 0,
        )
        job?.abort()
        const current = new AbortController()
        job = current
        const cancel = () => current.abort()
        options.signal?.addEventListener('abort', cancel, { once: true })
        try {
          const result = await analyze(
            { file, trackId: audioTrack.id, start, duration, settings: validated },
            current.signal,
            options.onProgress,
          )
          if (current.signal.aborted || disposed) throw abortError()
          features = result
          media.waveform = result.waveform
          media.analysis = validated
        } finally {
          options.signal?.removeEventListener('abort', cancel)
          if (job === current) job = undefined
        }
      },
      dispose,
    }
    await media.reanalyze(media.analysis, opts)
    opts.signal?.throwIfAborted()
    return media
  } catch (e) {
    dispose()
    if (opts.signal?.aborted) throw abortError()
    throw e
  } finally {
    opts.signal?.removeEventListener('abort', dispose)
  }
}
