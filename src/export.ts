import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  Quality,
  canEncodeVideo,
  Input,
  BlobSource,
  MP4,
  WEBM,
  EncodedPacketSink,
  type InputAudioTrack,
  type Target,
} from 'mediabunny'
import { prepareAudio, enablePortableAac, createAudioWriter, type AudioMode } from './output/audio'
import { estimateBytes, frameCount, validateExport, type ExportOptions } from './output/timing'
import { openExportStorage } from './output/storage'

export type { ExportOptions, AudioMode }
export { estimateBytes, frameCount, validateExport }

export interface ExportRequest {
  options: ExportOptions
  audioTrack: InputAudioTrack | null
  origin?: number
  canvas: HTMLCanvasElement
  renderFrame(time: number): void | Promise<void>
  signal: AbortSignal
  onProgress?(fraction: number, etaSeconds: number): void
}

const videoQuality = (o: ExportOptions) =>
  new Quality(o.quantizer === undefined ? { bitrate: o.videoBitrate } : { quantizer: o.quantizer })

function makePipeline(
  target: Target,
  canvas: HTMLCanvasElement,
  o: ExportOptions,
  plan: Awaited<ReturnType<typeof prepareAudio>>,
  origin: number,
  trial = false,
) {
  const output = new Output({
    format: o.container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target,
  })
  const video = new CanvasSource(canvas, {
    codec: o.videoCodec,
    quality: videoQuality(o),
    latencyMode: 'quality',
  })
  // A fractional last frame is intentional. Supplying frameRate metadata would snap its duration.
  output.addVideoTrack(video)
  const audio = createAudioWriter(plan, o, origin, trial)
  if (audio) output.addAudioTrack(audio.source)
  return { output, video, audio }
}

type ProbeResult = { supported: boolean; audioMode: AudioMode; audioCodec?: string; reason?: string }

