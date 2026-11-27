# Audio analysis and source timing

In Advanced → Audio analysis, select a channel, frequency scale and envelope, then apply the settings. Changing the analysis affects the visualization. The export audio path reads the original track. Mono and Mid take (L + R) / 2, Side takes (L − R) / 2. Mono sources duplicate their channel for stereo analysis. For sources with more than two channels, the visual analysis uses the first two channels.

詳細設定の「音声解析」で設定を変更し、「解析設定を適用」を押すと、元の音声から再計算します。左右の音量差を表示するには Side、低音を強調するには最高周波数を下げます。既存の変調ソース「オンセット」は、短時間の実効値の増加を測ります。新しい描画スタイルは、別途、スペクトルの変化からアタックと周期性を評価します。拍の信頼度が低い区間では拍パルスを停止し、帯域や音色の変化を使って描画します。

## Runtime pipeline

1. Mediabunny reads a user-selected File through BlobSource and selects the primary audio/video tracks. The permitted demuxers take local single-file containers. The application checks the actual track codecs, source duration and video dimensions. Video with no audio has zero-valued features.
2. Source time starts at the earliest selected track's first presentation timestamp, clipped at zero for negative decoder preroll. Actual packet end timestamps determine project duration. A dedicated module Worker decodes the sound in order. It places each block on the timeline using the packet timestamp, accounts for gaps and overlaps, and closes decoded samples. A midstream change in sample rate generates an error.
3. The FFT runs at the source sample rate with 256–32768 samples. A single complex radix-2 transform recovers both real channel spectra. The configured window, display frequency range (clipped to Nyquist), aggregation and gain then produce 96 display bands. A second representation stores 48 logarithmic power buckets per channel for independent modulation. Hz ranges weight boundary buckets by fractional overlap. Frequency resolution depends on the FFT size and these stored buckets.
4. Time-domain metrics use one 60 Hz analysis hop. RMS, peak and positive RMS change are retained for Left, Right, Mid and Side. The cache includes 128 signed waveform points per stereo channel per hop. Spectral attack/release, frequency and temporal smoothing, and optional peak hold run on this fixed lattice. Whole-song normalization uses intermediate logarithmic values to preserve very quiet signals before the final whole-track peak is known.
5. Preview, history effects and export read the same source-time features. A random seek indexes a cached row at the nearest 1/60 second. User-defined modulation envelopes evaluate from the beginning and retain evaluated prefixes per configuration, making results reproducible across seek order. The worker processes the complete file before playback. Reapplying analysis settings starts a fresh decode.
6. Background video export requests monotonically increasing frame PTS from a reusable decoder, including at fractional output rates. The last frame whose timestamp is at or before the requested position is used. The decoder iterator closes when export finishes, fails or is cancelled.

The cache contains 636 bytes per 60 Hz row or about 65.5 MiB at 30 minutes, plus a bounded PCM ring and decoder workspaces. Whole-song normalization temporarily uses another 192 bytes per row. Lazy modulation envelopes can each use four bytes per row with a 64-configuration cap. These figures describe allocated typed arrays. Browser heaps, decoder surfaces, GPU allocations, input files, and project/export storage add separate costs. When the browser reports physical memory, the importer checks prospective and existing feature caches plus a 16 MiB reserve against a quarter of that memory. A reported JS heap limit also bounds the new allocation to 70% of current headroom. Worker allocation or transfer failures are reported to the editor. The hard duration limit is 1800 seconds; the importer also rejects video over 32 megapixels. Cancel terminates the analysis worker and releases its decoder. Exact device limits vary.

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
| WAV, 24 kHz mono, 29 min 59 s | Default analysis with music descriptors took 22.41 s in the Linux cloud environment. Earlier builds measured 17.48 s and 19.95 s. The last second had RMS 0.08837. Overview contained 1280 buckets |
| FLAC, 8 kHz mono, 30 min 1 s | Refused at the duration check |

The long-input check also injects a 256 MiB reported device budget and verifies rejection before the worker allocates its cache. The VFR test cancels a running analysis, checks the preceding cache, then reanalyses a mono file as Side and verifies zero output. Native playback readiness is checked separately from worker demux/decode support. The measured runtimes apply to this environment. Actual physical mobile devices, uncommon codec profiles, wide-gamut/HDR fidelity and midstream format changes require separate evaluation.

## Positive timestamps and composed video

Some native media players expose the original timestamps, while others rebase a container's start to zero. The editor seeks to the earliest playable native time at load and translates transport, looping and scrubbing into project coordinates. A completed native seek invalidates the paused WebGL preview. The background starts at the video track's first presentation time, which can be later than the audio track's start.

