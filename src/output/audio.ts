import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Mp4OutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type EncodedPacket,
  type InputAudioTrack,
} from 'mediabunny'
import type { ExportOptions } from './timing'

export type AudioMode = 'copy' | 'encode' | 'silent'
type Plan =
  | { mode: 'silent' }
  | {
      mode: 'copy'
      codec: AudioCodec
      config: AudioDecoderConfig
      sink: EncodedPacketSink
      first: EncodedPacket
    }
  | {
      mode: 'encode'
      codec: 'opus' | 'aac'
      channels: number
      sampleRate: number
      track: InputAudioTrack
    }
const EPSILON = 0.000002
let registration: Promise<void> | undefined

/** Register the local encoder after native capability or timestamp validation fails. */
export async function enablePortableAac(): Promise<void> {
  registration ??= import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder())
  await registration
}

export async function prepareAudio(
  o: ExportOptions,
  track: InputAudioTrack | null,
  origin: number,
): Promise<Plan> {
  if (!track) return { mode: 'silent' }
  const start = origin + o.start,
    end = origin + o.end
  const firstTime = await track.getFirstTimestampOrNull()
  const lastTime = await track.computeDurationOrNull()
  if (firstTime === null || lastTime === null || firstTime >= end || lastTime <= start)
    return { mode: 'silent' }
  const codec = await track.getCodec()
  const format = o.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
  const mayCopy =
    codec !== null &&
    format.getSupportedAudioCodecs().includes(codec) &&
    (o.audioPolicy !== 'compatible' || codec === (o.container === 'mp4' ? 'aac' : 'opus'))
  if (codec && mayCopy) {
    const sink = new EncodedPacketSink(track)
    const includesFirst = start <= firstTime + EPSILON || (start === 0 && firstTime < 0 && firstTime > -0.125)
    const first = includesFirst ? await sink.getFirstPacket() : await sink.getPacket(start + EPSILON)
    const last = end >= lastTime - EPSILON ? null : await sink.getPacket(end, { metadataOnly: true })
    const startAligned = first && (includesFirst || Math.abs(first.timestamp - start) < EPSILON)
    const endAligned =
      !last ||
      Math.abs(last.timestamp - end) < EPSILON ||
      Math.abs(last.timestamp + last.duration - end) < EPSILON
    // Recursive codecs can require packets preceding the cut to converge.
    // Avoid expanding the selected range or discarding the decoder's priming.
    if (first && startAligned && endAligned && (includesFirst || (await track.getPreRollDuration()) === 0)) {
      const config = await track.getDecoderConfig()
      if (config) return { mode: 'copy', codec, config, sink, first }
    }
  }
  const wanted = o.container === 'mp4' ? 'aac' : 'opus'
  const sampleRate = await track.getSampleRate(),
    channels = await track.getNumberOfChannels()
  const args = { sampleRate, numberOfChannels: channels, bitrate: o.audioBitrate }
  if (wanted === 'aac' && !(await canEncodeAudio(wanted, args))) {
    await enablePortableAac()
  }
  if (!(await track.canDecode()) || !(await canEncodeAudio(wanted, args)))
    throw new Error(
      'Audio codec unavailable for the source rate/channels / 元音声の条件でデコード・エンコードできません',
    )
  return { mode: 'encode', codec: wanted, channels, sampleRate, track }
}

/** Each yielded entry owns at most one decoded block. The finally also covers cancellation. */
export function createAudioWriter(plan: Plan, o: ExportOptions, origin: number, trial = false) {
  const start = origin + o.start,
    end = origin + o.end
  if (plan.mode === 'silent') return null
  if (plan.mode === 'copy') {
    const source = new EncodedAudioPacketSource(plan.codec)
    async function* packets() {
      if (plan.mode !== 'copy') return
      let first = true
      for await (const packet of plan.sink.packets(plan.first)) {
        if (packet.timestamp >= end - EPSILON) break
        const time = packet.timestamp - start
        const metadata = first ? { decoderConfig: plan.config } : undefined
        yield {
          time,
          write: () => source.add(packet.clone({ timestamp: trial ? Math.min(0, time) : time }), metadata),
        }
        first = false
        if (trial) return
      }
    }
    return { source, iterator: packets() }
  }
  const source = new AudioSampleSource({ codec: plan.codec, bitrate: o.audioBitrate })
  async function* samples() {
    if (plan.mode !== 'encode') return
    if (trial) {
      const sample = new AudioSample({
        format: 'f32-planar',
        sampleRate: plan.sampleRate,
        numberOfChannels: plan.channels,
        timestamp: 0,
        data: new Float32Array(4096 * plan.channels),
      })
      try {
        yield { time: 0, write: () => source.add(sample) }
      } finally {
        sample.close()
      }
      return
    }
    for await (const sample of new AudioSampleSink(plan.track).samples(start, end)) {
      try {
        const first = Math.max(0, Math.ceil((start - sample.timestamp) * sample.sampleRate - 1e-5))
        const last = Math.min(
          sample.numberOfFrames,
          Math.ceil((end - sample.timestamp) * sample.sampleRate - 1e-5),
        )
        if (last <= first) continue
        const trimmed = sample.trim(first, last)
        try {
          const time = Math.max(0, trimmed.timestamp - start)
          trimmed.setTimestamp(time)
          yield { time, write: () => source.add(trimmed) }
        } finally {
          trimmed.close()
        }
      } finally {
        sample.close()
      }
    }
  }
  return { source, iterator: samples() }
}
