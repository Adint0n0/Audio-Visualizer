import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { SceneRenderer } from '../scene'
import type { Camera, Layer } from '../model'
import {
  contacts,
  moveView,
  transformLayer,
  type Contacts,
  type Guides,
  type Latch,
  type Mode,
  type Point,
  type Segment,
  type Snap,
  type Transform,
} from './transform'

type Config = {
  renderer: RefObject<SceneRenderer | null>
  layer?: Layer
  camera: Camera
  mode: Mode
  snap: Snap
  select(id: string | null): void
  hold(id: string): void
  view(camera: Camera): void
  commit(id: string, value: Transform): void
}
type Sequence = {
  segment?: Segment
  input: Contacts
  camera: Camera
  layer?: Layer
  rect: DOMRect
  cameraDraft?: Camera
  value?: Transform
  moved: boolean
  holdId?: string
  multi: boolean
  previousCamera: Camera
  lastGuides: Guides
  latch: Latch
}
export function useGestures(config: Config) {
  const latest = useRef(config)
  latest.current = config
  const fingers = useRef(new Map<number, Point>())
  const active = useRef<Sequence | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [draft, setDraft] = useState<{ id: string; transform: Transform } | null>(null)
  const [guides, setGuides] = useState<Guides>({})
  const [holding, setHolding] = useState(false)
  const clear = () => clearTimeout(timer.current)
  function cancel() {
    clear()
    if (active.current?.cameraDraft) latest.current.view(active.current.previousCamera)
    active.current = null
    fingers.current.clear()
    setDraft(null)
    setGuides({})
    setHolding(false)
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('orientationchange', cancel)
    window.screen.orientation?.addEventListener('change', cancel)
    document.addEventListener('visibilitychange', hide)
    return () => {
      clear()
      window.removeEventListener('blur', cancel)
      window.removeEventListener('orientationchange', cancel)
      window.screen.orientation?.removeEventListener('change', cancel)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [])
  useEffect(() => {
    cancel()
  }, [config.mode, config.layer?.id])
  function base(sequence: Sequence) {
    const current = latest.current
    sequence.input = contacts([...fingers.current.values()])
    sequence.multi ||= fingers.current.size > 1
    sequence.camera = sequence.cameraDraft ?? current.camera
    sequence.latch = {}
    if (!sequence.layer) return
    const p = current.renderer.current?.manipulation(sequence.layer.id)
    if (!p) return
    const layer = { ...sequence.layer, ...sequence.value }
    // Compute the new pivot from the last gesture values even if a paint has not run yet.
    if (sequence.segment && sequence.value) {
      const previous = sequence.segment
      const from = previous.projection.toLocal(previous.projection.center)
      const point = from.clone()
      for (const [axis, i] of [
        ['x', 0],
        ['y', 1],
        ['z', 2],
      ] as const)
        point[axis] += layer.position[i] - previous.layer.position[i]
      const center = previous.projection.toScreen(point)
      const dx = center.x - p.center.x,
        dy = center.y - p.center.y
      p.bounds = {
        left: p.bounds.left + dx,
        right: p.bounds.right + dx,
        top: p.bounds.top + dy,
        bottom: p.bounds.bottom + dy,
      }
      p.center = center
    }
    sequence.segment = { projection: p, layer, input: sequence.input }
  }
  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (fingers.current.size >= 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const location = { x: e.clientX, y: e.clientY }
    fingers.current.set(e.pointerId, location)
    const current = latest.current
    let sequence = active.current
    if (!sequence) {
      sequence = {
        input: contacts([location]),
        camera: current.camera,
        previousCamera: current.camera,
        layer:
          current.mode === 'view' || current.layer?.locked || !current.layer?.visible
            ? undefined
            : current.layer,
        rect: e.currentTarget.getBoundingClientRect(),
        moved: false,

        multi: false,
        latch: {},
        lastGuides: {},
      }
      active.current = sequence
      if (e.pointerType !== 'mouse' && current.mode !== 'view') {
        timer.current = setTimeout(() => {
          if (!sequence || sequence.moved || sequence.multi) return
          const id = current.renderer.current?.pickNear(location.x, location.y, 12) ?? current.layer?.id
          if (id) {
            sequence.holdId = id
            setHolding(true)
          }
        }, 520)
      }
    } else {
      clear()
      sequence.holdId = undefined
      setHolding(false)
    }
    base(sequence)
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const sequence = active.current
    if (!sequence || !fingers.current.has(e.pointerId)) return
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const next = contacts([...fingers.current.values()]),
      before = sequence.input
    if (
      !sequence.moved &&
      next.center.distanceTo(before.center) < 5 &&
      Math.abs(next.distance - before.distance) < 4 &&
      Math.abs(next.angle - before.angle) < 0.04
    )
      return
    sequence.moved = true
    sequence.holdId = undefined
    setHolding(false)
    clear()
    const current = latest.current
    if (current.mode === 'view') {
      sequence.cameraDraft = moveView(sequence.camera, before, next, sequence.rect)
      current.view(sequence.cameraDraft)
    } else if (sequence.segment && sequence.layer) {
      const { result, guides: nextGuides } = transformLayer(
        sequence.segment,
        next,
        current.mode,
        current.snap,
        sequence.latch,
      )
      sequence.value = result
      setDraft({ id: sequence.layer.id, transform: result })
      if (current.snap.haptic && Object.keys(nextGuides).some((key) => !(key in sequence.lastGuides)))
        navigator.vibrate?.(8)
      sequence.lastGuides = nextGuides
      setGuides(nextGuides)
    }
  }
  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (!fingers.current.delete(e.pointerId)) return
    clear()
    const sequence = active.current
    if (!sequence) return
    if (fingers.current.size) {
      base(sequence)
      return
    }
    active.current = null
    const current = latest.current
    if (sequence.value && sequence.layer) current.commit(sequence.layer.id, sequence.value)
    else if (!sequence.moved && !sequence.multi && sequence.holdId) {
      const id = sequence.holdId
      requestAnimationFrame(() => current.hold(id))
    } else if (!sequence.moved && !sequence.multi && current.mode !== 'view') {
      current.select(
        current.renderer.current?.pickNear(e.clientX, e.clientY, e.pointerType === 'mouse' ? 0 : 12) ?? null,
      )
    }
    setHolding(false)
    setDraft(null)
    setGuides({})
  }
  return {
    draft,
    guides,
    holding,
    cancel,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancel,
      onLostPointerCapture: (e: PointerEvent<HTMLCanvasElement>) => {
        if (fingers.current.has(e.pointerId)) cancel()
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  }
}
