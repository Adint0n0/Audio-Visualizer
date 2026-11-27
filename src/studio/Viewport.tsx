import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Box,
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
import type { Project, Vec3 } from '../model'
import { silentFrame } from '../analysis'
import type { MediaSourceData } from '../media'
import { errorText, type Lang } from './hooks'

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
  const down = useRef<[number, number] | null>(null)
  const view = useRef({ editorCam, angle, fps, quality, tool })
  view.current = { editorCam, angle, fps, quality, tool }
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
    const observe = new ResizeObserver(() => {
      dirty = true
    })
    observe.observe(el)
    // A native seek completes after the timeline UI updates, so invalidate the paused preview again.
    const nativeVideo = latest.current.video.current
    const invalidate = () => {
      dirty = true
    }
    nativeVideo?.addEventListener('seeked', invalidate)
    nativeVideo?.addEventListener('loadeddata', invalidate)
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
      const width = Math.max(1, Math.round(el.clientWidth * config.quality)),
        height = Math.max(1, Math.round(el.clientHeight * config.quality))
      if (!el.clientWidth) return
      try {
        if (oldWidth !== width || oldHeight !== height) {
          r.resize(width, height)
          oldWidth = width
          oldHeight = height
        }
        const p = current.project
        if (config.editorCam) {
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
        })
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
  return (
    <div className="viewport" ref={root}>
      <header className="viewport-head">
        <h2>
          <Box size={17} />
          {ja ? 'ビューポート' : 'Viewport'}
        </h2>
        <div className="view-controls">
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
          <button className="icon-btn" title={ja ? '全画面' : 'Fullscreen'} onClick={fullscreen}>
            <Expand size={16} />
          </button>
        </div>
      </header>
      <div className="stage-space">
        <div className="stage-frame" style={{ '--ratio': ratio } as React.CSSProperties}>
          <canvas
            ref={canvas}
            onPointerDown={(e) => {
              down.current = [e.clientX, e.clientY]
            }}
            onPointerUp={(e) => {
              if (
                tool === 'select' &&
                down.current &&
                Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) < 5
              ) {
                const id = renderer.current?.pick(e.clientX, e.clientY)
                props.onSelect(id ? [id] : [])
              }
              down.current = null
            }}
            aria-label={ja ? '3D シーンプレビュー' : '3D scene preview'}
          />
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
              onClick={() => setTool(id)}
              className={'icon-btn ' + (tool === id ? 'active' : '')}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <button
          className="camera-toggle"
          title={ja ? 'カメラ切替' : 'Switch camera'}
          onClick={() => setEditorCam(!editorCam)}
        >
          <CameraIcon size={14} />
          {editorCam ? (ja ? '編集カメラ' : 'Editor camera') : ja ? '出力カメラ' : 'Output camera'}
          <ChevronDown size={12} />
        </button>
        <button
          className={'icon-btn ' + (options ? 'on' : '')}
          title={ja ? 'プレビュー設定' : 'Preview settings'}
          onClick={() => setOptions(!options)}
        >
          <SlidersHorizontal size={16} />
        </button>
      </footer>
      {options && (
        <div className="view-options">
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
        </div>
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
