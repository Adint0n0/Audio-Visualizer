import * as T from 'three'
import type { BoundsVisitor, Frame } from './common'
import { band, clamp01 } from './common'

/** Band, time waveform and lookback values are shared by all materials of an instrument.
 * The lookup table uses texel centres and linear interpolation, including on software WebGL2. */
export function instrument() {
  const width = 128,
    audioData = new Uint8Array(width * 4),
    lut = new Uint8Array(256 * 4)
  const texture = (data: Uint8Array, n: number) => {
    const t = new T.DataTexture(data, n, 1, T.RGBAFormat)
    t.minFilter = t.magFilter = T.LinearFilter
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }
  const signal = texture(audioData, width),
    colors = texture(lut, 256)
  colors.colorSpace = T.SRGBColorSpace
  const uniforms = {
    uAudio: { value: signal },
    uPalette: { value: colors },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uEnergy: { value: new T.Vector4() },
    uMusic: { value: new T.Vector4() },
    uOpacity: { value: 1 },
    uRadius: { value: 1 },
    uSpread: { value: 1 },
    uHeight: { value: 1 },
    uWidth: { value: 0.1 },
    uColorMode: { value: 0 },
    uClock: { value: 0 },
  }
  let lastPalette = ''
  const c = new T.Color()
  function update(f: Frame) {
    const { settings: s, material: m } = f.layer
    const stamp = m.colorMode === 'solid' ? m.color : JSON.stringify(m.stops)
    if (stamp !== lastPalette) {
      const stops = (m.colorMode === 'solid' ? [{ at: 0, color: m.color }] : m.stops).map((k) => ({
        at: k.at,
        c: new T.Color(k.color),
      }))
      for (let i = 0, j = 0; i < 256; i++) {
        const p = i / 255
        while (j < stops.length - 1 && stops[j + 1].at < p) j++
        const a = stops[j],
          b = stops[Math.min(stops.length - 1, j + 1)]
        c.lerpColors(a.c, b.c, clamp01((p - a.at) / Math.max(0.000001, b.at - a.at))).convertLinearToSRGB()
        lut[i * 4] = Math.round(c.r * 255)
        lut[i * 4 + 1] = Math.round(c.g * 255)
        lut[i * 4 + 2] = Math.round(c.b * 255)
        lut[i * 4 + 3] = 255
      }
      colors.needsUpdate = true
      lastPalette = stamp
    }
    const past = f.audio.history(0.1)
    let bass = 0,
      mid = 0,
      high = 0
    for (let i = 0; i < width; i++) {
      const u = i / (width - 1)
      const e = clamp01(band(f.audio.bands, u) * s.gain)
      audioData[i * 4] = Math.round(255 * e)
      audioData[i * 4 + 1] = Math.round(
        255 * (0.5 + 0.5 * Math.max(-1, Math.min(1, band(f.audio.wave, u) * s.gain))),
      )
      audioData[i * 4 + 2] = Math.round(255 * clamp01(band(past, u) * s.gain))
      audioData[i * 4 + 3] = 255
      if (i < 32) bass += e / 32
      else if (i < 84) mid += e / 52
      else high += e / 44
    }
    signal.needsUpdate = true
    const features = f.audio.music
    uniforms.uEnergy.value.set(
      features ? clamp01(features.bass * s.gain) : bass,
      features ? clamp01(features.mid * s.gain) : mid,
      features ? clamp01(features.treble * s.gain) : high,
      clamp01(f.audio.rms * s.gain),
    )
    uniforms.uMusic.value.set(
      features?.brightness ?? mid,
      clamp01((features?.transient ?? f.audio.onset) * s.gain),
      clamp01((features?.beat ?? 0) * s.gain),
      features?.confidence ?? 0,
    )
    uniforms.uTime.value = f.time * s.speed
    uniforms.uClock.value = f.time
    uniforms.uSeed.value = (((f.seed >>> 0) % 65521) / 65521) * 6.2831853
    uniforms.uRadius.value = s.radius
    uniforms.uSpread.value = s.spread
    uniforms.uHeight.value = s.maxHeight
    uniforms.uWidth.value = s.width
    uniforms.uOpacity.value = f.layer.opacity
    uniforms.uColorMode.value =
      m.colorMode === 'height' ? 1 : m.colorMode === 'cycle' ? 2 : m.colorMode === 'frequency' ? 3 : 0
  }
  return {
    uniforms,
    audioData,
    update,
    dispose() {
      signal.dispose()
      colors.dispose()
    },
  }
}
export const lookup = `
  uniform sampler2D uAudio,uPalette;
  uniform float uTime,uClock,uSeed,uOpacity,uRadius,uSpread,uHeight,uWidth,uColorMode;
  uniform vec4 uEnergy,uMusic;
  const float tau=6.28318530718;
  vec3 signals(float u){return texture2D(uAudio,vec2((clamp(u,0.,1.)*127.+.5)/128.,.5)).rgb;}
  vec3 paint(float position,float height,float freq){
    float t=uColorMode==1.?height:uColorMode==2.?fract(position+.065*uTime):uColorMode==3.?freq:position;
    return texture2D(uPalette,vec2((clamp(t,0.,1.)*255.+.5)/256.,.5)).rgb;
  }
`
export const outputColor = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`
export const noiseGLSL = `
  float hash21(vec2 p){
    vec3 a=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));a+=dot(a,a.yzx+33.33);
    return fract((a.x+a.y)*a.z);
  }
  float vnoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);
  }
  float cloud(vec2 p){return .55*vnoise(p)+.28*vnoise(p*2.07+13.2)+.13*vnoise(p*4.21-8.4)+.04*vnoise(p*8.35);}
