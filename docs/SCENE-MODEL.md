# Scene settings, version 2

A scene preset stores a single Project object. The TypeScript declarations, default constructors and runtime validators are in `src/model.ts`. Audio analysis ranges and options are defined in `src/analysis.ts`. The editor and the exporter share the model and resolve a scene at an absolute source timestamp in seconds.

| Project field | Stored value |
| --- | --- |
| version, name, seed | Format version 2, a display name up to 180 characters, and an unsigned 32-bit random seed |
| mediaId | SHA-256 asset reference or null |
| layers | Up to 128 layers, ordered from back to front |
| camera | Projection, XYZ position and target, FOV, orthographic size, near and far planes, roll, orbit and zoom |
| lights | Ambient, directional, point and spot lights, each with color, intensity, XYZ position and shadow setting |
| background | Color, optional image asset, fit mode, position, rotation, zoom, brightness, contrast, saturation, blur and hue |
| effects | Bloom strength and trail strength |
| range | Null for the entire source or a pair of absolute seconds with 0 ≤ start < end ≤ 1800 |
| output | MP4/WebM container, video codec, dimensions, rate, target video and audio bitrates, optional quantizer and audio-copy preference |
| analysis | Channel, FFT and band mapping, amplitude transform, normalization, gating, smoothing and peak envelope |
| motions, modulations | Ordered drivers operating on the scene properties exposed in the inspector |

## Layer space and timing

Layers have unique IDs and a kind of visualizer, text, image or group. Position, rotation, scale and pivot are XYZ triples. Rotation and phase use degrees. Positions and sizes use scene units. The transform applies around the pivot. Children refer to a group by its ID and inherit its transform. Import rejects missing parents, repeated IDs and cycles. Screen-space layers use a fixed orthographic camera. Depth testing and opacity are explicit per layer. Reorder layers to adjust their draw order. The rendering engine handles opaque and blended material passes separately.

Each layer carries its own bloom (0–3) and trail (0–1) settings. The loader initializes missing per-layer effects to zero for earlier scene files and standalone object presets. A visualizer stores a style, layout, shape, geometry settings and material settings. The renderer’s plugin registry supplies the available controls for each style. Geometric counts are bounded integers. Color values are six-digit RGB hex strings. Gradients store 1–128 stops in ascending position order from 0 to 1. Text adds locally rendered font, spacing, line height, alignment, outline and shadow settings. Image, texture and font references use content hashes.

## Audio and animation

Each layer and the scene can have up to 32 periodic motions and 32 audio mappings. The engine starts from the original settings on every evaluation. It applies motions in array order, then applies enabled audio mappings in array order using add, multiply or replace. Mapping targets come from a fixed property list, so a mapping cannot read another property as an input. Color drivers shift the base palette. Orbit on an X component also drives its matching Y component in quadrature. Noise uses the scene seed, motion index and time interval.

Audio mappings use RMS, peak, onset or a frequency band measured in Hz. Attack and release use milliseconds. The resolver supplies the smoothed channel signal before inversion, curve, sensitivity, offset and mapping bounds. Geometry limits clamp the final evaluated values. The saved base settings remain available for editing and undo.

## Import and history

Version 1 settings migrate automatically. The loader initializes the range to the whole source and output to 1080p, 30 fps, MP4/H.264, 16 Mbps video and 256 kbps audio. Version 2 records the selected output preferences and timeline range. Project import checks format constraints and the export dialog tests the chosen device’s encoders each time it opens. The loader rejects unsupported versions, invalid types, coordinates of the wrong length, nonfinite numbers, malformed colors, unsupported enum choices, inverted clipping or amplitude bounds, excessive array lengths and invalid target scopes. It reconstructs records from known fields. Archive limits and asset validation are documented in [PROJECT-FORMAT.md](PROJECT-FORMAT.md).

The editor keeps up to 80 immutable undo snapshots. A committed edit clears the redo branch. One slider drag or gizmo gesture commits its final value. Grouping, alignment and distribution use a common parent and coordinate space. Copying a group remaps descendant IDs while preserving internal parent references.

## Rendering bloom and trails

Visualizer, text and image layers can emit their own glow and trail. Set the layer’s bloom or trail strength in Appearance. Group opacity and transforms affect its children. The scene controls apply a second effect to the entire composition. A layer’s zero strength disables its contribution. Bright neighboring layers contribute to a layer’s glow only if their own glow or the global effect is enabled.

The WebGL renderer captures light from contributing geometry in separate half-resolution color buffers. Other opaque surfaces still write depth, including surfaces that cover an emitting object. The renderer samples the glow around each output pixel and combines it with the full-resolution scene in linear light. The output uses SDR sRGB. HDR mastering and a full floating-point HDR bloom pipeline are outside the current renderer.

Trails sample the scene at 1/30 and 3/30 seconds before the output timestamp. A range export can sample history from before its start. Seeking backwards yields the same samples. Layer trails include only the participating objects. Global trails can include the current decoded video background in their samples. Historical video frames are not re-decoded for this effect. The optional preview-resolution control reduces render cost without changing exported dimensions. Browser GPU memory and graphics-driver limits still apply, particularly at 4K. The full-resolution post-processing target uses available multisampling through 2560 × 1440 and a single sample above that pixel count.

## GPU-driven music visuals

Four styles upload 128 samples of current frequency energy, signed waveform and delayed energy to a local GPU texture. A separate sRGB lookup texture contains the layer’s editable gradient. Absolute source time, the project seed and cached musical features drive the same shaders in the preview and the offline exporter.

| Style | Geometry and lighting | Musical response |
| --- | --- | --- |
| Galaxy | A tilted dust disk with procedural optical density and a three-dimensional population of native GPU point sprites. Sparse diffraction highlights, a compact nucleus and star clusters use separate brightness profiles. | Bass lifts the disk, midrange perturbs its spiral arms, and high-frequency energy changes the brightness and size of local stars. Count sets density at 48 stars per unit, subject to the built-in minimum. |
| Radial | Extruded radial vanes, concentric spectral filaments and a separate cloud of drifting sparks. The aperture is open and remains available for another layer. | Frequency bands shape individual vanes, the signed waveform displaces the inner filament, and the transient envelope accents sparks. |
| Diodes | An instanced array of convex lenses and recessed rims above a board with local light spill. Each lens has its own hotspot and fractional activation. A raised dome supplies its depth at small screen sizes. At 14 pixels and above the mesh resolves the lens lip and recessed bezel. | Each column reads a band and each row represents an amplitude threshold. A secondary peak trace uses a 100 ms historical sample. Reverse and mirror adjust channel layout. |
| Globe | A deformed icosahedral mesh with anti-aliased triangular filaments, bright junctions, a dim far side and a translucent atmosphere. | Bass affects broad folds, local bands affect radial displacement, and treble adds fine ripples and junction brightness. |

Selection and camera framing use geometric footprints of the shader-deformed layers. The galaxy uses its stellar disk for selection so sparse distant stars leave room to select neighboring objects. The radial aperture permits tapping through the middle of the ring. These four emissive styles expose shader-specific controls. They support the common transform, palette, compositing and post-effect controls.
