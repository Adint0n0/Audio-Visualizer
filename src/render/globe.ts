import * as T from 'three'
import type { Layer } from '../model'
import type { Visual } from './common'
import { instrument, lookup, outputColor, pickEllipsoid, ellipsoidBounds } from './instrument'

export function createGlobe(layer: Layer): Visual {
  const driver = instrument(),
    group = new T.Group()
  const detail = Math.max(2, Math.round(Math.sqrt(layer.settings.count) * 1.35))
  const geometry = new T.IcosahedronGeometry(1, detail)
  const n = geometry.getAttribute('position').count
  const bary = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) bary[i * 3 + (i % 3)] = 1
  geometry.setAttribute('aBary', new T.BufferAttribute(bary, 3))
  const uniforms = { ...driver.uniforms, uPass: { value: 0 } }
  const vertex =
    lookup +
    `
    attribute vec3 aBary;uniform float uPass;
    varying vec3 vBary,vObj,vEye,vN;
    varying float vFreq,vAmp,vFold;
    void main(){
      vec3 d=normalize(position);
      float t=uTime*.23,lon=atan(d.z,d.x),lat=asin(d.y);
      float freq=clamp(.5+.28*sin(2.*lon+uSeed)*cos(lat)+.22*d.y,0.,1.);
      float amp=signals(freq).r,treble=signals(.62+.38*(.5+.5*sin(5.*lat+lon))).r;
      float wind=dot(d,normalize(vec3(.6,.8,-.3)));
      float folds=sin(6.*wind+t+sin(4.*d.x-t))*.55+cos(4.*d.z+3.*d.x-t*.8)*.32;
      // Large ridges ride bass pressure; fine latitude waves favour the upper bands.
      float macro=folds*(.045+.17*uEnergy.x)+.07*amp;
      float fine=sin(13.*lat+2.*sin(3.*lon)+t)*(.008+.033*treble)*cos(lat);
      float rad=1.+(macro+fine)*min(uHeight,4.);
      vec3 p=d*rad*uRadius;
      vec4 eye=modelViewMatrix*vec4(p,1.);
      gl_Position=projectionMatrix*eye;
      vObj=d;vEye=eye.xyz;vN=normalize(normalMatrix*d);vBary=aBary;vFreq=freq;vAmp=amp;vFold=folds;
    }`
  const mat = new T.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    fragmentShader:
      lookup +
      `
      varying vec3 vBary,vObj,vEye,vN;varying float vFreq,vAmp,vFold;
      void main(){
        vec3 deriv=max(fwidth(vBary),vec3(.00001));
        vec3 distanceToEdge=vBary/deriv;
        float edge=min(min(distanceToEdge.x,distanceToEdge.y),distanceToEdge.z);
        float vertexDist=max(min(distanceToEdge.x,distanceToEdge.y),min(max(distanceToEdge.x,distanceToEdge.y),distanceToEdge.z));
        float thread=1.-smoothstep(.08,.86,edge);
        float hotPoint=exp(-1.35*vertexDist*vertexDist);
        float facing=abs(dot(normalize(vN),normalize(-vEye))),rim=pow(1.-facing,2.8);
        float axis=clamp(.5+.42*vObj.x+.23*vObj.z-.13*vObj.y+.09*vFold,0.,1.);
        vec3 wire=paint(axis,vAmp,vFreq),glint=mix(wire,vec3(.87,.96,1.),.56);
        bool front=gl_FrontFacing;
        float grazing=pow(max(0.,dot(normalize(vN),normalize(vec3(-.42,.68,.56)))),1.6);
        float lon=atan(vObj.z,vObj.x),latitude=asin(clamp(vObj.y,-1.,1.));
        float magnetic=latitude-.38*sin(2.*lon+.37*uTime+uSeed)-.21*cos(lon-.13*uTime);
        float aurora=exp(-15.*abs(magnetic))+.40*exp(-26.*abs(magnetic-.18-.055*sin(7.*lon)));
        float amplitude=.22+.62*grazing+.48*vAmp+.66*rim+1.12*aurora;
        vec3 arcColor=mix(wire,vec3(.88,1.,1.),.38);
        wire=mix(wire*.74,arcColor,min(1.,aurora));
        vec3 col=wire*(.008+rim*.26+.05*exp(-edge*edge*.3)+aurora*.18)+
          thread*mix(wire,glint,.35*grazing)*amplitude+glint*hotPoint*(.11+.55*uEnergy.z+.32*aurora);
        // Rear-facing facets expose a dim web through the dark cavities in the near skin.
        float opacity=front?(.55+.42*max(thread,rim)):(.04+.34*thread);
        if(!front)col*=.58;
        gl_FragColor=vec4(col,clamp(opacity*uOpacity,0.,1.));
        ` +
      outputColor +
      `}`,
  })
  const shell = new T.Mesh(geometry, mat)
  shell.frustumCulled = false
  const axes = new T.Vector3()
  pickEllipsoid(shell, () => axes)
  // An expanded back-facing atmosphere scatters colored light around the real silhouette.
  const haloMat = new T.ShaderMaterial({
    uniforms,
    vertexShader: vertex.replace('d*rad*uRadius', 'd*rad*uRadius*1.14'),
    transparent: true,
    depthWrite: false,
    side: T.BackSide,
    blending: T.AdditiveBlending,
    fragmentShader:
      lookup +
      `
      varying vec3 vObj,vEye,vN;varying float vFreq,vAmp;
      void main(){
        float facing=abs(dot(normalize(vN),normalize(-vEye)));
        float glow=exp(-24.*pow(facing-.39,2.))*smoothstep(.0,.31,facing)*(.16+.14*uEnergy.y);
        vec3 color=paint(clamp(.5+.46*vObj.x+.32*vObj.z,0.,1.),vAmp,vFreq);
        gl_FragColor=vec4(color,glow*uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const halo = new T.Mesh(geometry, haloMat)
  halo.frustumCulled = false
  halo.raycast = () => {}
  group.add(halo, shell)
  return {
    object: group,
    bounds: ellipsoidBounds(group, () => axes),
    update(f) {
      driver.update(f)
      axes.setScalar(
        f.layer.settings.radius *
          (1.06 + Math.min(f.layer.settings.maxHeight, 4) * (0.045 + 0.12 * driver.uniforms.uEnergy.value.x)),
      )
      const t = f.time * f.layer.settings.speed
      group.rotation.set(
        0.14 + 0.06 * Math.sin(0.13 * t),
        t * 0.095 + driver.uniforms.uSeed.value * 0.23,
        -0.2,
      )
      haloMat.depthTest = mat.depthTest = f.layer.depthTest
      mat.blending =
        f.layer.material.blend === 'add'
          ? T.AdditiveBlending
          : f.layer.material.blend === 'multiply'
            ? T.MultiplyBlending
            : T.NormalBlending
    },
    dispose: driver.dispose,
  }
}
