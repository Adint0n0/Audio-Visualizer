# Architecture

Formant is a static client application. A project stores editable values and content hashes. Analysis data and Three.js resources are derived from these values. Opening the same scene at a different time evaluates its original values again.

| Component | Responsibility |
| --- | --- |
| React and TypeScript | Bilingual editor, inspector schemas, keyboard and touch interaction. The live gesture preview and the committed history entry have separate lifetimes. |
| src/model.ts and src/templates.ts | Versioned, bounded project data, v1 migration, parent validation, ordered modulation and time-based motion. Each template creates an editable project. |
| src/studio/hooks.ts | Transactional primary-media import, session restoration, asset registration, serialized IndexedDB saves, cancellation and lifetime management. |
| src/analysis.worker.ts and src/analysis.ts | Stream decoded samples into a bounded ring, compute spectral and time-domain features on source time, and share compact feature history between consumers. Input and output signals are independent. |
| src/media.ts | Mediabunny container/track detection, offset-aware video presentation and sequential frame iteration, scoped object URLs and worker ownership. |
| src/scene.ts and src/render/ | WebGL 2 renderer, perspectives, screen-space pass, geometry registry, materials, deterministic effects and editor gizmos. The output renderer receives its own dimensions and output camera. Canvas 2D is used for the timeline and glyph textures. Scene geometry runs on WebGL. |
| src/export.ts and src/output/ | Short, real codec trials, frame-index timestamps, bounded encode queues, compatible audio packet copy or bounded PCM re-encode, muxing to OPFS with a capped memory fallback. |
| src/storage.ts and src/validateImage.ts | ZIP asset bundles, checksum-based relink, schema and image validation, autosave and recovery. |
| scripts/postbuild.mjs and scripts/offline-worker.js | Enforce Pages artifact limits, collect shipped license notices and bind the offline shell to a single build. |

Three.js supplies geometry, lighting and WebGL resource management. Mediabunny supplies PTS-aware demux, browser codec integration and streaming mux. Its optional AAC encoder supplies a locally bundled fallback for the tested configurations. The browser probes actual codec outputs before displaying candidates. zip.js reads ZIP entries as streams; noble-hashes supports incremental hashing of local files. The fonts ship in the application bundle. Resolved package versions are locked in package-lock.json, with redistributable notices under dist/licenses after a production build.

## Timeline ownership

The primary track defines project duration. The preview follows the media element while playing. The renderer queries absolute-time features for each frame. The export loop derives presentation timestamps from frame indices and the selected frame rate. It decodes the video background by source PTS, including variable frame durations. The audio mux path trims or copies the original audio track with its time offset. The analysis panel never changes encoded audio amplitude or channel layout.

## Limits

The project parser validates numeric domains, identifiers, reference graphs and collection sizes. The input reader checks duration and memory requirements before analysis. The exporter checks proposed dimensions and bitrate, available codec configurations and storage quota. A frame or package error is reported to the UI. Browser storage quota, device memory, decoder availability and GPU limits determine the usable settings on each device.