`
export function instanced(
  base: T.BufferGeometry,
  attrs: Record<string, { data: Float32Array; size: number }>,
) {
  const g = new T.InstancedBufferGeometry()
  g.index = base.index
  for (const [key, value] of Object.entries(base.attributes)) g.setAttribute(key, value)
  for (const [key, a] of Object.entries(attrs))
    g.setAttribute(key, new T.InstancedBufferAttribute(a.data, a.size))
  g.instanceCount = Object.values(attrs)[0].data.length / Object.values(attrs)[0].size
  return g
}
/** Vertex-displaced instanced meshes do not share their CPU base geometry's hit shape. */
export function pickEllipsoid(mesh: T.Mesh, readAxes: () => T.Vector3, inner = 0) {
  const inv = new T.Matrix4(),
    local = new T.Ray(),
    hit = new T.Vector3()
  const ball = new T.Sphere(new T.Vector3(), 1)
  mesh.raycast = function (cast, hits) {
    const axes = readAxes()
    inv.copy(mesh.matrixWorld).invert()
    local.copy(cast.ray).applyMatrix4(inv)
    local.origin.divide(axes)
    local.direction.divide(axes).normalize()
    if (!local.intersectSphere(ball, hit) || Math.hypot(hit.x, hit.y) < inner) return
    hit.multiply(axes).applyMatrix4(mesh.matrixWorld)
    const distance = cast.ray.origin.distanceTo(hit)
    if (distance >= cast.near && distance <= cast.far)
      hits.push({ distance, point: hit.clone(), object: mesh })
  }
}

/** Project sampled ellipsoid points instead of a world-axis-aligned box surrounding
 * a tilted disk. The callback receives a reused world-space point and must copy it
 * if it needs to retain it. No invisible meshes or materials enter the draw list. */
const shellDirections: T.Vector3[] = []
for (let j = 0; j <= 8; j++) {
  const latitude = (j / 8 - 0.5) * Math.PI
  for (let i = 0; i < 24; i++) {
    const longitude = (i / 24) * 2 * Math.PI
    shellDirections.push(
      new T.Vector3(
        Math.cos(longitude) * Math.cos(latitude),
        Math.sin(longitude) * Math.cos(latitude),
        Math.sin(latitude),
      ),
    )
  }
}
export function ellipsoidBounds(anchor: T.Object3D, readAxes: () => T.Vector3) {
  const point = new T.Vector3()
  return (visit: BoundsVisitor) => {
    const axes = readAxes()
    for (const dir of shellDirections) visit(point.copy(dir).multiply(axes).applyMatrix4(anchor.matrixWorld))
  }
}
