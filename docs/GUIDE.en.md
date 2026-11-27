# Formant Studio user guide

## Make your first video

1. Press Play to try the included track and 3D scene. To use your own music, choose **Import media** or drop an audio or video file onto the studio. Wait for audio analysis to finish. The browser reads and processes your files locally.
2. Open a card in **Library** to see its preview. **Replace scene** applies its objects, camera and lighting to your source. **Append layers** adds its objects to the current composition. Search by name, filter by category, or use the hearts to collect favorites.
3. Open **Layers** and select an object. In **Inspector → Layer**, try changing the sensitivity and color mapping. Open **Advanced** for geometry, material, sound mappings and animation.
4. Click or tap the waveform to seek. Open **Range** and enter the start and end times in seconds or drag the timeline handles. Enable looping to audition that section.
5. Open **Export**. Set the container, dimensions, frame rate and audio format. After the codec trials finish, select a supported combination and render the video. Download it before closing the dialog. Rendering can take longer than the selected section's playing time.

## Adjust settings on a phone

Tap **Edit** in the bottom navigation to adjust settings while watching the preview. Choose a **Category** such as Appearance or Transform. Swipe vertically to scroll the setting list, including when starting on a slider. Drag a slider horizontally to change its value. Tap − or + for a single increment, or enter a value in the numeric field.

Use **Expand** in the panel header for more space. In landscape the preview and settings sit side by side. Tap **Preview** to close the panel.

## Compose the scene

- Use **Add layer** for a visualizer, caption, image or group. The eye controls visibility. Higher rows take a later draw order. Depth testing still determines how overlapping 3D surfaces occlude each other.
- Use the multiple-selection button or Ctrl, Cmd or Shift while clicking. Open **Layer tools** to duplicate, reorder, lock, remove or group selected objects. Alignment and distribution use the chosen axis. Group members must share a parent and coordinate space.
- **Transform** edits local X, Y and Z coordinates, rotations in degrees, scale and pivot. Enable uniform scaling to keep proportions. Drag the appropriate axis of the Move, Rotate or Scale gizmo in the viewport. A positive **Snap** value in preview settings quantizes the adjustment.
- Enable **Screen space** for titles and logos that should stay on screen as the camera moves. Assign a **Parent group** for related objects. Depth testing and the layer order are available for transparent overlays.
- Add a backdrop for an audio source in **Inspector → Scene → Background**. A new empty scene starts with black. Templates can supply their own background colors. Importing a video uses its original frames for the background and its own audio for analysis and output. Silent video produces zero audio response.
- With **Spectrum**, choose a layout and element shape. **Custom path** accepts SVG path data or the first path of an imported SVG. **Edit as polyline** samples control points that you can move, add and remove. Apply commits that conversion. Dedicated styles such as Terrain, Waterfall and Orb use their own layouts.
- Gradient stops use positions from 0 to 1. Use the layer appearance controls to set local bloom or trails. Open **Scene** for the output camera, lights and scene effects. Inspect depth with the editor camera and switch to the output camera to check the recorded composition. For portrait output, choose a portrait viewport and portrait export dimensions.

## Make the scene react to sound

In **Advanced → Scene → Audio analysis**, a larger FFT separates close frequencies more precisely. A smaller window responds to faster changes. Configure the channel, window, frequency range, scale and smoothing, then apply the analysis settings. These settings tune the visual signal.

In the layer or scene's **Audio mappings**, choose a target such as **Scale · Y** and select a low-frequency band. Adjust the lower and upper frequencies, sensitivity, attack and release. The meter shows the input signal while playing. Mappings run in the listed order using Add, Multiply or Replace. Onset measures a rise in sound energy. In **Motion**, select a waveform, period, amplitude and phase for automatic rotation, oscillation, orbit or seeded noise.

## Edit and save

| Action | Control |
| --- | --- |
| Play or pause | Space or the transport button |
| Undo or redo | Ctrl/Cmd+Z or Ctrl/Cmd+Shift+Z |
| Download a full project | Ctrl/Cmd+S or the project menu in the header |
| Commit a numeric edit | Enter or move focus away |
| Switch panels on a phone | Scenes, Layers, Edit and Preview in the bottom navigation |
| Change language or use fullscreen | EN/JA in the header or the fullscreen button in the viewport |

Use the shortcuts outside a text field or dialog. Undo restores an entire slider or gizmo drag with one command.

Open the project name in the header and choose **Save project with assets (.avproj)** to take the source, imported assets, scene and output settings to another browser or device. **Save scene settings (.json)** stores settings and asset references. To relink a missing asset, choose a file with the same contents as the original. Use **Advanced → Layer settings** to save an individual object preset and load it into a layer of the same kind. Copy and Paste settings transfer appearance and mappings while preserving the receiving object's transform and parent.

Autosave belongs to the current browser profile and site. Keep a downloaded .avproj for important edits. The project menu shows browser storage use and can clear the local autosave. Open Guide to check the offline installation status. Wait for “Ready for offline use” before disconnecting. After the first complete online load, the installed service worker can reopen the app and its bundled resources offline at the same site.

## Troubleshooting

- Input is limited to 30 minutes. The container, its actual codecs and your decoder determine whether a particular file can open.
- For smoother playback, reduce the viewport resolution multiplier or preview FPS. Choose your final dimensions and FPS separately in Export.
- The studio accepts up to 4096 pixels per axis, 8,847,360 pixels per frame and 60 fps. The short encoder trials determine which choices work on your device. Change the export settings and retest when a combination is unavailable.
- If the browser reports insufficient storage, adjust the range, bitrate or output dimensions. If the GPU context is lost, retry the viewport and restart the render.

[Audio analysis](AUDIO-ANALYSIS.md) · [Encoding and measured export results](EXPORT.md) · [Project files and offline use](PROJECT-FORMAT.md) · [Template catalog](TEMPLATES.md)

[Touch gestures and snapping](TOUCH-EDITING.md)