After building, run `node scripts/check-composite.mjs` to exercise the production UI with the Pages headers. The fixture is VFR H.264/AAC with its earliest packet at 1.978 seconds. A Chromium 156 run observed native times 2.23349, 2.74449 and 2.23349 seconds at project times 0.25549, 0.76649 and 0.25549 seconds. GPU pixel readback showed red, blue and red after those paused seeks. The WebM downloaded through the editor contained 25 VP9 frames and an Opus track. At 320 × 180 and 24 fps, FFmpeg found 11,899 and 11,968 scene-overlay pixels over the expected red and blue backgrounds in frames 6 and 18 respectively. Decoded audio RMS was 0.08632. Playback and export use separate browser image conversion paths, so small color differences can occur.

## Music features for visual instruments

The renderer can read `AudioFrame.music` from a frame at any project time. These values use the selected channel's source signal before display equalization, dB mapping and peak hold. A kick, a sustained midrange note and a hi-hat can control different aspects of one instrument.

| Field | Measurement and units |
| --- | --- |
| `bass`, `mid`, `treble` | Window-corrected FFT RMS in 20–250 Hz, 250 Hz–4 kHz, and 4 kHz–Nyquist. Values are linear amplitude, bounded to 0–1. |
| `centroidHz`, `brightness` | Magnitude-weighted mean frequency. The visual scalar maps 40 Hz–16 kHz to 0–1 logarithmically. Silence returns zero. |
| `transient` | Positive spectral flux across 48 log-frequency buckets, with a moving noise threshold, local peak selection and 140 ms exponential decay. A spectral change can register while total RMS stays constant. |
| `tempo`, `confidence`, `beat` | A local 60–180 BPM estimate, event-grid agreement in 0–1, and a confidence-weighted pulse with 110 ms decay. With insufficient evidence, all three values return zero. |

The worker fits a tempo grid to six-second neighborhoods every half-second. It scores both onset evidence near the grid and coverage of predicted beats. Alternating accent strengths help distinguish beats from eighth-note subdivisions. The estimate can select half or double time and lose confidence during tempo transitions, very sparse passages or complex meters. It supplies a visual accent. It does not annotate meter, downbeats, instruments or genre. Fixed source-time rows store all results and are shared by preview and export. Projects continue to persist the existing analysis settings and source assets.

### Controlled musical-fixture review

Run `npm test -- --run tests/music-signals.test.ts`. The deterministic, original stereo arrangements in `tests/fixtures/rhythm.ts` carry known event times. For the following 12-second fixtures, each count covers events between seconds 2 and 10 with a ±2-analysis-row window. These measurements characterize synthetic signals. Unlabelled commercial recordings can produce different results.

| Arrangement | Written tempo | Median estimate | Median confidence | Beat and transient matches |
| --- | --- | --- | --- | --- |
| Dance kick, snare backbeat, offbeat metallic hats | 120 BPM | 120 BPM | 0.843 | 16 of 16 |
| Plucked acoustic pitches, humanized timing, swung accompaniment | 86 BPM | 85.71 BPM | 0.733 | 11 of 11 |
| Syncopated breakbeat with kick pickups and alternating snare | 150 BPM | 150 BPM | 0.769 | 20 of 20 |

Additional cases cover a continuous pitch-modulated ambient pad, digital silence, aperiodic percussion, a 90→132 BPM transition, stereo channel separation, constant-RMS timbre changes and source block boundaries. The ambient and silence runs returned zero estimated tempo. The test also compares backwards seeks and independent chunk sizes. The browser integration test checks transferred music features with a delayed Opus tone and a fresh Side-channel analysis of mono audio.

Run `node scripts/check-music-response.mjs` for the integration check. Chromium decodes generated stereo WAV files, transfers features from the analysis worker and draws all four arrangements through Binary Stars, Halo Index, Level Meter and Liquid Pearl. At 320 × 180, 1,757–12,782 pixels changed relative to silence when scene time was held fixed. Returning to the same source state reproduced the original GPU pixels in all 16 cases. The delayed Opus fixture produced zero-valued music features before audio arrived and a 2,401.7 Hz centroid on its nominal 2,400 Hz tone.

A timing regression adds a one-second audio-track delay to the same PCM and samples 75 output positions at 30000/1001 fps from a fractional range start of 4.123 s. Bass and transient values matched at all positions; tempo and beat estimates agreed to four and five decimal places respectively. This checks source-coordinate alignment independently of the GPU comparison. On scattered percussion, 9.1% of the evaluated interval still met the regularity threshold. Confidence expresses local grid agreement and cannot establish a track's true musical tempo.
