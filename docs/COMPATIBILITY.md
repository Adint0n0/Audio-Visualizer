# Input, output and browser coverage

A file extension selects a candidate in the picker. The container's actual tracks and the browser's decoders determine whether import can proceed. Files stay on the device. The editor requires a secure context, WebGL 2 and storage for large media projects.

| Operation | Verified on Linux Chromium 156 | Other environments |
| --- | --- | --- |
| Audio input and timeline playback | PCM WAV, MP3, FLAC, ADTS AAC, M4A/AAC, Ogg/Opus and Ogg/Vorbis short fixtures | Track detection and decode checks run on import. Device/platform codec sets vary. |
| Video input | VP9/Opus WebM with variable frame timing and offset audio, H.264/AAC MP4, silent H.264 MOV | MOV and MP4 can contain other codecs. HDR inputs display an SDR-output notice. |
| Images, logos, fonts | Local PNG/JPEG/WebP and restricted static SVG, SHA-256 project assets; local font validation including WOFF2 | Browser font decoding is required. Expanded size, dimensions and project limits apply. |
| Export | Real MP4 H.264/AAC and WebM VP9/Opus. Conditional audio packet copy. Trials demux actual encoded packets before advertising a configuration. | AV1, supported quantizers and encoder throughput depend on the browser. Check the dialog at the intended resolution, FPS and quality. |
| Mobile layout | Japanese portrait touch emulation at 390×844, desktop English/Japanese, no horizontal overflow in tested viewport | Physical phone/tablet GPU budgets, OS download UI and long background execution need device testing. |
| Offline operation | Production build, enforced delivery headers, offline restart and real downloads with network disconnected | Browser storage eviction, private browsing and installation prompts depend on OS policy. |
| Firefox ESR 153.5.1 on Linux | A second engine loaded the production shell, analyzed the demo, presented real encoder candidates, exported a 1920×1080 audio-bearing MP4 scene, and restarted offline after the server stopped. Software WebGL 2 under Xvfb. | Reproduce with scripts/check-firefox.mjs in a supported Firefox environment. |
| Safari / iOS / hardware GPU | See PROGRESS.md for available browser measurements | Probe results on other platforms cannot be inferred from the Chromium software renderer. |

Maximum input length is 1,800 seconds. The exporter accepts 1–60 fps, each edge up to 4,096 pixels and up to 8,847,360 pixels in total. Fractional rates have 1000/1001 presets. H.264 requires even dimensions. Failure to allocate, lack of space or an unsupported codec returns a reason to the editor. It does not silently lower export resolution.

See [audio measurements](AUDIO-ANALYSIS.md), [encoded tracks and independent timing checks](EXPORT.md), and [storage and file limits](PROJECT-FORMAT.md).
