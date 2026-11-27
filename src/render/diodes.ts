import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { Layer } from '../model'
import type { Visual } from './common'
import { instrument, instanced, lookup, outputColor } from './instrument'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function createDiodes(layer: Layer): Visual {
  const { rows, columns } = layer.settings,
    driver = instrument(),
    group = new T.Group()
  const cells = new Float32Array(rows * columns * 2)
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) cells.set([c, r], 2 * (c + columns * r))
  // The outer lip, recessed bezel and shallow convex phosphor lens have real depth.
  const profile = [
    [0, 0.16],
    [0.29, 0.11],
    [0.38, 0.015],
    [0.429, 0.018],
    [0.49, -0.05],
    [0.49, -0.09],
  ]
  const shell = new T.LatheGeometry(
    profile.map(([x, y]) => new T.Vector2(x, y)),
    14,
  )
  shell.rotateX(Math.PI / 2)
  // When a lens covers a handful of pixels its recessed rim is subpixel. A raised
  // four-facet dome retains the cell's depth; the fragment shader resolves its
  // circular aperture. The detailed lathe remains available for close-ups.
  const small = new T.BufferGeometry()
  small.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [0, 0, 0.16, -0.5, -0.5, -0.06, 0.5, -0.5, -0.06, 0.5, 0.5, -0.06, -0.5, 0.5, -0.06],
      3,
    ),
  )
  small.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1])
  small.computeVertexNormals()
  shell.deleteAttribute('uv')
  const profileGeometry = mergeGeometries([small, shell])
  const lowIndices = small.index!.count,
    highIndices = shell.index!.count
  const levels = new Float32Array(cells.length)
  const geometry = instanced(profileGeometry, {
    aCell: { data: cells, size: 2 },
    aLevel: { data: levels, size: 2 },
  })
  const levelAttribute = geometry.getAttribute('aLevel') as T.InstancedBufferAttribute
  levelAttribute.setUsage(T.DynamicDrawUsage)
  const uniforms = {
    ...driver.uniforms,
    uGrid: { value: new T.Vector2(columns, rows) },
    uPitch: { value: 0.1 },
    uSize: { value: 0.08 },
    uFlags: { value: new T.Vector2() },
    uDepth: { value: 0.03 },
  }
  const mat = new T.ShaderMaterial({
    uniforms,
    side: T.DoubleSide,
    vertexShader:
      lookup +
      `
      attribute vec2 aCell,aLevel;uniform vec2 uGrid,uFlags;uniform float uPitch,uSize,uDepth;
      varying float vPower,vPeak,vFreq,vColumn,vRow;varying vec2 vLens;varying vec3 vNorm;
      void main(){
        float col=aCell.x/max(1.,uGrid.x-1.),row=aCell.y/uGrid.y;
        float freq=uFlags.y>.5?abs(2.*col-1.):col;if(uFlags.x>.5)freq=1.-freq;
        vPower=aLevel.x;vPeak=aLevel.y;
        vec3 p=vec3((aCell-(uGrid-1.)*.5)*uPitch,0.) +vec3(position.xy*uSize,position.z*uDepth);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        vLens=position.xy*2.;vNorm=normalize(normalMatrix*normal);vFreq=freq;vColumn=col;vRow=row;
      }`,
    fragmentShader:
      lookup +
      `
      varying float vPower,vPeak,vFreq,vColumn,vRow;varying vec2 vLens;varying vec3 vNorm;
      void main(){
        float r=length(vLens);if(r>.98)discard;
        vec3 phosphor=paint(vColumn,vRow,vFreq);
        float lit=max(vPower,.7*vPeak);
        float aperture=1.-smoothstep(.66,.83,r);
        float micro=.95+.05*sin(vLens.x*54.)*sin(vLens.y*52.);
        float hotspot=exp(-7.*dot(vLens-vec2(-.10,.12),vLens-vec2(-.10,.12)));
        float bevel=clamp(dot(vNorm,normalize(vec3(-.45,.7,1.))),0.,1.);
        vec3 col=vec3(.005,.007,.01)*(.3+.7*bevel);
        col+=phosphor*(.008+lit*(.57+.46*hotspot))*aperture*micro;
        col+=vec3(.82,.94,1.)*(.014+.16*lit)*pow(hotspot,2.);
        col+=phosphor*lit*.09*exp(-55.*abs(r-.78));
        gl_FragColor=vec4(col,uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const lenses = new T.Mesh(geometry, mat)
  lenses.frustumCulled = false
  const viewport = new T.Vector4(),
    worldScale = new T.Vector3(),
    eye = new T.Vector3()
  lenses.onBeforeRender = (renderer, _scene, camera) => {
    lenses.getWorldScale(worldScale)
    eye.setFromMatrixPosition(lenses.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
    const depth = camera instanceof T.PerspectiveCamera ? Math.max(0.001, -eye.z) : 1
    const height = renderer.getCurrentViewport(viewport).w
    const px =
      (uniforms.uSize.value *
        Math.max(worldScale.x, worldScale.y) *
        camera.projectionMatrix.elements[5] *
        height) /
      (2 * depth)
    geometry.setDrawRange(px < 14 ? 0 : lowIndices, px < 14 ? lowIndices : highIndices)
  }
  // The board supplies the footprint for picking; the lens positions live on the GPU.
  lenses.raycast = () => {}
  const boardMat = new T.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `varying vec2 panel;void main(){panel=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:
      lookup +
      `
      uniform vec2 uGrid,uFlags;varying vec2 panel;
      void main(){
        vec2 at=panel*(uGrid+.85)+(uGrid-1.)*.5;
        vec2 cell=clamp(floor(at+.5),vec2(0.),uGrid-1.);
        float c=cell.x/max(1.,uGrid.x-1.);
        float f=uFlags.y>.5?abs(2.*c-1.):c;if(uFlags.x>.5)f=1.-f;
        float amp=signals(f).r,lit=smoothstep(-1.,1.,pow(amp,.72)*.98*uGrid.y-cell.y);
        float glow=.038*lit*exp(-3.*dot(at-cell,at-cell));
        vec3 rgb=vec3(.0024,.0034,.0057)+paint(c,cell.y/uGrid.y,f)*glow;
        gl_FragColor=vec4(rgb,uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const board = new T.Mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.05), boardMat)
  group.add(board, lenses)
  const corner = new T.Vector3()
  return {
    object: group,
    bounds(visit) {
      for (const x of [-0.5, 0.5])
        for (const y of [-0.5, 0.5])
          for (const z of [-0.5, 1.4]) visit(corner.set(x, y, z).applyMatrix4(board.matrixWorld))
    },
    update(f) {
      driver.update(f)
      const s = f.layer.settings,
        pitch = s.width + s.spacing
      const depth = Math.max(0.012, s.depth)
      // Resolve two audio samples per column once. Every vertex of the lens then
      // receives the same cached cell drive instead of repeating spectrum fetches.
      const signal = driver.audioData
      for (let col = 0; col < columns; col++) {
        let u = col / (columns - 1)
        if (s.mirror) u = Math.abs(2 * u - 1)
        if (s.reverse) u = 1 - u
        const bin = u * 127,
          j = Math.floor(bin),
          k = Math.min(127, j + 1),
          weight = bin - j
        const now = (signal[j * 4] * (1 - weight) + signal[k * 4] * weight) / 255
        const old = (signal[j * 4 + 2] * (1 - weight) + signal[k * 4 + 2] * weight) / 255
        const e = 0.98 * now ** 0.72,
          peak = 0.98 * Math.max(now, old) ** 0.72
        for (let row = 0; row < rows; row++) {
          const i = 2 * (row * columns + col)
          levels[i] = T.MathUtils.smoothstep(e * rows - row, -0.2, 0.8)
          levels[i + 1] =
            peak >= 0.035 ? T.MathUtils.smoothstep(1 - Math.abs(peak * rows - row - 0.5), -0.2, 0.7) : 0
        }
      }
      levelAttribute.needsUpdate = true
      uniforms.uPitch.value = pitch
      uniforms.uSize.value = s.width
      uniforms.uDepth.value = depth * 3.5
      uniforms.uFlags.value.set(Number(s.reverse), Number(s.mirror))
      board.scale.set(columns * pitch + pitch * 0.85, rows * pitch + pitch * 0.85, depth)
      board.position.z = -depth * 0.8
      group.position.y = s.baseline
      mat.transparent = f.layer.opacity < 1 || f.layer.material.blend !== 'normal'
      mat.blending =
        f.layer.material.blend === 'add'
          ? T.AdditiveBlending
          : f.layer.material.blend === 'multiply'
            ? T.MultiplyBlending
            : T.NormalBlending
      boardMat.opacity = f.layer.opacity
      boardMat.transparent = f.layer.opacity < 1
      boardMat.depthTest = mat.depthTest = f.layer.depthTest
      mat.depthWrite = boardMat.depthWrite = f.layer.depthTest && !mat.transparent
    },
    dispose: driver.dispose,
  }
}
