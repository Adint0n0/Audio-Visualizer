# Audio analysis and source timing

In Advanced → Audio analysis, select a channel, frequency scale and envelope, then apply the settings. Changing the analysis affects the visualization. The export audio path reads the original track. Mono and Mid take (L + R) / 2, Side takes (L − R) / 2. Mono sources duplicate their channel for stereo analysis. For sources with more than two channels, the visual analysis uses the first two channels.

詳細設定の「音声解析」で設定を変更し、「解析設定を適用」を押すと、元の音声から再計算します。左右の音量差を表示するには Side、低音を強調するには最高周波数を下げます。オンセットは短時間の実効値の増加量から求める指標です。BPM や正拍を推定する機能はありません。

## Runtime pipeline

1. Mediabunny reads a user-selected File through BlobSource and selects the primary audio/video tracks. The permitted demuxers take local single-file containers. The application checks the actual track codecs, source duration and video dimensions. Video with no audio has zero-valued features.
2. Source time starts at the earliest selected track's first presentation timestamp, clipped at zero for negative decoder preroll. Actual packet end timestamps determine project duration. A dedicated module Worker decodes the sound in order. It places each block on the timeline using the packet timestamp, accounts for gaps and overlaps, and closes decoded samples. A midstream change in sample rate generates an error.
3. The FFT runs at the source sample rate with 256–32768 samples. A single complex radix-2 transform recovers both real channel spectra. The configured window, display frequency range (clipped to Nyquist), aggregation and gain then produce 96 display bands. A second representation stores 48 logarithmic power buckets per channel for independent modulation. Hz ranges weight boundary buckets by fractional overlap. Frequency resolution depends on the FFT size and these stored buckets.
4. Time-domain metrics use one 60 Hz analysis hop. RMS, peak and positive RMS change are retained for Left, Right, Mid and Side. The cache includes 128 signed waveform points per stereo channel per hop. Spectral attack/release, frequency and temporal smoothing, and optional peak hold run on this fixed lattice. Whole-song normalization uses intermediate logarithmic values to preserve very quiet signals before the final whole-track peak is known.
5. Preview, history effects and export read the same source-time features. A random seek indexes a cached row at the nearest 1/60 second. User-defined modulation envelopes evaluate from the beginning and retain evaluated prefixes per configuration, making results reproducible across seek order. The worker processes the complete file before playback. Reapplying analysis settings starts a fresh decode.
6. Background video export requests monotonically increasing frame PTS from a reusable decoder, including at fractional output rates. The last frame whose timestamp is at or before the requested position is used. The decoder iterator closes when export finishes, fails or is cancelled.

The cache contains 604 bytes per 60 Hz row or about 62.2 MiB at 30 minutes, plus a bounded PCM ring and decoder workspaces. Whole-song normalization temporarily uses another 192 bytes per row. Lazy modulation envelopes can each use four bytes per row with a 64-configuration cap. These figures describe allocated typed arrays. Browser heaps, decoder surfaces, GPU allocations, input files, and project/export storage add separate costs. When the browser reports physical memory, the importer checks prospective and existing feature caches plus a 16 MiB reserve against a quarter of that memory. A reported JS heap limit also bounds the new allocation to 70% of current headroom. Worker allocation or transfer failures are reported to the editor. The hard duration limit is 1800 seconds; the importer also rejects video over 32 megapixels. Cancel terminates the analysis worker and releases its decoder. Exact device limits vary.

## Reproducing the checks

Run `npm test -- --run tests/analysis.test.ts` for synthetic sine, phase, channel isolation, impulse, silence, FFT magnitude, attack/release, random seek, Nyquist and song-normalization tests. Run `node scripts/check-media.mjs` for real input decoding in Chromium. This command requires ffmpeg with libvpx, libopus, libx264, libmp3lame and libvorbis. Provide `CHROMIUM_PATH` for a non-default Chromium binary. Add `--long` to include a 29-minute, 59-second PCM test.

| Input fixture | Result on Linux Chromium 156.0.8078.79 |
| --- | --- |
| WAV/16-bit PCM, MP3, FLAC | Decoded, measured non-zero RMS and reached native playback readiness |
| ADTS/AAC, M4A/AAC | Decoded, measured non-zero RMS and reached native playback readiness |
| Ogg/Opus, Ogg/Vorbis | Decoded, measured non-zero RMS and reached native playback readiness |
| WebM/VP9 + Opus, 192 × 108, VFR | Correct red/blue frames across seeks and sequential output. Audio RMS 0 at 0.10 s and 0.08830 at 0.50 s with first audio PTS at 0.244 s |
| MP4/H.264 + AAC, 160 × 90 | Decoded video; audio RMS 0.08740 at 0.25 s |
| MOV/H.264 without audio, 160 × 90 | Decoded video; no audio track; RMS 0 |
| WAV, 24 kHz mono, 29 min 59 s | Two default analysis runs took 17.48 s and 19.95 s in the Linux cloud environment. The last second had RMS 0.08837. Overview contained 1280 buckets |
| FLAC, 8 kHz mono, 30 min 1 s | Refused at the duration check |

The long-input check also injects a 256 MiB reported device budget and verifies rejection before the worker allocates its cache. The VFR test cancels a running analysis, checks the preceding cache, then reanalyses a mono file as Side and verifies zero output. Native playback readiness is checked separately from worker demux/decode support. The measured runtimes apply to this environment. Actual physical mobile devices, uncommon codec profiles, wide-gamut/HDR fidelity and midstream format changes require separate evaluation.

## Positive timestamps and composed video

Some native media players expose the original timestamps, while others rebase a container's start to zero. The editor seeks to the earliest playable native time at load and translates transport, looping and scrubbing into project coordinates. A completed native seek invalidates the paused WebGL preview. The background starts at the video track's first presentation time, which can be later than the audio track's start.

After building, run `node scripts/check-composite.mjs` to exercise the production UI with the Pages headers. The fixture is VFR H.264/AAC with its earliest packet at 1.978 seconds. A Chromium 156 run observed native times 2.23349, 2.74449 and 2.23349 seconds at project times 0.25549, 0.76649 and 0.25549 seconds. GPU pixel readback showed red, blue and red after those paused seeks. The WebM downloaded through the editor contained 25 VP9 frames and an Opus track. At 320 × 180 and 24 fps, FFmpeg found 11,899 and 11,968 scene-overlay pixels over the expected red and blue backgrounds in frames 6 and 18 respectively. Decoded audio RMS was 0.08632. Playback and export use separate browser image conversion paths, so small color differences can occur.
