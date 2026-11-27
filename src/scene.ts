import * as T from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { Point, Rect, Projection } from './studio/transform'
import type { AudioFrame } from './analysis'
import {
  evaluateLayer,
  evaluateScene,
  numericBounds,
  type Camera,
  type Layer,
  type Project,
  type Vec3,
} from './model'
import { disposeObject, type Visual } from './render/common'
import { Backdrop, caption, imagePlane, LocalTexture } from './render/media'
import { plugins } from './render/plugins'
import { Effects, setPassGain, type EffectPass } from './render/effects'
export { readPath } from './render/path'
export { plugins } from './render/plugins'

export interface RenderAssets {
  background?: CanvasImageSource | null
  images?: ReadonlyMap<string, CanvasImageSource>
  frameAt?: (time: number) => AudioFrame
  previewLod?: number
}
type Mode = 'translate' | 'rotate' | 'scale'
type Field = 'position' | 'rotation' | 'scale'
type Commit = (id: string, field: Field, values: Vec3) => void
type Node = {
  root: T.Group
  content: T.Group
  visual: Visual
  signature: string
  source?: CanvasImageSource
  texture: LocalTexture
}
const radians = T.MathUtils.degToRad
const noop = () => {}
function geometryKey(l: Layer) {
  const s = l.settings
  if (l.kind === 'text') {
    // Restoring a project can render a fallback caption before its local FontFace is ready.
    const ready = l.text.fontId
      ? Array.from(document.fonts).some((face) => face.family === l.text.font && face.status === 'loaded')
      : true
    return JSON.stringify([l.text, ready, l.material.color, l.material.shading, l.material.wireframe])
  }
  if (l.kind === 'group' || l.kind === 'image')
    return [l.kind, l.material.shading, l.material.wireframe].join('|')
  return [
    l.kind,
    l.style,
    l.shape,
    l.layout,
    l.material.shading,
    l.material.wireframe,
    s.count,
    s.rows,
    s.columns,
    s.history,
    s.path,
    s.closed,
    s.corner,
  ].join('|')
}
function visual(l: Layer, source?: CanvasImageSource): Visual {
  switch (l.kind) {
    case 'group':
      return { object: new T.Group(), update: noop }
    case 'text':
      return caption(l)
    case 'image':
      return imagePlane(l, source)
    case 'visualizer':
      return plugins[l.style].create(l)
  }
}

