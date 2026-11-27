# Offline video export

The studio renders each output frame through its Three.js scene renderer at the requested pixel dimensions. Preview resolution, viewport camera and preview refresh rate are independent. CanvasSource captures the result immediately after each render. The export loop awaits the encoder and muxer before moving on. Source presentation time for frame i is start + i / fps. The last rendered frame can be shorter than one frame interval. Video tracks with variable frame rate are sampled on their own presentation timeline.

## Using the dialog

Choose a container, dimensions, frame rate and range in seconds. Render video becomes available when the short codec trials finish. Codec choices reflect a real trial at the requested dimensions. MP4 prefers H.264, and WebM prefers VP9. AV1 is available on devices that pass its trial. The encoder operates in quality latency mode. Select target bitrate or a constant quantizer. Constant quality requires encoder support and output size depends on the scene. Lower quantizers preserve more detail. Approximations for bitrate mode exclude unexpected encoder padding or unusually complex scenes.

An audio track compatible with the target container can be copied at admissible packet boundaries. By default all audio codecs supported by the selected muxer are considered for copying, including AAC, MP3, Opus, FLAC and ISO PCM in MP4, or Opus and Vorbis in WebM. To prioritize playback compatibility choose AAC (MP4) or Opus (WebM) in Audio format. Non-aligned cuts and mid-stream cuts requiring decoder pre-roll use sample trimming and re-encoding. AAC and Opus are the re-encoding options for MP4 and WebM respectively. PCM is trimmed to sample boundaries. Original channel count and sample rate are passed to the encoder. A rejected configuration displays an error. Encoders can add a short tail of padding to decoded output. SDR compositing of the original video requires a video re-encode; HDR-to-SDR fidelity depends on browser decoding and tone mapping.

Click Render video, then Download video. Closing the dialog releases the temporary output. A completed file remains downloadable while the dialog is open. The browser writes to a private temporary file when possible. A fallback uses positional writes into bounded memory pages, refuses estimated outputs above 96 MiB and enforces the same hard limit during writes. The quota preflight includes a storage margin. Canceling or failing releases the encoder, decoded sample iterator and temporary output. Loss of the renderer's WebGL context aborts export; recreate the preview and retry.

## 日本語

書き出し画面で形式、解像度、FPS、開始・終了時刻を指定します。コーデック候補は、指定寸法での短時間のエンコード試験に合格したものです。プレビュー画質・表示速度とは独立したサイズで、フレームごとにレンダリングします。ビットレートまたは一定品質（量子化値）を選べます。量子化値が小さいほど高画質で、一定品質では出力サイズが映像に依存します。

元音声の形式と時間範囲が合えば、元のパケットをコピーします。プレーヤーとの互換性を優先する場合は「音声形式」を AAC または Opus に設定してください。それ以外は MP4 に AAC、WebM に Opus を使用します。対応しない条件はエラーとして表示し、チャンネルや寸法を自動で縮小しません。動画は合成のため再エンコードされます。コーデックによって末尾に短い音声パディングが生じます。

「書き出し開始」を押し、完了したら「動画をダウンロード」で保存します。ダイアログを閉じると一時ファイルを解放します。端末内の一時ファイルを使えない場合はメモリを最大 96 MiB まで使用し、上限を超える出力は停止します。

## Verification

Run from the repository root with FFmpeg, ffprobe, and Chromium (set CHROMIUM_PATH if needed).

    node scripts/check-export.mjs --stress
    node scripts/check-export-dialog.mjs
    npm run build
    node scripts/check-offline.mjs --scene-4k

The script builds an isolated test entry, opens a local browser context and executes the shipping export engine with generated click/flash test patterns. FFprobe reads the resulting files. FFmpeg decodes the tracks independently. Files and the browser context are removed after the run.

| Cloud Chromium 156.0.8078.79, Linux | Result |
| --- | --- |
| VP9/Opus WebM, H.264/AAC MP4, 320×180 at 20 fps, 0.125–1.375 s range | Both contained 25 video frames and 48 kHz stereo audio. Duration including encoder padding was 1.260 s and 1.258667 s respectively. |
| Synthetic clicks against white video frames at 0.15, 0.65 and 1.15 s | Maximum absolute timing error measured at the click peak was 6.87 ms for WebM and 9.88 ms for MP4, within one 50 ms frame. |
| Decode-free whole-track remux of each generated track | SHA-256 compared equal for every audio packet. |
| Production editor offline, Prism Current with Phase Drift WAV from 2.00–2.25 s | VP9/Opus WebM at 3840×2160, ffprobe counted 15 frames at 60/1 fps and reported 0.260 s including padding. FFmpeg decoded the rendered image. Codec trial, export and independent verification took 63.883 s combined on SwiftShader. |
| WebM VP9/Opus, 3840×2160 at 60 fps | 15 frames of a 0.25 s test pattern decoded. |
| WebM VP9/Opus, 1920×1080 at 24 fps | 1,440 frames of a 60 s test pattern decoded. |
| MP4 H.264/AAC, 1920×1080 at 1 fps | 1,800 frames, 1,799.5 s. Audio retained by packet copy. At t = 1, 900 and 1,798 s, the measured audio peak was 8.44 ms after the white frame at each point. |
| Positive audio start offset | Copy preserved the delayed audio start exactly. Trimmed AAC to Opus re-encoding shifted its first packet by −6 ms (Opus priming). |
| PCM retention | Full native WAV PCM copied into ISO PCM MP4 and decoded by FFmpeg as 48 kHz stereo pcm_s16le. |
| Constant quality | VP9 Q22 produced a decodable 25-frame WebM with stereo Opus. |
| NTSC frame rate | Short 30000/1001 fps WebM passed per-frame timestamp checks. |
| Resource handling | Both containers canceled mid-export; no temporary export files remained. Full quota was refused. |
| Japanese mobile viewport (390×844, touch emulation) | Rejected invalid dimensions, switched container and resolution, opened the 720p encoder menu in 1.53 s, rendered the bundled scene, canceled, and verified OPFS cleanup. CDP measured 21 MiB JS heap before render, 26 MiB during render and 18 MiB after cancel and forced GC. This measures JS heap only. |
| Restricted browser capabilities | WASM AAC encoded with the native AudioEncoder API disabled; bounded RAM target produced a readable MP4 with OPFS disabled. Test page enforced script and worker CSP. |

Test host reported an Intel Xeon Platinum 8573C. These measurements exercise the encoder with simple patterns. Complex scenes increase render time and memory use. Mobile hardware, Safari and individual hardware codecs require separate device testing.

## Firefox ESR

A separate Gecko run used Debian Firefox ESR 153.5.1 with Xvfb and software Mesa on Linux. The production build served the Pages headers, initialized WebGL 2 without a renderer error, analyzed the bundled track and offered H.264, AV1 and VP9 in the MP4 codec menu. The full scene rendered and downloaded as a 214,159-byte 1920×1080 MP4. The browser's independent playback element read a duration of 0.255958 s for a requested 0.25 s range. After the local HTTP server stopped, reloading the app succeeded from its service worker cache, including the demo WAV and cross-origin isolation.

Run `FIREFOX_PATH=/path/to/firefox-esr node scripts/check-firefox.mjs` after `npm run build`. A virtual or physical display enables the visual checks. The test additionally exercises the cached offline shell in headless environments. On this cloud host Firefox's standard content sandbox requires a runtime that permits its normal user-namespace setup. The Firefox and Xvfb packages used for the check were extracted from Debian packages verified against Debian's signed release index.
