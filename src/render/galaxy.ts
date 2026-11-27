import * as T from 'three'
import type { Layer } from '../model'
import { noise, type Visual } from './common'
import { instrument, lookup, noiseGLSL, outputColor, pickEllipsoid, ellipsoidBounds } from './instrument'

// A co-rotating dust disk and a volume distribution of stars share the arm equation.
// Every star keeps its orbital elements; seeking never re-emits particles.
const winding = `
 float arm(float r){return 2.72*log(1.+4.6*r)+.12*sin(6.*r-uTime*.045)+uSeed*.25+uTime*.026;}
`
export function createGalaxy(layer: Layer): Visual {
  const driver = instrument(),
    group = new T.Group()
  const dustMat = new T.ShaderMaterial({
    uniforms: driver.uniforms,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    vertexShader: `varying vec2 disk;void main(){disk=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:
      lookup +
      noiseGLSL +
      winding +
      `
    varying vec2 disk;
    void main(){
      vec2 p=disk;float r=length(p);if(r>1.59)discard;
      float a=atan(p.y,p.x);
      float swirl=arm(r),th=a-swirl;
      vec2 turb=p*mat2(cos(swirl*.7),sin(swirl*.7),-sin(swirl*.7),cos(swirl*.7));
      float grain=cloud(turb*10.+uSeed),speck=vnoise(turb*98.);
      float phase=3.*th+1.2*(grain-.5);
      float ridge=exp(-2.8*(1.-cos(phase))), branch=exp(-6.*(1.-cos(phase+1.15+sin(4.*r))))*.46;
      float zone=exp(-2.2*r*r)*(1.-smoothstep(.55,1.54,r));
      float dust=zone*(ridge+branch)*pow(grain,2.)*(.4+.6*speck)*(.9+.5*uEnergy.y);
      float lane=smoothstep(-.3,.65,cos(phase+.8+grain*.6));
      float haze=exp(-4.*r*r)*(.13+grain*.16)*(.24+.76*lane);
      float bulge=exp(-8.*r),nucleus=exp(-24.*r);
      vec3 outer=paint(.78-.25*grain+.14*sin(th),grain,r);
      vec3 warm=mix(paint(.14,grain,r),vec3(1.,.66,.28),.23);
      vec3 col=(outer*(dust*1.65+haze*.80)+mix(warm,outer,smoothstep(.12,.48,r))*dust*.55);
      col+=warm*bulge*1.34+mix(warm,vec3(1.,.95,.82),.72)*nucleus*1.75;
      float fade=1.-smoothstep(1.22,1.59,r);
      gl_FragColor=vec4(col,fade*uOpacity);
      ` +
      outputColor +
      `}`,
  })
  const sheet = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), dustMat)
  sheet.renderOrder = -1
  sheet.raycast = () => {}
  group.add(sheet)
  const n = Math.min(65536, Math.max(1024, Math.round(layer.settings.count) * 48))
  const orbit = new Float32Array(4 * n),
    light = new Float32Array(4 * n)
  // Fixed random variates; the project seed rotates and warps the entire distribution in the shader.
  for (let i = 0; i < n; i++) {
    const k = i * 8,
      x = noise(1013, k),
      small = noise(1013, k + 1)
    const field = small < 0.055 ? 2 : small < 0.23 ? 1 : 0
    orbit.set([Math.pow(x, field === 1 ? 1.8 : 0.68), noise(271, k + 2), noise(181, k + 3), field], 4 * i)
    light.set([noise(147, k + 4), noise(533, k + 5), noise(313, k + 6), noise(179, k + 7)], 4 * i)
  }
  const viewportHeight = { value: 1 }
  const stars = new T.ShaderMaterial({
    uniforms: { ...driver.uniforms, uViewportHeight: viewportHeight },
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader:
      lookup +
      winding +
      `
      attribute vec4 aOrbit,aLight;uniform float uViewportHeight;varying vec3 vLight;varying float vSpike,vGlow,vCoverage;
      void main(){
        float kind=aOrbit.w, r=aOrbit.x*(.75+.56*aLight.w), rand=aLight.x;
        float theta=tau*floor(3.*aOrbit.y)/3.+arm(r)+(aOrbit.z+aLight.y-1.)*(.29+.42*r)*uSpread;
        float z=(aLight.y+aLight.w-1.)*(.035+.055*r)*uSpread;
        if(kind>.5){theta=tau*aOrbit.z+uSeed*.62;r*=kind>1.5?1.75:.72;z*=kind>1.5?10.:2.8;}
        float freq=clamp(.08+.82*r+.08*aLight.w,0.,1.), amp=signals(freq).r;
        theta+=.12*sin(9.*r+floor(3.*aOrbit.y)*2.)+.14*uEnergy.y*sin(4.*r+uSeed+.15*uTime);
        z+=.045*uEnergy.x*cos(theta*2.+r*6.) + .025*amp*sin(5.*theta+10.*r);
        vec3 center=vec3(r*cos(theta),r*sin(theta),z);
        vec4 eye=modelViewMatrix*vec4(center,1.);
        float rare=pow(rand,19.), nearCore=exp(-6.*r);
        float radius=(.00058+.00215*aLight.z+.007*rare+.0018*nearCore)*(1.+.48*uEnergy.z+.32*amp);
        if(kind>1.5)radius*=.8;
        float mvScale=length(modelViewMatrix[0].xyz);
        gl_Position=projectionMatrix*eye;
        float diameter=(radius*8.)*mvScale*projectionMatrix[1][1]*uViewportHeight*.5/gl_Position.w;
        gl_PointSize=max(1.,diameter);
        vCoverage=min(1.,diameter*diameter);
        float colorPos=clamp(.07+.67*r+.31*(aLight.z-.4),0.,1.);
        vec3 color=paint(colorPos,amp,freq);
        vLight=mix(color,vec3(1.,.94,.83),.1+.6*rare+.32*nearCore)*
          (.32+.78*aLight.z+.55*amp+.48*uEnergy.z);
        vGlow=.32+.6*aLight.y;
        vSpike=smoothstep(.92,1.,rand);
      }`,
    fragmentShader:
      lookup +
      `varying vec3 vLight;varying float vGlow,vSpike,vCoverage;
      void main(){
        vec2 vUv=2.*gl_PointCoord-1.;
        float rr=dot(vUv,vUv);if(rr>1.)discard;
        float spot=exp(-18.*rr),halo=exp(-4.5*rr)*.15*vGlow;
        float spikes=(exp(-abs(vUv.x)*85.-abs(vUv.y)*5.)+exp(-abs(vUv.y)*85.-abs(vUv.x)*5.))*vSpike*.4;
        gl_FragColor=vec4(vLight,clamp(spot+halo+spikes,0.,1.)*uOpacity*vCoverage);
        ` +
      outputColor +
      `}`,
  })
  const starGeometry = new T.BufferGeometry()
  const orbitAttribute = new T.BufferAttribute(orbit, 4)
  starGeometry.setAttribute('position', orbitAttribute)
  starGeometry.setAttribute('aOrbit', orbitAttribute)
  starGeometry.setAttribute('aLight', new T.BufferAttribute(light, 4))
  const starMesh = new T.Points(starGeometry, stars)
  starMesh.frustumCulled = false
  starMesh.raycast = () => {}
  starMesh.userData.skipRaycast = true
  const viewport = new T.Vector4()
  starMesh.onBeforeRender = (renderer) => {
    viewportHeight.value = renderer.getCurrentViewport(viewport).w
  }
  const axes = new T.Vector3(1.38, 1.38, 0.18)
  pickEllipsoid(sheet, () => axes)
  group.add(starMesh)
  return {
    object: group,
    bounds: ellipsoidBounds(group, () => axes),
    update(f) {
      driver.update(f)
      const s = f.layer.settings
      group.scale.setScalar(s.radius)
      group.rotation.set(0.96 + 0.045 * Math.sin(f.time * s.speed * 0.06), -0.08, -0.4)
      for (const m of [dustMat, stars]) m.depthTest = f.layer.depthTest
      dustMat.blending = f.layer.material.blend === 'multiply' ? T.MultiplyBlending : T.AdditiveBlending
      stars.blending = f.layer.material.blend === 'multiply' ? T.MultiplyBlending : T.AdditiveBlending
    },
    dispose: driver.dispose,
  }
}
