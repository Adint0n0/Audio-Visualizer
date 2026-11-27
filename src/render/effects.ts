import * as T from 'three'
import { fullScreenVertex } from './media'

type Strength = { bloom: number; trail: number }
export type EffectPass = 'scene' | 'bloom' | 'trail'

// Inject at the linear-light output of the normal material so its shape, texture,
// alpha discard and depth occlusion agree with the main render. Opaque unselected
// surfaces contribute black to the mask and still hide the objects behind them.
const uniforms = new WeakMap<T.Material, { value: number }>()
export function setPassGain(material: T.Material, pass: EffectPass, strength: Strength) {
  let gain = uniforms.get(material)
  if (!gain && pass === 'scene') return undefined
  if (!gain) {
    gain = { value: -1 }
    uniforms.set(material, gain)
    const uniform = gain
    const before = material.onBeforeCompile.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer)
      shader.uniforms.layerEffectGain = uniform
      shader.fragmentShader =
        'uniform float layerEffectGain;\n' +
        shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `if (layerEffectGain >= 0.0) gl_FragColor.rgb *= layerEffectGain;
        #include <tonemapping_fragment>`,
        )
    }
    material.needsUpdate = true
  }
  // The bloom mask reserves headroom for the 0–3 strength range on RGBA8 GPUs.
  gain.value = pass === 'scene' ? -1 : pass === 'bloom' ? strength.bloom / 3 : strength.trail
  // A contributing multiply layer needs a source color in the isolated mask;
  // multiplying the clear black would erase it. Restore its normal blend after capture.
  if (gain.value > 0 && material.blending === T.MultiplyBlending) {
    material.blending = T.NormalBlending
    return () => {
      material.blending = T.MultiplyBlending
    }
  }
  return undefined
}

// Absolute-time taps retain no history between frames, including when changing
// ranges or seeking backwards. Only active targets allocate more than one pixel.
export class Effects {
  readonly current = new T.WebGLRenderTarget(1, 1)
  readonly history = [new T.WebGLRenderTarget(1, 1), new T.WebGLRenderTarget(1, 1)]
  readonly layerHistory = [new T.WebGLRenderTarget(1, 1), new T.WebGLRenderTarget(1, 1)]
  readonly layerBloom = new T.WebGLRenderTarget(1, 1)
  readonly scene = new T.Scene()
  readonly camera = new T.Camera()
  readonly mat = new T.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    vertexShader: fullScreenVertex,
    uniforms: {
      base: { value: null },
      prevA: { value: null },
      prevB: { value: null },
      localA: { value: null },
      localB: { value: null },
      localGlow: { value: null },
      pixel: { value: new T.Vector2() },
      bloom: { value: 0 },
      trail: { value: 0 },
      hasLocalBloom: { value: false },
      hasLocalTrail: { value: false },
    },
    fragmentShader: `uniform sampler2D base,prevA,prevB,localA,localB,localGlow;
    uniform vec2 pixel;uniform float bloom,trail;uniform bool hasLocalBloom,hasLocalTrail;
    varying vec2 coord;
    void main(){
      vec3 c=texture2D(base,coord).rgb;
      if(trail>0.) c=max(c,trail*(.58*texture2D(prevA,coord).rgb+.37*texture2D(prevB,coord).rgb));
      if(hasLocalTrail) c=max(c,.58*texture2D(localA,coord).rgb+.37*texture2D(localB,coord).rgb);
      if(bloom>0. || hasLocalBloom){
        vec3 halo=vec3(0.);
        for(int i=0;i<12;i++){
          float a=float(i)*.523599;
          vec2 v=vec2(cos(a),sin(a))*pixel;
          if(bloom>0.){
            vec3 sampleColor=.6*texture2D(base,coord+v*3.).rgb+.4*texture2D(base,coord+v*8.).rgb;
            halo+=bloom*sampleColor*smoothstep(.14,.7,max(sampleColor.r,max(sampleColor.g,sampleColor.b)));
          }
          if(hasLocalBloom){
            halo+=3.*(.6*texture2D(localGlow,coord+v*3.).rgb+.4*texture2D(localGlow,coord+v*8.).rgb);
          }
        }
        c+=halo/12.;
      }
      gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
    }`,
  })
  readonly mesh = new T.Mesh(new T.PlaneGeometry(2, 2), this.mat)
  constructor() {
    for (const target of [this.current, this.layerBloom, ...this.history, ...this.layerHistory]) {
      // Hardware sRGB attachments preserve SDR shadow detail and decode back to
      // linear light when the composite shader samples them.
      target.texture.colorSpace = T.SRGBColorSpace
    }
    this.scene.add(this.mesh)
    this.mesh.frustumCulled = false
  }
  render(
    renderer: T.WebGLRenderer,
    w: number,
    h: number,
    scene: Strength,
    layer: { bloom: boolean; trail: boolean },
    draw: (delay: number, pass: EffectPass) => void,
  ) {
    // Match the canvas' native MSAA budget at everyday resolutions. UHD effect
    // targets stay single-sampled to bound GPU memory without resizing frames.
    this.current.samples = w * h <= 2560 * 1440 ? Math.min(4, renderer.capabilities.maxSamples) : 0
    this.current.setSize(w, h)
    const halfW = Math.max(1, Math.round(w / 2)),
      halfH = Math.max(1, Math.round(h / 2))
    const tap = (target: T.WebGLRenderTarget, enabled: boolean, delay: number, pass: EffectPass) => {
      target.setSize(enabled ? halfW : 1, enabled ? halfH : 1)
      if (enabled) {
        renderer.setRenderTarget(target)
        draw(delay, pass)
      }
    }
    try {
      for (let i = 0; i < 2; i++) {
        const delay = (1 + i * 2) / 30
        tap(this.history[i], scene.trail > 0, delay, 'scene')
        tap(this.layerHistory[i], layer.trail, delay, 'trail')
      }
      tap(this.layerBloom, layer.bloom, 0, 'bloom')
      renderer.setRenderTarget(this.current)
      draw(0, 'scene')
    } finally {
      renderer.setRenderTarget(null)
    }
    const u = this.mat.uniforms
    u.base.value = this.current.texture
    u.prevA.value = this.history[0].texture
    u.prevB.value = this.history[1].texture
    u.localA.value = this.layerHistory[0].texture
    u.localB.value = this.layerHistory[1].texture
    u.localGlow.value = this.layerBloom.texture
    u.bloom.value = scene.bloom
    u.trail.value = scene.trail
    u.hasLocalBloom.value = layer.bloom
    u.hasLocalTrail.value = layer.trail
    u.pixel.value.set(1 / w, 1 / h)
    renderer.render(this.scene, this.camera)
  }
  dispose() {
    this.current.dispose()
    this.layerBloom.dispose()
    for (const target of [...this.history, ...this.layerHistory]) target.dispose()
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}
