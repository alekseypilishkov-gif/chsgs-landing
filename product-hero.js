import * as THREE from './vendor/three.module.js';
import {heroAt} from './hero-motion.js';
import {detailProductAt} from './detail-motion.js';
import {createAmbientParticles} from './ambient-particles.js';

async function loadPositions(url,count){
  const response=await fetch(url);if(!response.ok)throw Error('Product geometry unavailable');
  let bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===0x1f&&bytes[1]===0x8b)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(bytes.byteLength!==count*24)throw Error('Invalid product geometry size');
  const positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
  if(!positions.every(n=>Number.isFinite(n)&&Math.abs(n)<3))throw Error('Invalid product geometry coordinates');return positions;
}
function createGeometries(positions,segments){
  const attributes=positions.map(p=>new THREE.BufferAttribute(p,3)),seeds=new Float32Array(segments*2);
  const random=i=>((Math.sin((i+1)*127.1)*43758.5453)%1+1)%1;
  const particleBudget=Math.min(1000,segments),centres=new Float32Array(positions[0].length),lead=new Float32Array(seeds.length);
  let lastGroup=-1;
  for(let i=0;i<segments;i++){
    const group=Math.floor(i*particleBudget/segments);seeds[i*2]=seeds[i*2+1]=random(group);lead[i*2]=lead[i*2+1]=group!==lastGroup?1:0;lastGroup=group;
    for(let axis=0;axis<3;axis++)centres[i*6+axis]=centres[i*6+3+axis]=(positions[0][i*6+axis]+positions[0][i*6+3+axis])/2;
  }
  const centreAttribute=new THREE.BufferAttribute(centres,3),leadAttribute=new THREE.BufferAttribute(lead,1),seedAttribute=new THREE.BufferAttribute(seeds,1);
  return attributes.map((attribute,index)=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',attribute);geometry.setAttribute('nextPosition',attributes[(index+1)%attributes.length]);geometry.setAttribute('seed',seedAttribute);geometry.setAttribute('centre',centreAttribute);geometry.setAttribute('lead',leadAttribute);geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),4.2);return geometry;
  });
}
export async function createProductHero(scene,{lowPower=false}={}){
  const url=new URL('./assets/product-hero/manifest.json',import.meta.url),response=await fetch(url);if(!response.ok)throw Error('Product manifest unavailable');const manifest=await response.json();
  // Keep the previous published manifest usable during a static cache refresh.
  if(manifest.version!==1||!Number.isInteger(manifest.segments)||manifest.segments<1||manifest.segments>400000||![3,5].includes(manifest.models?.length)||manifest.models.some(m=>!/^[-a-z]+\.bin\.gz$/.test(m.file)))throw Error('Invalid product manifest');
  if(manifest.low&&(!Number.isInteger(manifest.low.segments)||manifest.low.segments<1000||manifest.low.segments>manifest.segments||manifest.low.models?.length!==manifest.models.length||manifest.low.models.some((m,i)=>m.id!==manifest.models[i].id||!/^[-a-z]+\.low\.bin\.gz$/.test(m.file))))throw Error('Invalid low-detail product manifest');
  const load=async resources=>createGeometries(await Promise.all(resources.models.map(m=>loadPositions(new URL(m.file,url),resources.segments))),resources.segments);
  let resources=lowPower&&manifest.low?manifest.low:manifest,geometries=await load(resources),disposed=false,reduction=null;
  const uniforms={uAssembly:{value:0},uMorph:{value:0},uOpacity:{value:1},uTime:{value:0},uAccent:{value:new THREE.Color('#ffec00')},uShift:{value:new THREE.Vector2()},uTint:{value:new THREE.Color(1,1,1)}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms,vertexShader:`
    attribute vec3 nextPosition,centre;attribute float seed,lead;
    uniform float uAssembly,uMorph,uTime;uniform vec3 uAccent;uniform vec2 uShift;varying float vReveal;varying vec3 vColor;
    float easeSin(float value){return sin((clamp(value,0.,1.)-.5)*3.14159265359)*.5+.5;}
    void main(){
      vec3 point=mix(position,nextPosition,uMorph);vReveal=.065;vColor=vec3(.73,.75,.79);
      if(uAssembly<.99999){
        float flightTime=(uTime-(.25+seed*.35))/(.95+seed*.45);float flight=easeSin(flightTime);float trace=easeSin((uAssembly-.5*seed)*2.);
        vec3 delta=position-centre;float extent=max(length(delta),.000001);
        vec3 offset=vec3(sin(seed*91.7)*3.5,1.8+sin(seed*27.3)*1.5,4.+cos(seed*67.1)*3.);
        offset.y+=(sin((uTime+3000000.)*.2*seed+seed*6.283185)*.5+.5)*.8;
        point=centre+delta/extent*mix(.012,extent,trace)+offset*(1.-flight);
        vReveal=flightTime<1.?lead*.9*smoothstep(0.,.08,flightTime):mix(lead*.9,.065,trace);
        vColor=mix(uAccent,vColor,smoothstep(.35,1.,trace));
      }
      gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);gl_Position.xy+=uShift*gl_Position.w;
    }
  `,fragmentShader:`
    uniform float uOpacity;uniform vec3 uTint;varying float vReveal;varying vec3 vColor;
    void main(){
      gl_FragColor=vec4(vColor*uTint,vReveal*uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  const rig=new THREE.Group(),wire=new THREE.LineSegments(geometries[0],material);wire.renderOrder=1;
  const fringes=[new THREE.Color(1,0,0),new THREE.Color(0,1,1)].map(tint=>{
    const fringe=material.clone();fringe.blending=THREE.AdditiveBlending;fringe.uniforms={...uniforms,uTint:{value:tint},uShift:{value:new THREE.Vector2()},uOpacity:{value:0}};
    return new THREE.LineSegments(geometries[0],fringe);
  });
  rig.add(...fringes,wire);scene.add(rig);
  const ambient=createAmbientParticles(scene);let portraitDetailLift=0;
  return {
    manifest,
    get segments(){return resources.segments;},
    reduceQuality(){
      if(resources===manifest.low||!manifest.low)return Promise.resolve(false);
      if(!reduction)reduction=load(manifest.low).then(next=>{if(disposed){next.forEach(g=>g.dispose());return false;}const previous=geometries;geometries=next;resources=manifest.low;wire.geometry=geometries[0];fringes.forEach(mesh=>mesh.geometry=wire.geometry);previous.forEach(g=>g.dispose());return true;}).catch(error=>{console.warn('Lower-detail products unavailable',error);return false;});
      return reduction;
    },
    resize(camera,width,height){const aspect=width/height;camera.aspect=aspect;camera.clearViewOffset();camera.position.set(0,.12,Math.max(9.6,4.8/(2*Math.tan(35*Math.PI/360)*aspect*.84)));camera.lookAt(0,0,0);camera.updateProjectionMatrix();portraitDetailLift=width<height?2*camera.position.length()*Math.tan(camera.fov*Math.PI/360)*.24:0;fringes.forEach((mesh,i)=>mesh.material.uniforms.uShift.value.set((i?-1.5:1.5)*2/width,(i?-.3:.3)*2/height));ambient.resize(width,height);},
    update(seconds,{progress=0,pan=[0,0],reduced=false,menu=0,detail=0,detailScroll=0,height=1080}={}){
      const state=heroAt(seconds,{reduced,models:manifest.models.length}),pose=detailProductAt(detailScroll,height,reduced),opacity=Math.max(0,1-progress*2)*(1-menu*.5)*(1-detail*(1-pose.opacity));
      rig.scale.setScalar(1+detail*(pose.scale-1));rig.position.set(detail*(pose.x+pan[0]*6),detail*(pose.y+portraitDetailLift+pan[1]*4),0);
      rig.visible=opacity>0;rig.rotation.set(pan[1]*(.25+detail*3),-.25-state.angle*Math.PI/180+pan[0]*(.3+detail*3),0);wire.geometry=geometries[state.from];for(const mesh of fringes){mesh.geometry=wire.geometry;mesh.visible=state.assembly===1&&menu===0&&detail===0;mesh.material.uniforms.uOpacity.value=opacity*.6;}
      uniforms.uAssembly.value=state.assembly;uniforms.uMorph.value=state.morph;uniforms.uOpacity.value=opacity;uniforms.uTime.value=seconds;
      ambient.update(seconds,reduced);return state;
    },
    dispose(){disposed=true;for(const geometry of geometries)geometry.dispose();material.dispose();for(const mesh of fringes)mesh.material.dispose();ambient.dispose();scene.remove(rig);},
  };
}
