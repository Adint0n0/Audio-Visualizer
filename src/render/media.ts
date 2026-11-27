import * as T from 'three'
import type { Background, Layer } from '../model'
import { surface, updateMaterial, type Visual } from './common'

export function dimensions(source: CanvasImageSource): [number, number] {
  if (source instanceof HTMLVideoElement) return [source.videoWidth, source.videoHeight]
  if (source instanceof HTMLImageElement) return [source.naturalWidth, source.naturalHeight]
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame)
    return [source.displayWidth, source.displayHeight]
  if (source instanceof SVGImageElement) return [source.width.baseVal.value, source.height.baseVal.value]
  const img = source as ImageBitmap
  return [img.width, img.height]
}

export class LocalTexture {
  source: CanvasImageSource | null = null
  texture: T.Texture | null = null
  update(source?: CanvasImageSource | null) {
    if ((source ?? null) !== this.source) {
      this.dispose()
      if (source) {
        this.source = source
        this.texture =
          source instanceof HTMLVideoElement
            ? new T.VideoTexture(source)
            : new T.Texture(source as TexImageSource)
        this.texture.colorSpace = T.SRGBColorSpace
        this.texture.minFilter = T.LinearFilter
        this.texture.magFilter = T.LinearFilter
        this.texture.generateMipmaps = false
        this.texture.needsUpdate = true
      }
    } else if (
      this.texture &&
      (source instanceof HTMLCanvasElement ||
        (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas))
    ) {
      this.texture.needsUpdate = true
    }
    return this.texture
  }
  dispose() {
    this.texture?.dispose()
    this.texture = null
    this.source = null
  }
}

