import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Box,
  Undo2,
  Redo2,
  Crosshair,
  Magnet,
  Scan,
  Orbit,
  Camera as CameraIcon,
  ChevronDown,
  Expand,
  Maximize,
  Monitor,
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
  SlidersHorizontal,
} from 'lucide-react'
import { SceneRenderer } from '../scene'
import type { Camera, Layer, Project, Vec3 } from '../model'
import { silentFrame } from '../analysis'
import type { MediaSourceData } from '../media'
import { errorText, type Lang } from './hooks'

import { Vector3, MathUtils } from 'three'
import { useGestures } from './useGestures'
import { clampTransform, initialSnap, type Transform, type Mode } from './transform'
import { Precision, SnapSettings } from './Precision'
import { Dialog } from './Dialog'
type Tool = 'select' | 'translate' | 'rotate' | 'scale'
type Props = {
  project: Project
  media: MediaSourceData | null
  video: RefObject<HTMLVideoElement | null>
  images: Map<string, HTMLImageElement>
  time: number
  lang: Lang
  selection: string[]
  edit: (p: Project) => void
  onSelect: (ids: string[]) => void
  notify: (s: string) => void
  pauseRender: boolean
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}
export function Viewport(props: Props) {
  const { lang, project, media, selection } = props,
    ja = lang === 'ja'
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<SceneRenderer | null>(null)
  const [tool, setTool] = useState<Tool>('select'),
    [ratio, setRatio] = useState('16 / 9'),
    [options, setOptions] = useState(false),
    [quality, setQuality] = useState(1),
    [fps, setFps] = useState(30),
    [editorCam, setEditorCam] = useState(false),
    [angle, setAngle] = useState(25),
    [snap, setSnap] = useState(0)
  const [fault, setFault] = useState(''),
    [generation, reset] = useState(0)
  const latest = useRef(props)
  latest.current = props
  const selected = selection.length === 1 ? project.layers.find((l) => l.id === selection[0]) : undefined
  const [mode, setMode] = useState<Mode>('object')
  const [manualView, setManualView] = useState<Camera | null>(null)
  const [snapSettings, setSnapSettings] = useState(initialSnap)
  const [snapOpen, openSnap] = useState(false),
    [precision, openPrecision] = useState(false),
    [context, setContext] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false),
    [useAuto, setAuto] = useState(true)
  useEffect(() => {
    if (!focusMode) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setFocusMode(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [focusMode])
  const outline = useRef<HTMLDivElement>(null)
  const camera = manualView ?? project.camera
  const patch = (id: string, value: Partial<Layer>) => {
    const p = latest.current.project
    const l = p.layers.find((l) => l.id === id)
    if (l && !l.locked)
      latest.current.edit({ ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, ...value } : l)) })
  }
  const gesture = useGestures({
    renderer,
    layer: selected,
    camera: { ...camera, orbit: 0 },
    mode,
    snap: snapSettings,
    select: (id) => props.onSelect(id ? [id] : []),
    hold: (id) => {
      props.onSelect([id])
      setContext(id)
    },
    commit: (id, value: Transform) => patch(id, value),
    view: setManualView,
  })
  const [stageRect, setStageRect] = useState<DOMRect | null>(null)
  const draft = gesture.draft
  const view = useRef({
    editorCam,
    angle,
    fps,
    quality,
    tool,
    manualView,
    draft,
    useAuto,
    selected: selected?.id,
  })
  view.current = useMemo(
    () => ({ editorCam, angle, fps, quality, tool, manualView, draft, useAuto, selected: selected?.id }),
    [editorCam, angle, fps, quality, tool, manualView, draft, useAuto, selected?.id],
  )
  const setGestureMode = (next: Mode) => {
    if (next === 'view' && !manualView) {
      const c = project.camera,
        target = new Vector3(...c.target)
      const pos = new Vector3(...c.position)
        .sub(target)
        .applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(c.orbit))
        .add(target)
      setManualView({ ...c, orbit: 0, position: pos.toArray() as Vec3 })
    }
    setTool('select')
    setMode(next)
  }
  function alignView(direction: string, id?: string) {
    const c = manualView ?? project.camera
    const source = renderer.current?.focusBounds(id)
    const center = source?.center ?? c.target
    const dir: Record<string, Vec3> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      side: [1, 0, 0],
      top: [0, 1, 0.0001],
      iso: [1, 0.72, 1],
    }
    const v = dir[direction]
      ? new Vector3(...dir[direction])
      : new Vector3(...c.position).sub(new Vector3(...c.target))
    const radius = source?.radius ?? 2.8
    const aspect = canvas.current ? canvas.current.clientWidth / Math.max(1, canvas.current.clientHeight) : 1
    const halfAngle = Math.atan(Math.tan(MathUtils.degToRad(c.fov / 2)) * Math.max(1, aspect))
    const distance =
      direction === 'fit'
        ? Math.max(1.2, (radius + 0.3) / Math.sin(Math.min(halfAngle, MathUtils.degToRad(c.fov / 2))))
        : Math.max(1.2, v.length())
    const position = v
      .normalize()
      .multiplyScalar(distance)
      .add(new Vector3(...center))
      .toArray() as Vec3
    setTool('select')
    setMode('view')
    setManualView({
      ...c,
      position,
      target: center,
      orbit: 0,
      roll: 0,
      zoom: 1,
      orthoSize: direction === 'fit' ? Math.max(1, 2.5 * radius) : c.orthoSize,
    })
  }
  function centerLayer(l: Layer) {
    const p = renderer.current?.manipulation(l.id)
    if (!p) return
    const delta = p
      .toLocal({ x: (p.origin.left + p.origin.right) / 2, y: (p.origin.top + p.origin.bottom) / 2 })
      .sub(p.toLocal(p.center))
    patch(l.id, {
      position: clampTransform('position', new Vector3(...l.position).add(delta).toArray() as Vec3),
    })
  }
  const flat = gesture.handlers
  const guide = gesture.guides
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let r: SceneRenderer
    try {
      r = new SceneRenderer(el)
      renderer.current = r
      setFault('')
    } catch (e) {
      setFault(errorText(e))
      return
    }
    let id = 0,
      last = -Infinity,
      dirty = true,
      alive = true
    let previous: typeof props | undefined, settings: typeof view.current | undefined
    const lost = (e: Event) => {
      e.preventDefault()
      alive = false
      cancelAnimationFrame(id)
      setFault('WebGL context lost / WebGL コンテキストを失いました')
    }
    const restore = () => reset((n) => n + 1)
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restore)
    const updateRect = () => setStageRect(el.getBoundingClientRect())
    const observe = new ResizeObserver(() => {
      dirty = true
      updateRect()
    })
    updateRect()
    observe.observe(el)
    // A native seek completes after the timeline UI updates, so invalidate the paused preview again.
    const nativeVideo = latest.current.video.current
    const invalidate = () => {
      dirty = true
    }
    nativeVideo?.addEventListener('seeked', invalidate)
    nativeVideo?.addEventListener('loadeddata', invalidate)
    const coarse = matchMedia('(pointer:coarse)')
    let autoScale = 1,
      slow = 0,
      fast = 0
    let oldWidth = 0,
      oldHeight = 0
    const paint = (now: number) => {
      if (!alive) return
      id = requestAnimationFrame(paint)
      const current = latest.current,
        config = view.current
      if (
        current.pauseRender ||
        now - last < 1000 / config.fps - 1 ||
        (!dirty && previous === current && settings === config && config.tool === 'select')
      )
        return
      const started = performance.now()
      const factor = config.quality * (config.useAuto ? autoScale : 1)
      const width = Math.max(1, Math.round(el.clientWidth * factor)),
        height = Math.max(1, Math.round(el.clientHeight * factor))
      if (!el.clientWidth) return
      try {
        if (oldWidth !== width || oldHeight !== height) {
          r.resize(width, height)
          oldWidth = width
          oldHeight = height
        }
        const p = config.draft
          ? {
              ...current.project,
              layers: current.project.layers.map((layer) =>
                layer.id === config.draft?.id ? { ...layer, ...config.draft.transform } : layer,
              ),
            }
          : current.project
        if (config.manualView) r.setEditorCamera(config.manualView)
        else if (config.editorCam) {
          const c = p.camera,
            theta = (config.angle * Math.PI) / 180,
            x = c.position[0] - c.target[0],
            z = c.position[2] - c.target[2]
          r.setEditorCamera({
            ...c,
            position: [
              c.target[0] + x * Math.cos(theta) + z * Math.sin(theta),
              c.position[1] + 1,
              c.target[2] - x * Math.sin(theta) + z * Math.cos(theta),
            ],
          })
        } else r.setEditorCamera(null)
        const vid = current.video.current
        const background = current.media?.hasVideo
          ? vid && vid.readyState >= 2 && current.time >= current.media.videoStart
            ? vid
            : null
          : current.images.get(p.background.imageId || '')
        r.render(p, current.time, current.media?.frame(current.time) || silentFrame, {
          background,
          images: current.images,
          frameAt: current.media?.frame,
          previewLod: config.useAuto ? Math.min(1, autoScale * (coarse.matches ? 0.7 : 1)) : 1,
        })
        const highlight = outline.current
        if (highlight) {
          const bounds = config.selected ? r.selectionBounds(config.selected) : null
          const rect = el.getBoundingClientRect()
          if (
            bounds &&
            bounds.right >= rect.left &&
            bounds.left <= rect.right &&
            bounds.bottom >= rect.top &&
            bounds.top <= rect.bottom
          ) {
            const clamp = (v: number, max: number) => Math.max(1, Math.min(max - 1, v))
            const x = clamp(bounds.left - 5 - rect.left, rect.width),
              y = clamp(bounds.top - 5 - rect.top, rect.height)
            highlight.style.display = ''
            highlight.style.transform = 'translate(' + x + 'px,' + y + 'px)'
            highlight.style.width = Math.max(8, clamp(bounds.right + 5 - rect.left, rect.width) - x) + 'px'
            highlight.style.height = Math.max(8, clamp(bounds.bottom + 5 - rect.top, rect.height) - y) + 'px'
          } else highlight.style.display = 'none'
        }
        if (config.useAuto) {
          const elapsed = performance.now() - started
          const budget = 1000 / config.fps
          const paintGap = now - last
          const playbackStep = previous ? (current.time - previous.time) * 1000 : 0
          const continuous = !document.hidden && playbackStep > 0 && Math.abs(paintGap - playbackStep) < 120
          const droppedFrames = continuous && paintGap > budget * 1.6
          if (elapsed > budget * 0.85 || droppedFrames) {
            fast = 0
            if (++slow >= (droppedFrames ? 4 : 8)) {
              autoScale = Math.max(0.5, autoScale - 0.125)
              slow = 0
            }
          } else if (continuous && elapsed < budget * 0.35 && paintGap < budget * 1.25) {
            slow = 0
            if (++fast >= 90) {
              autoScale = Math.min(1, autoScale + 0.125)
              fast = 0
            }
          } else {
            slow = 0
            fast = 0
          }
        }
        previous = current
        settings = config
        last = now
        dirty = false
      } catch (e) {
        alive = false
        cancelAnimationFrame(id)
        setFault(errorText(e))
      }
    }
    id = requestAnimationFrame(paint)
    return () => {
      alive = false
      cancelAnimationFrame(id)
      observe.disconnect()
      nativeVideo?.removeEventListener('seeked', invalidate)
      nativeVideo?.removeEventListener('loadeddata', invalidate)
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restore)
      renderer.current = null
      r.dispose()
    }
  }, [generation])
  useEffect(() => {
    const id = selection.length === 1 && tool !== 'select' ? selection[0] : null
    const commit = (layerId: string, field: 'position' | 'rotation' | 'scale', v: Vec3) => {
      const p = latest.current.project
      latest.current.edit({
        ...p,
        layers: p.layers.map((l) => (l.id === layerId && !l.locked ? { ...l, [field]: v } : l)),
      })
    }
    renderer.current?.setGizmo(id, tool === 'select' ? 'translate' : tool, commit, snap)
  }, [selection, tool, generation, snap, project.layers])
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch (e) {
      props.notify(errorText(e))
    }
  }
  const t = (en: string, jp: string) => (ja ? jp : en)
  const activeTransform = gesture.draft?.transform
  const currentContext = project.layers.find((l) => l.id === context)
  const neighbor =
    selected &&
    project.layers.find(
      (l) =>
        l.id !== selected.id && l.visible && l.kind !== 'group' && l.screenSpace === selected.screenSpace,
    )
  return (
    <div className={'viewport' + (focusMode ? ' focus-view' : '')} ref={root}>
      <header className="viewport-head">
        <h2>
          <Box size={17} />
          {ja ? 'ビューポート' : 'Viewport'}
        </h2>
        <div className="view-controls">
          <div className="touch-history">
            <button
              className="icon-btn"
              data-action="undo"
              aria-label={t('Undo', '元に戻す')}
              disabled={!props.canUndo}
              onClick={props.undo}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="icon-btn"
              data-action="redo"
              aria-label={t('Redo', 'やり直す')}
              disabled={!props.canRedo}
              onClick={props.redo}
            >
              <Redo2 size={18} />
            </button>
          </div>
          <span className="render-badge">
            <i />
            WebGL 2
          </span>
          <label className="ratio-select">
            <Monitor size={13} />
            <select
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              aria-label={ja ? '画面比率' : 'Preview aspect ratio'}
            >
              {['16 / 9', '1 / 1', '9 / 16', '4 / 3'].map((v) => (
                <option key={v} value={v}>
                  {v.replace(' / ', ':')}
                </option>
              ))}
            </select>
            <ChevronDown size={11} />
          </label>
          <button
            className="icon-btn"
            title={focusMode ? t('Close focus mode', '集中モードを閉じる') : t('Focus mode', '集中モード')}
            onClick={() => setFocusMode(!focusMode)}
          >
            <Expand size={16} />
          </button>
        </div>
      </header>
      <div className="stage-space">
        <div className="stage-frame" style={{ '--ratio': ratio } as React.CSSProperties}>
          <canvas
            ref={canvas}
            {...(tool === 'select' ? flat : {})}
            aria-label={ja ? '3D シーンプレビュー' : '3D scene preview'}
          />
          <div
            data-selection-bound
            ref={outline}
            className={'selection-outline' + (gesture.holding ? ' is-holding' : '')}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
          {stageRect && guide.x !== undefined && (
            <div
              aria-hidden="true"
              data-guide="x"
              className="snap-line snap-x"
              style={{ left: guide.x - stageRect.left }}
            />
          )}
          {stageRect && guide.y !== undefined && (
            <div
              aria-hidden="true"
              data-guide="y"
              className="snap-line snap-y"
              style={{ top: guide.y - stageRect.top }}
            />
          )}
          {activeTransform && (
            <output className="transform-readout">
              {activeTransform.position.map((n) => n.toFixed(2)).join(' · ')} /{' '}
              {Math.round(activeTransform.rotation[2])}° / {Math.round(activeTransform.scale[0] * 100)}%
              {Object.keys(guide).length ? ' · ' + t('Snap', '吸着') : ''}
            </output>
          )}
          {fault && (
            <div role="alert" className="stage-error">
              {fault}
              <button className="btn" onClick={() => reset((n) => n + 1)}>
                {ja ? '再試行' : 'Retry WebGL'}
              </button>
            </div>
          )}
        </div>
      </div>
      <footer className="viewport-foot">
        <div className="touch-modes">
          <button
            data-mode="object"
            aria-pressed={mode === 'object' && tool === 'select'}
            onClick={() => setGestureMode('object')}
          >
            <Move size={15} />
            {t('Object', 'オブジェクト')}
          </button>
          <button
            data-mode="orbit"
            aria-pressed={mode === 'orbit' && tool === 'select'}
            onClick={() => setGestureMode('orbit')}
          >
            <Orbit size={15} />
            {t('3D turn', '3D回転')}
          </button>
          <button
            data-mode="view"
            aria-pressed={mode === 'view' && tool === 'select'}
            onClick={() => setGestureMode('view')}
          >
            <CameraIcon size={15} />
            {t('View', '視点')}
          </button>
        </div>
        <div className="gizmos">
          {(
            [
              ['select', MousePointer2, ja ? '選択' : 'Select'],
              ['translate', Move, ja ? '移動' : 'Move'],
              ['rotate', RotateCw, ja ? '回転' : 'Rotate'],
              ['scale', Scaling, ja ? '拡縮' : 'Scale'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => {
                setMode('object')
                setTool(id)
              }}
              className={'icon-btn ' + (tool === id ? 'active' : '')}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <button
          className="camera-toggle"
          title={ja ? 'カメラ切替' : 'Switch camera'}
          onClick={() => {
            setManualView(null)
            setEditorCam(!editorCam)
            setMode('object')
          }}
        >
          <CameraIcon size={14} />
          {editorCam ? (ja ? '編集カメラ' : 'Editor camera') : ja ? '出力カメラ' : 'Output camera'}
          <ChevronDown size={12} />
        </button>
        <div className="viewport-actions">
          <button
            className="icon-btn"
            data-action="precision"
            disabled={!selected || selected.locked}
            aria-label={t('Precise transform', '精密変形')}
            title={t('Precise transform', '精密変形')}
            onClick={() => openPrecision(true)}
          >
            <Crosshair size={17} />
          </button>
          <button
            className={'icon-btn ' + (snapSettings.enabled ? 'on' : '')}
            data-action="snap"
            aria-label={t('Snap guides', 'スナップガイド')}
            title={t('Snap guides', 'スナップガイド')}
            onClick={() => openSnap(true)}
          >
            <Magnet size={17} />
          </button>
          <button
            className={'icon-btn ' + (options ? 'on' : '')}
            title={ja ? 'プレビュー設定' : 'Preview settings'}
            onClick={() => setOptions(!options)}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </footer>
      <p className="touch-hint">
        {mode === 'view'
          ? t('Drag to orbit · Pinch to zoom', 'ドラッグで視点回転・ピンチでズーム')
          : !selected
            ? t('Tap a layer on the canvas', 'キャンバスのレイヤーをタップ')
            : mode === 'orbit'
              ? t('Drag over the object to turn it in 3D', 'ドラッグで選択レイヤーを立体回転')
              : t('Drag to move · Pinch or twist to transform', 'ドラッグで移動・ピンチやひねりで変形')}
      </p>
      {(mode === 'view' || options) && (
        <div className="view-options">
          {mode === 'view' && (
            <>
              <select
                aria-label={t('View direction', '視点方向')}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) alignView(e.target.value)
                  e.currentTarget.value = ''
                }}
              >
                <option value="">{t('Direction', '方向')}</option>
                {[
                  ['front', 'Front', '正面'],
                  ['back', 'Back', '背面'],
                  ['side', 'Side', '側面'],
                  ['top', 'Top', '上面'],
                  ['iso', 'Diagonal', '斜め'],
                ].map(([id, en, jp]) => (
                  <option key={id} value={id}>
                    {t(en, jp)}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => alignView('fit', selected?.id)}>
                <Scan size={15} />
                {selected ? t('Focus', '選択に注目') : t('Fit', '全体を表示')}
              </button>
              {selected && (
                <button className="btn" onClick={() => alignView('fit')}>
                  {t('Fit all', '全体を表示')}
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  setManualView(null)
                  setEditorCam(false)
                  setMode('object')
                }}
              >
                {t('Reset view', '視点を戻す')}
              </button>
              {manualView && (
                <button
                  className="btn"
                  onClick={() => latest.current.edit({ ...latest.current.project, camera: manualView })}
                >
                  {t('Use for export', '出力カメラに反映')}
                </button>
              )}
            </>
          )}
          {options && (
            <>
              <label>
                <input type="checkbox" checked={useAuto} onChange={(e) => setAuto(e.target.checked)} />
                {t('Adaptive quality', '自動画質')}
              </label>
              <button className="btn" onClick={() => void fullscreen()}>
                {t('Fullscreen', '全画面')}
              </button>
              <label>
                {ja ? '描画倍率' : 'Resolution'}
                <select value={quality} onChange={(e) => setQuality(+e.target.value)}>
                  {[0.5, 1, 1.5, 2].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                FPS
                <select value={fps} onChange={(e) => setFps(+e.target.value)}>
                  {[15, 24, 30, 60].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                {ja ? 'スナップ' : 'Snap'}
                <input
                  type="number"
                  min={0}
                  max={90}
                  step=".1"
                  value={snap}
                  onChange={(e) => setSnap(Math.max(0, e.target.valueAsNumber || 0))}
                />
              </label>
              {editorCam && (
                <label>
                  {ja ? '軌道角度' : 'Orbit angle'}
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={angle}
                    onChange={(e) => setAngle(+e.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}
      {precision && selected && (
        <Precision
          lang={lang}
          layer={selected}
          projection={() => renderer.current?.manipulation(selected.id) ?? null}
          matchScale={
            neighbor
              ? () => {
                  const own = renderer.current?.selectionBounds(selected.id),
                    other = renderer.current?.selectionBounds(neighbor.id)
                  if (!own || !other || own.right - own.left < 1 || other.right - other.left < 1) return
                  const ratio = (other.right - other.left) / (own.right - own.left)
                  return clampTransform('scale', selected.scale.map((s) => s * ratio) as Vec3)
                }
              : undefined
          }
          change={(value) => patch(selected.id, value)}
          close={() => openPrecision(false)}
        />
      )}
      {snapOpen && (
        <SnapSettings
          lang={lang}
          snap={snapSettings}
          change={setSnapSettings}
          close={() => openSnap(false)}
        />
      )}
      {currentContext && (
        <Dialog title={t('Layer actions', 'レイヤー操作')} lang={lang} close={() => setContext(null)}>
          <div className="file-actions">
            <button
              disabled={currentContext.locked}
              onClick={() => {
                setContext(null)
                openPrecision(true)
              }}
            >
              {t('Precise transform', '精密変形')}
            </button>
            <button
              disabled={currentContext.locked}
              onClick={() => {
                centerLayer(currentContext)
                setContext(null)
              }}
            >
              {t('Center in frame', '画面中央に移動')}
            </button>
            <button
              onClick={() => {
                alignView('fit', currentContext.id)
                setContext(null)
              }}
            >
              {t('Focus layer', 'レイヤーに注目')}
            </button>
            <label>
              {t('Select another layer', '別のレイヤーを選択')}{' '}
              <select
                value={currentContext.id}
                onChange={(e) => {
                  props.onSelect([e.target.value])
                  setContext(e.target.value)
                }}
              >
                {project.layers
                  .filter((l) => l.visible)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </Dialog>
      )}
      <div className="scene-caption">
        <div className="scene-caption-icon">
          <Maximize size={17} />
        </div>
        <div>
          <small>{ja ? 'アクティブシーン' : 'ACTIVE SCENE'}</small>
          <h1>{project.name}</h1>
        </div>
        <span className="scene-info">
          {project.layers.length} {ja ? 'レイヤー' : project.layers.length === 1 ? 'layer' : 'layers'}
          <i />
          {media?.hasVideo ? (ja ? '動画' : 'Video') : ja ? '音声' : 'Audio'}
        </span>
      </div>
    </div>
  )
}