export class SceneRenderer {
  readonly renderer: T.WebGLRenderer
  readonly canvas: HTMLCanvasElement
  private width = 1
  private height = 1
  private readonly world = new T.Scene()
  private readonly overlay = new T.Scene()
  private readonly bg = new Backdrop()
  private fx?: Effects
  private readonly perspective = new T.PerspectiveCamera()
  private readonly ortho = new T.OrthographicCamera()
  private readonly fixed = new T.OrthographicCamera()
  private camera: T.Camera = this.perspective
  private editorCamera: Camera | null = null
  private readonly lamps = {
    ambient: new T.AmbientLight(),
    directional: new T.DirectionalLight(),
    point: new T.PointLight(),
    spot: new T.SpotLight(),
  }
  private readonly screenLight = new T.AmbientLight(0xffffff, 2)
  private readonly nodes = new Map<string, Node>()
  private controls?: TransformControls
  private selected: string | null = null
  private mode: Mode = 'translate'
  private commit: Commit = noop
  private before: Vec3 = [0, 0, 0]
  private base: Vec3 = [0, 0, 0]
  private project?: Project
  private lost = false
  private disposed = false
  private readonly lose = (event: Event) => {
    event.preventDefault()
    this.lost = true
  }
  private readonly restore = () => {
    this.lost = false
  }
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.toneMapping = T.NoToneMapping
    this.renderer.autoClear = false
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.world.add(...Object.values(this.lamps))
    this.overlay.add(this.screenLight)
    this.fixed.position.z = 50
    this.fixed.near = 0.01
    this.fixed.far = 500
    canvas.addEventListener('webglcontextlost', this.lose)
    canvas.addEventListener('webglcontextrestored', this.restore)
  }
  resize(width: number, height: number) {
    const w = Math.round(width),
      h = Math.round(height)
    if (w < 1 || h < 1 || !Number.isFinite(w * h)) throw Error('Invalid render size')
    if (this.width !== w || this.height !== h) {
      this.renderer.setSize(w, h, false)
      this.width = w
      this.height = h
    }
  }
  private interactionNode(id: string) {
    const node = this.nodes.get(id)
    if (!node || this.lost || this.disposed) return null
    let root: T.Object3D = node.root
    while (root.parent) {
      if (!root.visible) return null
      root = root.parent
    }
    return { node, camera: root === this.overlay ? this.fixed : this.camera, scene: root }
  }
  private projectPoint(v: T.Vector3, camera: T.Camera, rect: DOMRect): Point {
    const p = v.clone().project(camera)
    return { x: rect.left + ((p.x + 1) * rect.width) / 2, y: rect.top + ((1 - p.y) * rect.height) / 2 }
  }
  private visitBounds(root: T.Object3D, visit: (point: T.Vector3) => void) {
    const box = new T.Box3(),
      corner = new T.Vector3()
    for (const node of this.nodes.values()) {
      let ancestor: T.Object3D | null = node.content
      while (ancestor && ancestor.visible && ancestor !== root) ancestor = ancestor.parent
      if (ancestor !== root || !node.root.visible) continue
      if (node.visual.bounds) {
        node.visual.bounds(visit)
        continue
      }
      // Inspect geometry local to this layer; group descendants are visited independently.
      node.visual.object.traverseVisible((object) => {
        if (!(object instanceof T.Mesh || object instanceof T.Line)) return
        const geometry = object.geometry
        const attr = geometry.getAttribute('position')
        if (attr && geometry.userData.boundsRevision !== attr.version) {
          geometry.computeBoundingBox()
          geometry.userData.boundsRevision = attr.version
        }
        if (object instanceof T.InstancedMesh) {
          if (!object.boundingBox || object.userData.boundsRevision !== object.instanceMatrix.version) {
            object.computeBoundingBox()
            object.userData.boundsRevision = object.instanceMatrix.version
          }
          if (!object.boundingBox) return
          box.copy(object.boundingBox)
        } else {
          if (!geometry.boundingBox) geometry.computeBoundingBox()
          if (!geometry.boundingBox) return
          box.copy(geometry.boundingBox)
        }
        if (box.isEmpty()) return
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              visit(corner.set(x, y, z).applyMatrix4(object.matrixWorld))
            }
      })
    }
  }
  private projectedBounds(node: Node, camera: T.Camera, rect: DOMRect): Rect {
    const pivot = node.root.getWorldPosition(new T.Vector3())
    const center = this.projectPoint(pivot, camera, rect)
    const bounds: Rect = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
    const ndc = new T.Vector3(),
      eye = camera.getWorldPosition(new T.Vector3()),
      direction = camera.getWorldDirection(new T.Vector3())
    this.visitBounds(node.content, (vertex) => {
      if (ndc.copy(vertex).sub(eye).dot(direction) <= 0.01) return
      ndc.copy(vertex).project(camera)
      const x = rect.left + ((ndc.x + 1) * rect.width) / 2,
        y = rect.top + ((1 - ndc.y) * rect.height) / 2
      bounds.left = Math.min(bounds.left, x)
      bounds.right = Math.max(bounds.right, x)
      bounds.top = Math.min(bounds.top, y)
      bounds.bottom = Math.max(bounds.bottom, y)
    })
    if (!Number.isFinite(bounds.left))
      return { left: center.x, right: center.x, top: center.y, bottom: center.y }
    return bounds
  }
  selectionBounds(id: string) {
    const ref = this.interactionNode(id)
    return ref ? this.projectedBounds(ref.node, ref.camera, this.canvas.getBoundingClientRect()) : null
  }
  manipulation(id: string): Projection | null {
    const ref = this.interactionNode(id)
    if (!ref) return null
    const { node, camera, scene } = ref
    const rect = this.canvas.getBoundingClientRect()
    const world = node.root.getWorldPosition(new T.Vector3())
    const ndc = world.clone().project(camera)
    const snapshot = camera.clone()
    const inverse = node.root.parent!.matrixWorld.clone().invert()
    const matrix = node.root.parent!.matrixWorld.clone()
    return {
      world,
      center: this.projectPoint(world, camera, rect),
      origin: rect,
      parent: node.root.parent!.getWorldQuaternion(new T.Quaternion()),
      camera: camera.getWorldQuaternion(new T.Quaternion()),
      bounds: this.projectedBounds(node, camera, rect),
      neighbors: [...this.nodes.keys()]
        .filter((key) => key !== id)
        .flatMap((key) => {
          const item = this.interactionNode(key)
          return item?.scene === scene && this.project?.layers.find((l) => l.id === key)?.kind !== 'group'
            ? [this.projectedBounds(item.node, camera, rect)]
            : []
        }),
      toLocal: (p) =>
        new T.Vector3(
          (2 * (p.x - rect.left)) / rect.width - 1,
          1 - (2 * (p.y - rect.top)) / rect.height,
          ndc.z,
        )
          .unproject(snapshot)
          .applyMatrix4(inverse),
      toScreen: (p) => this.projectPoint(p.clone().applyMatrix4(matrix), snapshot, rect),
      worldFromLocal: (p) => p.clone().applyMatrix4(matrix),
      localFromWorld: (p) => p.clone().applyMatrix4(inverse),
      fixed: scene === this.overlay,
    }
  }
  focusBounds(id?: string) {
    const object = id ? this.interactionNode(id)?.node.content : this.world
    if (!object) return null
    const box = new T.Box3()
    this.visitBounds(object, (point) => box.expandByPoint(point))
    if (box.isEmpty()) return null
    const center = box.getCenter(new T.Vector3())
    let radiusSq = 0
    this.visitBounds(object, (point) => {
      radiusSq = Math.max(radiusSq, point.distanceToSquared(center))
    })
    return { center: center.toArray() as Vec3, radius: Math.sqrt(radiusSq) }
  }
  pickNear(x: number, y: number, slop: number) {
    const direct = this.pick(x, y)
    if (direct || !slop) return direct
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [0.7, 0.7],
      [0.7, -0.7],
      [-0.7, 0.7],
      [-0.7, -0.7],
    ]) {
      const near = this.pick(x + dx * slop, y + dy * slop)
      if (near) return near
    }
    return null
  }
  /** Hit-test the rendered layer geometry in CSS viewport coordinates. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    if (!this.project || !rect.width || !rect.height || this.disposed || this.lost) return null
    const pointer = new T.Vector2(
      (2 * (clientX - rect.left)) / rect.width - 1,
      1 - (2 * (clientY - rect.top)) / rect.height,
    )
    if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return null
    const ray = new T.Raycaster()
    ray.params.Line.threshold = 0.035
    for (const [scene, camera] of [
      [this.overlay, this.fixed],
      [this.world, this.camera],
    ] as const) {
      ray.setFromCamera(pointer, camera)
      let closest = Infinity,
        chosen: string | null = null
      for (const layer of this.project.layers) {
        const node = this.nodes.get(layer.id)
        if (!node || !node.root.visible || layer.kind === 'group' || layer.opacity <= 0) continue
        let parent: T.Object3D | null = node.root
        while (parent && parent.visible && parent !== scene) parent = parent.parent
        if (parent !== scene) continue
        const objects: T.Object3D[] = []
        node.visual.object.traverseVisible((object) => {
          if (object.userData.skipRaycast) return
          if (object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points) {
            // Vertex and instance transforms may have moved since the previous pick.
            object.geometry.computeBoundingSphere()
            if (object instanceof T.InstancedMesh) object.computeBoundingSphere()
            objects.push(object)
          }
        })
        const hit = ray.intersectObjects(objects, false)[0]
        if (hit && (!layer.depthTest || hit.distance <= closest)) {
          chosen = layer.id
          closest = layer.depthTest ? hit.distance : -Infinity
        }
      }
      if (chosen) return chosen
    }
    return null
  }
  setEditorCamera(camera: Camera | null) {
    this.editorCamera = camera
  }
  setGizmo(id: string | null, mode: Mode, commit: Commit, snap = 0) {
    this.selected = id
    this.mode = mode
    this.commit = commit
    if (!id) {
      this.controls?.detach()
      return
    }
    if (!this.controls) {
      this.controls = new TransformControls(this.camera, this.canvas)
      this.controls.setSize(0.72)
      const controls = this.controls
      controls.addEventListener('mouseDown', () => {
        const layer = this.project?.layers.find((l) => l.id === this.selected),
          object = controls.object
        if (!layer || !object) return
        const field = this.gizmoField()
        this.before = this.readTransform(object, field)
        this.base = [...layer[field]]
      })
      controls.addEventListener('mouseUp', () => {
        const o = controls.object,
          id = this.selected
        if (!o || !id) return
        const field = this.gizmoField(),
          v = this.readTransform(o, field)
        const value = this.base.map((base, i) =>
          field === 'scale' && this.before[i] !== 0
            ? (base * v[i]) / this.before[i]
            : base + v[i] - this.before[i],
        ) as Vec3
        const layer = this.project?.layers.find((l) => l.id === id)
        if (field === 'scale' && layer?.lockAspect) {
          const axis = [0, 1, 2].reduce(
            (best, i) =>
              Math.abs(v[i] / this.before[i] - 1) > Math.abs(v[best] / this.before[best] - 1) ? i : best,
            0,
          )
          for (let i = 0; i < 3; i++) value[i] = (this.base[i] * v[axis]) / this.before[axis]
        }
        const [min, max] = numericBounds(field + '.x')
        const bounded = value.map((n) => T.MathUtils.clamp(n, min, max)) as Vec3
        if (bounded.every(Number.isFinite) && bounded.some((n, i) => Math.abs(n - this.base[i]) > 1e-7))
          this.commit(id, field, bounded)
      })
    }
    this.controls.setMode(mode)
    this.controls.setTranslationSnap(snap || null)
    this.controls.setRotationSnap(snap ? radians(snap) : null)
    this.controls.setScaleSnap(snap || null)
  }
  private gizmoField(): Field {
    return this.mode === 'translate' ? 'position' : this.mode === 'rotate' ? 'rotation' : 'scale'
  }
  private readTransform(o: T.Object3D, f: Field): Vec3 {
    return f === 'rotation'
      ? ([o.rotation.x, o.rotation.y, o.rotation.z].map(T.MathUtils.radToDeg) as Vec3)
      : (o[f].toArray() as Vec3)
  }
  private configureCamera(c: Camera) {
    const a = this.width / this.height,
      portrait = Math.min(1, a)
    const camera = c.projection === 'perspective' ? this.perspective : this.ortho
    if (camera instanceof T.PerspectiveCamera) {
      camera.aspect = a
      camera.fov = c.fov
    } else {
      const half = c.orthoSize / 2
      camera.left = -half * a
      camera.right = half * a
      camera.top = half
      camera.bottom = -half
    }
    camera.near = c.near
    camera.far = c.far
    camera.zoom = c.zoom * portrait
    camera.updateProjectionMatrix()
    const target = new T.Vector3(...c.target)
    camera.position
      .set(...c.position)
      .sub(target)
      .applyAxisAngle(new T.Vector3(0, 1, 0), radians(c.orbit))
      .add(target)
    camera.up.set(0, 1, 0)
    camera.lookAt(target)
    camera.rotateZ(radians(c.roll))
    camera.updateMatrixWorld()
    this.camera = camera
    this.fixed.left = (-3.5 * a) / portrait
    this.fixed.right = -this.fixed.left
    this.fixed.top = 3.5 / portrait
    this.fixed.bottom = -this.fixed.top
    this.fixed.updateProjectionMatrix()
  }
  private ensureNode(l: Layer, source?: CanvasImageSource) {
    let n = this.nodes.get(l.id)
    const key = geometryKey(l)
    if (!n) {
      const root = new T.Group(),
        content = new T.Group(),
        v = visual(l, source)
      root.add(content)
      content.add(v.object)
      n = { root, content, visual: v, signature: key, source, texture: new LocalTexture() }
      this.nodes.set(l.id, n)
    } else if (n.signature !== key || n.source !== source) {
      const v = visual(l, source)
      n.content.remove(n.visual.object)
      n.visual.dispose?.()
      disposeObject(n.visual.object)
      n.visual = v
      n.content.add(v.object)
      n.signature = key
      n.source = source
    }
    return n
  }
  private removeNode(id: string, n: Node) {
    if (this.controls?.object === n.root) this.controls.detach()
    n.root.removeFromParent()
    n.visual.dispose?.()
    disposeObject(n.visual.object)
    n.texture.dispose()
    this.nodes.delete(id)
  }
  render(project: Project, time: number, audio: AudioFrame, assets: RenderAssets = {}) {
    if (this.disposed) throw Error('Renderer disposed')
    if (this.lost || this.renderer.getContext().isContextLost()) throw Error('WebGL context lost')
    this.project = project
    const evaluated = evaluateScene(project, time, audio)
    const lod = Math.max(0.4, Math.min(1, assets.previewLod ?? 1))
    const level = lod >= 0.8 ? 1 : lod >= 0.58 ? 0.7 : 0.5
    const preview = (layer: Layer): Layer => {
      if (layer.kind !== 'visualizer' || level === 1) return layer
      const s = layer.settings
      const density = (n: number, floor: number) => Math.min(n, Math.max(floor, Math.round(n * level)))
      if (layer.style === 'galaxy' || layer.style === 'particles' || layer.style === 'globe')
        return { ...layer, settings: { ...s, count: density(s.count, 30) } }
      if (layer.style === 'terrain' || layer.style === 'waterfall' || layer.style === 'spectrogram')
        return {
          ...layer,
          settings: { ...s, columns: density(s.columns, 20), history: density(s.history, 12) },
        }
      return layer
    }
    const keys = new Set(project.layers.map((l) => l.id))
    for (const [id, n] of this.nodes) if (!keys.has(id)) this.removeNode(id, n)
    const currentLayers = evaluated.layers.map((layer) => evaluateLayer(layer, time, audio, evaluated.seed))
    const layerEffects = {
      bloom: currentLayers.some(
        (layer) => layer.visible && layer.kind !== 'group' && layer.effects.bloom > 0,
      ),
      trail: currentLayers.some(
        (layer) => layer.visible && layer.kind !== 'group' && layer.effects.trail > 0,
      ),
    }
    let preparedDelay = -1
    const draw = (delay: number, pass: EffectPass) => {
      const restoreBlends: (() => void)[] = []
      const t = Math.max(0, time - delay)
      const signal =
        delay > 0
          ? (assets.frameAt?.(t) ?? {
              ...audio,
              bands: audio.history(delay),
              history: (ago: number) => audio.history(ago + delay),
            })
          : audio
      const p = delay > 0 ? evaluateScene(project, t, signal) : evaluated
      this.configureCamera(this.editorCamera ?? p.camera)
      let shadows = false
      for (const key of ['ambient', 'directional', 'point', 'spot'] as const) {
        const source = p.lights[key],
          lamp = this.lamps[key]
        lamp.color.set(source.color)
        lamp.intensity = source.intensity
        lamp.position.set(...source.position)
        lamp.visible = source.intensity > 0
        lamp.castShadow = key !== 'ambient' && source.shadow
        shadows ||= lamp.visible && lamp.castShadow
      }
      this.renderer.shadowMap.enabled = shadows
      const layers = delay === 0 ? currentLayers : p.layers.map((l) => evaluateLayer(l, t, signal, p.seed))
      const byId = new Map(layers.map((l) => [l.id, l] as const))
      const drawn = layers.map(preview)
      for (const l of drawn) this.ensureNode(l, l.imageId ? assets.images?.get(l.imageId) : undefined)
      const screen = new Map<string, boolean>()
      const isFixed = (l: Layer): boolean => {
        if (screen.has(l.id)) return screen.get(l.id)!
        screen.set(l.id, l.screenSpace)
        const parent = l.parentId ? byId.get(l.parentId) : undefined
        const result = l.screenSpace || Boolean(parent && isFixed(parent))
        screen.set(l.id, result)
        return result
      }
      drawn.forEach((l, i) => {
        const n = this.nodes.get(l.id)!,
          parent = l.parentId ? byId.get(l.parentId) : undefined
        const fixed = isFixed(l),
          scene = fixed ? this.overlay : this.world
        const target = parent && isFixed(parent) === fixed ? this.nodes.get(parent.id)!.content : scene
        if (n.root.parent !== target) target.add(n.root)
        if (!(this.controls?.dragging && this.controls.object === n.root)) {
          n.root.position.set(...l.position)
          n.root.scale.set(...l.scale)
          n.root.rotation.set(radians(l.rotation[0]), radians(l.rotation[1]), radians(l.rotation[2]))
        }
        let opacity = l.opacity,
          visible = l.visible,
          ancestor = parent
        while (ancestor) {
          opacity *= ancestor.opacity
          visible &&= ancestor.visible
          ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
        }
        n.content.position.set(-l.pivot[0], -l.pivot[1], -l.pivot[2])
        n.root.visible = visible
        n.root.renderOrder = i * 4
        n.content.renderOrder = i * 4
        if (!visible) return
        if (delay !== preparedDelay)
          n.visual.update({
            layer: opacity === l.opacity ? l : { ...l, opacity },
            audio: signal,
            time: t,
            seed: p.seed + i * 313,
          })
        const map = l.material.textureId ? assets.images?.get(l.material.textureId) : null
        const tex = n.texture.update(map)
        n.visual.object.traverse((o) => {
          o.renderOrder = i * 4 + (o instanceof T.LineSegments ? 1 : 0)
          if (o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points) {
            for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
              const restore = setPassGain(material, pass, l.effects)
              if (restore) restoreBlends.push(restore)
            }
          }
          if (l.kind === 'visualizer' && l.style !== 'prism' && o instanceof T.Mesh) {
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if ('map' in m && m.map !== tex) {
                m.map = tex
                m.needsUpdate = true
              }
            }
          }
        })
      })
      if (this.controls) {
        const layer = this.selected ? byId.get(this.selected) : null,
          object = layer ? this.nodes.get(layer.id)?.root : null
        if (pass === 'scene' && delay === 0 && layer?.visible && !layer.locked && object) {
          const scene = isFixed(layer) ? this.overlay : this.world
          const helper = this.controls.getHelper()
          if (helper.parent !== scene) scene.add(helper)
          this.controls.camera = isFixed(layer) ? this.fixed : this.camera
          if (this.controls.object !== object) this.controls.attach(object)
          this.controls.enabled = true
          helper.visible = true
        } else {
          this.controls.getHelper().visible = false
          if (!layer || layer.locked || !layer.visible) {
            this.controls.enabled = false
            this.controls.detach()
          }
        }
      }
      preparedDelay = delay
      try {
        if (pass === 'scene')
          this.bg.draw(
            this.renderer,
            this.camera,
            p.background,
            this.width,
            this.height,
            assets.background ?? (p.background.imageId ? assets.images?.get(p.background.imageId) : null),
          )
        else {
          this.renderer.setClearColor(0, 1)
          this.renderer.clear()
        }
        this.renderer.render(this.world, this.camera)
        this.renderer.clearDepth()
        this.renderer.render(this.overlay, this.fixed)
      } finally {
        for (const restore of restoreBlends) restore()
      }
    }
    if (
      evaluated.effects.bloom > 0 ||
      evaluated.effects.trail > 0 ||
      layerEffects.bloom ||
      layerEffects.trail
    ) {
      this.fx ??= new Effects()
      this.fx.render(
        this.renderer,
        this.width,
        this.height,
        level === 0.5 ? { ...evaluated.effects, trail: 0 } : evaluated.effects,
        level === 0.5 ? { ...layerEffects, trail: false } : layerEffects,
        draw,
      )
    } else {
      if (this.fx) {
        this.fx.dispose()
        this.fx = undefined
      }
      draw(0, 'scene')
    }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const [id, n] of this.nodes) this.removeNode(id, n)
    this.controls?.dispose()
    this.bg.dispose()
    this.fx?.dispose()
    for (const lamp of [this.lamps.point, this.lamps.directional, this.lamps.spot]) lamp.shadow.dispose()
    this.canvas.removeEventListener('webglcontextlost', this.lose)
    this.canvas.removeEventListener('webglcontextrestored', this.restore)
    this.renderer.dispose()
    if (!this.canvas.isConnected) this.renderer.forceContextLoss()
  }
}
