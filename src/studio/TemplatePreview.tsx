import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { SceneRenderer } from '../scene'
import { demoFrame } from '../analysis'
import type { Project } from '../model'
import type { Lang } from './hooks'

export function TemplatePreview({
  project,
  poster,
  lang,
  renderStill,
}: {
  project: Project
  poster: string
  lang: Lang
  renderStill: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [play, setPlay] = useState(false),
    [failed, setFailed] = useState(false)
  const visible = (play || renderStill) && !failed
  useEffect(() => {
    if (!visible || !canvas.current) return
    let renderer: SceneRenderer | undefined
    let animation = 0
    try {
      const el = canvas.current
      renderer = new SceneRenderer(el)
      renderer.resize(480, 270)
      const start = performance.now()
      let last = start - 100
      const draw = (now: number) => {
        try {
          if (now - last >= 65) {
            const t = play ? (((now - start) / 1000) % 10) + 1.2 : 2.4
            renderer?.render(project, t, demoFrame(t), { frameAt: demoFrame, previewLod: 0.66 })
            last = now
          }
          if (play) animation = requestAnimationFrame(draw)
        } catch {
          setFailed(true)
        }
      }
      draw(start)
    } catch {
      setFailed(true)
    }
    return () => {
      cancelAnimationFrame(animation)
      renderer?.dispose()
    }
  }, [project, play, visible])
  return (
    <div className="template-live">
      {visible ? (
        <canvas ref={canvas} aria-label={lang === 'ja' ? 'テンプレートの描画' : 'Rendered scene preview'} />
      ) : (
        <img className="template-sample" src={poster} alt="" />
      )}
      <button
        className="btn"
        aria-pressed={play}
        onClick={() => {
          setFailed(false)
          setPlay(!play)
        }}
      >
        {play ? <Pause size={16} /> : <Play size={16} />}
        {play
          ? lang === 'ja'
            ? '停止'
            : 'Stop preview'
          : lang === 'ja'
            ? '動きをプレビュー'
            : 'Preview motion'}
      </button>
    </div>
  )
}