const planeVertex = 'varying vec2 coord; void main(){coord=uv;gl_Position=vec4(position.xy,0.,1.);}'
export const fullScreenVertex = planeVertex
export class Backdrop {
  readonly scene = new T.Scene()
  readonly local = new LocalTexture()
  readonly mat = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      picture: { value: null },
      scale: { value: new T.Vector2(1, 1) },
      offset: { value: new T.Vector2() },
      angle: { value: 0 },
      viewRatio: { value: 1 },
      videoDecode: { value: false },
      grade: { value: new T.Vector4(1, 1, 1, 0) },
      blur: { value: new T.Vector2() },
      fill: { value: new T.Color() },
    },
    vertexShader: planeVertex,
    fragmentShader: `
    uniform sampler2D picture;uniform bool videoDecode;uniform vec2 scale,offset,blur;uniform float angle,viewRatio;uniform vec4 grade;uniform vec3 fill;
    varying vec2 coord;
    vec4 fetchLinear(vec2 uv){
      vec4 sampleColor=texture2D(picture,uv);
      return videoDecode ? sRGBTransferEOTF(sampleColor) : sampleColor;
    }
    void main(){
      vec2 p=coord-.5-offset;
      vec2 rotated=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*(p*vec2(viewRatio,1.));
      vec2 uv=rotated*scale/vec2(viewRatio,1.)+.5;
      if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){gl_FragColor=vec4(fill,1.);}
      else{
        vec4 c=fetchLinear(uv);
        if(dot(blur,blur)>0.){
          c*=.4;
          for(int i=0;i<8;i++){float a=float(i)*.785398;c+=.075*fetchLinear(uv+blur*vec2(cos(a),sin(a)));}
        }
        vec3 gray=vec3(dot(c.rgb,vec3(.2126,.7152,.0722)));
        vec3 rgb=mix(gray,c.rgb,grade.z);
        vec3 axis=normalize(vec3(1));
        rgb=rgb*cos(grade.w)+cross(axis,rgb)*sin(grade.w)+axis*dot(axis,rgb)*(1.-cos(grade.w));
        rgb=max(vec3(0.),(rgb-.18)*grade.y+.18)*grade.x;
        gl_FragColor=vec4(mix(fill,rgb,c.a),1.);
      }
      #include <colorspace_fragment>
    }`,
  })
  readonly quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.mat)
  constructor() {
    this.scene.add(this.quad)
    this.quad.frustumCulled = false
  }
  draw(
    renderer: T.WebGLRenderer,
    camera: T.Camera,
    b: Background,
    aspect: number,
    source?: CanvasImageSource | null,
  ) {
    const u = this.mat.uniforms
    renderer.setClearColor(b.color, 1)
    renderer.clear()
    const tex = this.local.update(source)
    if (!tex || !source) return
    const [iw, ih] = dimensions(source)
    if (iw <= 0 || ih <= 0) return
    const ratio = aspect / (iw / ih)
    let sx = 1,
      sy = 1
    if (b.fit === 'cover') {
      sx = Math.min(1, ratio)
      sy = Math.min(1, 1 / ratio)
    }
    if (b.fit === 'contain') {
      sx = Math.max(1, ratio)
      sy = Math.max(1, 1 / ratio)
    }
    u.picture.value = tex
    u.videoDecode.value = tex instanceof T.VideoTexture
    u.scale.value.set(sx / b.zoom, sy / b.zoom)
    u.viewRatio.value = aspect
    u.offset.value.set(b.x / 100, b.y / 100)
    u.angle.value = T.MathUtils.degToRad(b.rotation)
    u.grade.value.set(b.brightness, b.contrast, b.saturation, T.MathUtils.degToRad(b.hue))
    u.blur.value.set(b.blur / iw, b.blur / ih)
    u.fill.value.set(b.color)
    renderer.render(this.scene, camera)
  }
  dispose() {
    this.local.dispose()
    this.quad.geometry.dispose()
    this.mat.dispose()
  }
}
export function caption(l: Layer): Visual {
  const c = document.createElement('canvas'),
    ctx = c.getContext('2d')!
  const t = l.text,
    lines = t.content.split('\n').slice(0, 128),
    px = 96
  const font = px + 'px ' + t.font
  ctx.font = font
  const track = t.tracking * px,
    widths = lines.map((line) =>
      Math.max(1, ctx.measureText(line).width + Math.max(0, [...line].length - 1) * track),
    )
  const margin = Math.ceil(px * 0.3 + t.strokeWidth + t.shadow * 2)
  const w = Math.max(...widths) + 2 * margin,
    h = px * (1.35 + Math.max(0, lines.length - 1) * t.leading) + 2 * margin
  const factor = Math.min(1, 4096 / w, 4096 / h)
  c.width = Math.ceil(w * factor)
  c.height = Math.ceil(h * factor)
  ctx.scale(factor, factor)
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = l.material.color
  ctx.lineJoin = 'round'
  ctx.strokeStyle = t.stroke
  ctx.lineWidth = t.strokeWidth
  ctx.shadowColor = 'rgba(0,0,0,.8)'
  ctx.shadowBlur = t.shadow
  ctx.shadowOffsetY = t.shadow * 0.35
  lines.forEach((line, i) => {
    let x = t.align === 'left' ? margin : t.align === 'right' ? w - margin - widths[i] : (w - widths[i]) / 2
    const y = margin + px + i * px * t.leading
    if (!track) {
      if (t.strokeWidth) ctx.strokeText(line, x, y)
      ctx.fillText(line, x, y)
    } else
      for (const ch of line) {
        if (t.strokeWidth) ctx.strokeText(ch, x, y)
        ctx.fillText(ch, x, y)
        x += ctx.measureText(ch).width + track
      }
  })
  const tex = new T.CanvasTexture(c)
  tex.colorSpace = T.SRGBColorSpace
  const m = surface(l)
  m.map = tex
  const object = new T.Mesh(new T.PlaneGeometry((w / px) * t.size, (h / px) * t.size), m)
  return {
    object,
    update(f) {
      updateMaterial(m, f.layer)
      m.transparent = true
      m.depthWrite = false
      m.alphaTest = 0.005
      object.castShadow = f.layer.material.shadow
      object.receiveShadow = f.layer.material.shadow
    },
    dispose() {
      tex.dispose()
    },
  }
}
export function imagePlane(l: Layer, source?: CanvasImageSource): Visual {
  const tex = new LocalTexture(),
    mat = surface(l)
  mat.map = tex.update(source)
  const object = new T.Mesh(new T.PlaneGeometry(1, 1), mat)
  if (source) {
    const [w, h] = dimensions(source)
    object.scale.set(h > 0 ? w / h : 1, 1, 1)
  } else object.visible = false
  return {
    object,
    update(f) {
      updateMaterial(mat, f.layer)
      mat.transparent = true
      mat.depthWrite = false
      mat.alphaTest = 0.005
      mat.color.set(f.layer.material.color)
      object.castShadow = f.layer.material.shadow
      object.receiveShadow = f.layer.material.shadow
    },
    dispose() {
      tex.dispose()
    },
  }
}