export async function probeExport(
  options: ExportOptions,
  track: InputAudioTrack | null,
  origin = 0,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const result = await testEncoder(options, track, origin, signal)
  if (!result.lateAac) return result
  try {
    signal?.throwIfAborted()
    await enablePortableAac()
    return await testEncoder(options, track, origin, signal)
  } catch (error) {
    return {
      supported: false,
      audioMode: 'encode',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function testEncoder(
  o: ExportOptions,
  track: InputAudioTrack | null,
  origin: number,
  signal?: AbortSignal,
): Promise<ProbeResult & { lateAac?: boolean }> {
  let mode: AudioMode = track ? 'encode' : 'silent'
  let output: Output | undefined
  let trialCanvas: HTMLCanvasElement | undefined
  const cancel = () => {
    void output?.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    signal?.throwIfAborted()
    validateExport(o)
    if (
      typeof VideoEncoder === 'undefined' ||
      !(await canEncodeVideo(o.videoCodec, {
        width: o.width,
        height: o.height,
        frameRate: o.fps,
        quality: videoQuality(o),
        latencyMode: 'quality',
      }))
    )
      throw new Error('Video encoder unavailable / 映像エンコーダー非対応')
    const plan = await prepareAudio(o, track, origin)
    signal?.throwIfAborted()
    mode = plan.mode
    trialCanvas = document.createElement('canvas')
    trialCanvas.width = o.width
    trialCanvas.height = o.height
    const ctx = trialCanvas.getContext('2d')
    if (!ctx) throw new Error('Canvas allocation failed / キャンバスを確保できません')
    ctx.fillRect(0, 0, o.width, o.height)
    const target = new BufferTarget()
    const pipeline = makePipeline(target, trialCanvas, o, plan, origin, true)
    output = pipeline.output
    await output.start()
    await pipeline.video.add(0, 1 / o.fps)
    pipeline.video.close()
    if (pipeline.audio) {
      for await (const block of pipeline.audio.iterator) await block.write()
      pipeline.audio.source.close()
    }
    await output.finalize()
    if (!target.buffer?.byteLength) throw new Error('Encoder produced no file / 出力データが空です')
    const trial = new Input({ source: new BlobSource(new Blob([target.buffer])), formats: [MP4, WEBM] })
    try {
      const video = await trial.getPrimaryVideoTrack()
      if (
        !video ||
        (await video.getDisplayWidth()) !== o.width ||
        (await video.getDisplayHeight()) !== o.height ||
        !(await new EncodedPacketSink(video).getFirstPacket({ metadataOnly: true }))
      ) {
        throw new Error('Video trial produced no valid frame / 試験映像フレームを検出できません')
      }
      if (plan.mode !== 'silent') {
        const audio = await trial.getPrimaryAudioTrack()
        if (
          !audio ||
          (await audio.getCodec()) !== plan.codec ||
          !(await new EncodedPacketSink(audio).getFirstPacket({ metadataOnly: true }))
        ) {
          throw new Error('Audio trial produced no valid packet / 試験音声パケットを検出できません')
        }
        // The trial feeds PCM at exactly t=0. Some native AAC configurations
        // emit a positive start offset despite passing isConfigSupported().
        if (plan.mode === 'encode' && (await audio.getFirstTimestamp()) > 2 / plan.sampleRate) {
          return {
            supported: false,
            audioMode: mode,
            lateAac: plan.codec === 'aac',
            reason: 'Audio encoder shifted the timeline / 音声エンコーダーが開始時刻をずらしました',
          }
        }
      }
    } finally {
      trial.dispose()
    }
    return { supported: true, audioMode: mode, audioCodec: plan.mode === 'silent' ? undefined : plan.codec }
  } catch (error) {
    if (output?.state === 'started') await output.cancel().catch(() => undefined)
    return {
      supported: false,
      audioMode: mode,
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    if (trialCanvas) {
      trialCanvas.width = 1
      trialCanvas.height = 1
    }
  }
}

export async function exportMovie(request: ExportRequest) {
  const { options: o, origin = 0, canvas, signal } = request
  validateExport(o)
  if (canvas.width !== o.width || canvas.height !== o.height)
    throw new Error('Export canvas dimensions differ / キャンバスと出力寸法が一致しません')
  signal.throwIfAborted()
  const plan = await prepareAudio(o, request.audioTrack, origin)
  signal.throwIfAborted()
  const storage = await openExportStorage(estimateBytes(o))
  let pipeline: ReturnType<typeof makePipeline> | undefined
  let completed = false
  let stopping: Promise<void> | undefined
  // Release a backpressured encoder immediately; finalization itself is atomic.
  const cancel = () => {
    stopping = pipeline?.output.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    pipeline = makePipeline(storage.target, canvas, o, plan, origin)
    const { audio, video, output } = pipeline
    await output.start()
    let block = await audio?.iterator.next()
    const frames = frameCount(o),
      duration = o.end - o.start,
      started = performance.now()
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted()
      const t = i / o.fps,
        next = Math.min(duration, (i + 1) / o.fps)
      await request.renderFrame(o.start + t)
      signal.throwIfAborted()
      await video.add(t, next - t)
      while (block && !block.done && block.value.time < next) {
        signal.throwIfAborted()
        await block.value.write()
        block = await audio!.iterator.next()
      }
      const fraction = (i + 1) / frames
      request.onProgress?.(fraction, ((performance.now() - started) / 1000) * (1 / fraction - 1))
    }
    await audio?.iterator.return()
    audio?.source.close()
    video.close()
    signal.throwIfAborted()
    await output.finalize()
    signal.throwIfAborted()
    const blob = await storage.finish('video/' + o.container)
    if (!blob.size) throw new Error('Encoder produced no file / 出力データが空です')
    completed = true
    return { blob, dispose: storage.dispose, audioMode: plan.mode }
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    await stopping
    if (!completed) {
      try {
        await pipeline?.audio?.iterator.return()
      } finally {
        try {
          if (pipeline && pipeline.output.state !== 'finalized') await pipeline.output.cancel()
        } finally {
          await storage.dispose()
        }
      }
    }
  }
}
