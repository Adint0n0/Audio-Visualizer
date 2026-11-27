import * as T from 'three'
import type { Layer } from '../model'
import { noise, type Visual } from './common'
import { instrument, instanced, lookup, outputColor, pickEllipsoid, ellipsoidBounds } from './instrument'

export function createRadial(layer: Layer): Visual {
  const driver = instrument(),
    group = new T.Group()
  const n = Math.max(24, Math.round(layer.settings.count))
  const uniforms = { ...driver.uniforms, uSegments: { value: n } }
  const veilMat = new T.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    vertexShader: `varying vec2 disk;void main(){disk=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:
      lookup +
      `
      uniform float uSegments;varying vec2 disk;
      float wire(float d,float width){
        return 1.-smoothstep(width,width+max(.0006,fwidth(d)),abs(d));
      }
      void main(){
        float r=length(disk);if(r<.59 || r>1.86)discard;
        float a=atan(disk.y,disk.x), phase=fract(a/tau+.5);
        float f=.5-.5*cos(a+1.57),time=uTime*.035;
        vec3 sampleA=signals(f);float amp=sampleA.r,trace=sampleA.g*2.-1.;
        float travel=fract(phase+time);
        vec3 color=paint(.45+.39*sin(a+.3)+.12*cos(2.*a),amp,f);
        vec3 edge=mix(color,vec3(.86,.97,1.),.42);
        float body=smoothstep(.728,.76,r)*(1.-smoothstep(.945,.964,r));
        float lacquer=.03+.14*pow(.5+.5*cos(a-1.1),5.);
        vec3 col=body*color*lacquer;
        float wave=.81+.049*trace+.018*sin(a*6.-time);
        col+=edge*(.91*wire(r-wave,.0036)+.24*exp(-80.*abs(r-wave)));
        float residual=.78+.060*(signals(clamp(f+.04,0.,1.)).g*2.-1.)+.017*cos(a*5.+time);
        col+=color*.43*wire(r-residual,.0018);
        float filament=.66+.031*trace+.015*sin(3.*a-time);
        col+=color*wire(r-filament,.0018)*(.16+.34*smoothstep(.3,.8,sin(2.*a+time)));
        col+=color*(.25*wire(r-.744,.0017)+.9*wire(r-.948,.003)+.24*wire(r-.973,.0018));
        float teeth=1.-smoothstep(.05,.24,abs(fract(phase*uSegments)-.5));
        col+=color*teeth*smoothstep(.87,.878,r)*(1.-smoothstep(.903,.91,r))*(.22+.52*amp);
        float arcLight=smoothstep(.43,.8,.5+.5*cos(3.*a+time*2.1));
        col+=edge*wire(r-.70-.018*amp,.0022)*arcLight;
        float outer=max(0.,r-.98);
        float mist=exp(-16.*outer)*smoothstep(.94,1.,r);
        col+=color*mist*(.09+.22*amp);
        float rayId=floor(phase*83.);
        float random=fract(sin(rayId*53.13+uSeed)*4127.17);
        float ray=fract(phase*83.+.45*outer);
        float beam=exp(-abs(ray-.5)*(48.+20.*random));
        float length=.09+.38*random+.32*amp;
        col+=color*beam*smoothstep(.99,1.05,r)*(1.-smoothstep(.15*length,length,outer))*(.12+.30*amp);
        float dustPos=fract(outer*4.-uTime*.11-random);
        col+=edge*beam*pow(1.-abs(2.*dustPos-1.),20.)*smoothstep(.1,.25,outer)*(1.-smoothstep(.3,.86,outer))*(.3+.65*uMusic.y);
        float lum=max(col.r,max(col.g,col.b));
        if(lum<.0004)discard;
        gl_FragColor=vec4(col,uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const veil = new T.Mesh(new T.PlaneGeometry(3.75, 3.75), veilMat)
  veil.position.z = -0.07
  group.add(veil)
  // Each vane has four bevelled corners and a separate exposed tip. The face
  // normals create depth at oblique camera angles and high aspect ratios.
  const vane = new T.CylinderGeometry(0.36, 0.51, 1, 5, 1, false)
  const lanes = Float32Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 0 : Math.floor(i / 2) / n))
  const vanes = instanced(vane, { aLane: { data: lanes, size: 2 } })
  const bladeMat = new T.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: true,
    vertexShader:
      lookup +
      `
      attribute vec2 aLane;uniform float uSegments;varying float vAlong,vAmp,vFreq,vColor,vShade;
      void main(){
        float a=tau*aLane.x+1.57, f=.5-.5*cos(a+1.57), amp=signals(f).r;
        vec2 radial=vec2(cos(a),sin(a)),tangent=vec2(-radial.y,radial.x);
        float width=min(.82*tau/uSegments,uWidth/max(.01,uRadius));
        float bead=fract(aLane.x*uSegments*.5+.01)>.3?.82:1.;
        float along=position.y+.5;
        float h=(.025+min(2.,uHeight/uRadius)*pow(amp,.82)*bead);
        vec3 p=vec3(radial*(.982+h*along)+tangent*width*position.x,position.z*width*1.4+.012+.05*along*amp);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
        vAlong=along;vAmp=amp;vFreq=f;vColor=.45+.39*sin(a+.3)+.12*cos(2.*a);
        vShade=.6+.4*abs(normal.z);
      }`,
    fragmentShader:
      lookup +
      `
      varying float vAlong,vAmp,vFreq,vColor,vShade;
      void main(){
        vec3 c=paint(vColor,vAmp,vFreq);
        float cap=smoothstep(.93,.98,vAlong);
        c=mix(c,mix(c,vec3(1.,.98,.91),.69),cap);
        float groove=.82+.18*cos(22.*vAlong);
        gl_FragColor=vec4(c*(.28+.66*vAlong+.33*vAmp)*vShade*groove,uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const mesh = new T.Mesh(vanes, bladeMat)
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  const axes = new T.Vector3()
  pickEllipsoid(veil, () => axes, 0.39)
  group.add(mesh)
  // A separate drifting population samples flux and the decaying onset envelope.
  // Unlike a painted halo these sparks have parallax and travel in front of the ring.
  const count = Math.max(220, Math.min(1900, n * 5)),
    free = new Float32Array(count * 4)
  for (let i = 0; i < count * 4; i++) free[i] = noise(539, i)
  const sparkMat = new T.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexShader:
      lookup +
      `
      attribute vec4 aFree;varying vec2 vUv;varying vec3 vColor;varying float vLife;
      void main(){
        float life=fract(aFree.y+uTime*(.08+.11*aFree.w));
        float direction=aFree.x*tau+uSeed, freq=.5-.5*cos(direction+1.57),energy=signals(freq).r;
        float rad=1.03+.40*energy+life*(.23+.60*aFree.z+.18*uMusic.y);
        direction+=.023*sin(uTime*.21+aFree.w*19.)+.036*life;
        vec3 center=vec3(vec2(cos(direction),sin(direction))*rad,(aFree.w-.5)*.24+.16*life);
        vec4 eye=modelViewMatrix*vec4(center,1.);
        eye.xy+=position.xy*length(modelViewMatrix[0].xyz)*(.004+.013*pow(aFree.z,3.))*(1.+uMusic.y*.40);
        gl_Position=projectionMatrix*eye;
        vUv=uv*2.-1.;vColor=paint(.45+.39*sin(direction+.3)+.12*cos(2.*direction),energy,freq);
        vLife=sin(3.14159*life)*(.28+.54*energy+.37*uMusic.y);
      }`,
    fragmentShader:
      lookup +
      `varying vec2 vUv;varying vec3 vColor;varying float vLife;
      void main(){
        float g=exp(-3.8*dot(vUv,vUv));
        gl_FragColor=vec4(mix(vColor,vec3(1.),.18*g),g*vLife*uOpacity);
        ` +
      outputColor +
      `}`,
  })
  const sparks = new T.Mesh(
    instanced(new T.PlaneGeometry(1, 1), { aFree: { data: free, size: 4 } }),
    sparkMat,
  )
  sparks.frustumCulled = false
  sparks.raycast = () => {}
  group.add(sparks)
  return {
    object: group,
    bounds: ellipsoidBounds(group, () => axes),
    update(f) {
      driver.update(f)
      group.scale.setScalar(f.layer.settings.radius)
      const extent = 1.03 + 0.54 * Math.min(2, f.layer.settings.maxHeight / f.layer.settings.radius)
      axes.set(extent, extent, 0.15)
      veilMat.blending = f.layer.material.blend === 'multiply' ? T.MultiplyBlending : T.AdditiveBlending
      bladeMat.blending =
        f.layer.material.blend === 'multiply'
          ? T.MultiplyBlending
          : f.layer.material.blend === 'add'
            ? T.AdditiveBlending
            : T.NormalBlending
      sparkMat.depthTest = bladeMat.depthTest = veilMat.depthTest = f.layer.depthTest
      bladeMat.depthWrite = f.layer.depthTest && f.layer.opacity >= 0.99
    },
    dispose: driver.dispose,
  }
}
