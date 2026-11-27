import { AudioSampleSink, BlobSource, Input, type InputAudioTrack } from 'mediabunny'
import { FeatureBuilder, type AnalysisSettings } from './analysis'
import { localFormats } from './mediaFormats'

export interface AnalysisJob {
  file: File
  trackId: number
  start: number
  duration: number
  settings: AnalysisSettings
}

async function analyze(job: AnalysisJob) {
  const input = new Input({ source: new BlobSource(job.file), formats: localFormats })
  try {
    const track = (await input.getAudioTracks()).find((t) => t.id === job.trackId) as
      | InputAudioTrack
      | undefined
    if (!track) throw Error('Audio track missing / 音声トラックが見つかりません')
    const rate = await track.getSampleRate()
    const builder = new FeatureBuilder(rate, job.duration, job.settings)
    const sink = new AudioSampleSink(track)
    let lastProgress = -1
    for await (const sample of sink.samples()) {
      try {
        if (sample.sampleRate !== rate)
          throw Error(
            'Sample-rate changes within a track are unsupported / 途中で変化するサンプルレートには未対応です',
          )
        // Limit temporary conversion buffers even for codecs that return unusually large packets.
        for (let i = 0; i < sample.numberOfFrames; i += 8192) {
          const length = Math.min(8192, sample.numberOfFrames - i)
          const left = new Float32Array(length)
          const opts = { format: 'f32-planar' as const, frameOffset: i, frameCount: length }
          sample.copyTo(left, { ...opts, planeIndex: 0 })
          let right = left
          if (sample.numberOfChannels > 1) {
            right = new Float32Array(length)
            sample.copyTo(right, { ...opts, planeIndex: 1 })
          }
          builder.push(Math.round((sample.timestamp - job.start) * rate) + i, left, right)
        }
        const progress = Math.floor(
          100 * Math.min(1, (sample.timestamp + sample.duration - job.start) / job.duration),
        )
        if (progress > lastProgress) {
          self.postMessage({ progress: progress / 100 })
          lastProgress = progress
        }
      } finally {
        sample.close()
      }
    }
    const data = builder.finish()
    self.postMessage(
      { data },
      {
        transfer: [
          data.music.buffer,
          data.bands.buffer,
          data.metrics.buffer,
          data.waves.buffer,
          data.waveform.buffer,
          data.channelBands.buffer,
          data.channelMetrics.buffer,
        ],
      },
    )
  } finally {
    input.dispose()
  }
}
self.onmessage = (event) => {
  void analyze(event.data).catch((e) =>
    self.postMessage({ error: e instanceof Error ? e.message : String(e) }),
  )
}
