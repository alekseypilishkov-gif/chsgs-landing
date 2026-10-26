import * as THREE from './vendor/three.module.js';

export async function createFactoryDetailModel(scene){
  const base=new URL('./assets/factory/',import.meta.url);
  const [metaResponse,binaryResponse]=await Promise.all([fetch(new URL('detail-wire.json',base)),fetch(new URL('detail-wire.bin',base))]);
  if(!metaResponse.ok||!binaryResponse.ok)throw Error('Factory geometry unavailable');
  const [meta,buffer]=await Promise.all([metaResponse.json(),binaryResponse.arrayBuffer()]);
  const count=meta.gridVertices+meta.edgeVertices;
  if(meta.version!==1||!Number.isInteger(count)||count<2||count>500000||count%2||buffer.byteLength!==meta.bytes||buffer.byteLength!==count*12)throw Error('Invalid factory geometry');
  const positions=new Float32Array(buffer);
  if(!positions.every(n=>Number.isFinite(n)&&Math.abs(n)<100))throw Error('Invalid factory coordinates');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeBoundingBox();
  const box=geometry.boundingBox,centre=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),scale=4.6/Math.max(size.x,size.z);
  geometry.translate(-centre.x,-centre.y,-centre.z);geometry.scale(scale,scale,scale);
  const p=geometry.attributes.position.array,centres=new Float32Array(p.length),seeds=new Float32Array(count),leads=new Float32Array(count),strengths=new Float32Array(count);
  let last=-1;
  for(let vertex=0;vertex<count;vertex+=2){
    const group=Math.floor(vertex/2*Math.min(1000,count/2)/(count/2)),seed=((Math.sin((group+1)*127.1)*43758.5453)%1+1)%1;
    for(let end=0;end<2;end++){
      seeds[vertex+end]=seed;leads[vertex+end]=group!==last?1:0;strengths[vertex+end]=vertex<meta.gridVertices ? .065 : .25;
      for(let axis=0;axis<3;axis++)centres[(vertex+end)*3+axis]=(p[vertex*3+axis]+p[vertex*3+3+axis])/2;
    }last=group;
  }
  for(const [name,array,size] of [['centre',centres,3],['seed',seeds,1],['lead',leads,1],['strength',strengths,1]])geometry.setAttribute(name,new THREE.BufferAttribute(array,size));
  geometry.computeBoundingSphere();
  const uniforms={uReveal:{value:0},uOpacity:{value:1},uShift:{value:new THREE.Vector2()},uTint:{value:new THREE.Color(1,1,1)},uAccent:{value:new THREE.Color('#ffec00')}};
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms,vertexShader:`
    attribute vec3 centre;attribute float seed,lead,strength;
    uniform float uReveal;uniform vec2 uShift;uniform vec3 uAccent;varying vec3 vColor;varying float vAlpha;
    void main(){
      float travel=smoothstep(0.,.65,uReveal-seed*.15),trace=smoothstep(.35,.85,uReveal-seed*.15);
      vec3 p=centre+(position-centre)*max(.01,trace)+vec3(sin(seed*91.)*4.,1.5+seed*3.,cos(seed*31.)*3.)*(1.-travel);
      vAlpha=strength*trace;
      vColor=mix(uAccent,vec3(.75,.77,.81),smoothstep(.45,1.,trace));
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_Position.xy+=uShift*gl_Position.w;
    }`,fragmentShader:`
    uniform float uOpacity;uniform vec3 uTint;varying vec3 vColor;varying float vAlpha;
    void main(){gl_FragColor=vec4(vColor*uTint,vAlpha*uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const rig=new THREE.Group(),wire=new THREE.LineSegments(geometry,material);wire.renderOrder=1;
  const fringes=[new THREE.Color(1,0,0),new THREE.Color(0,1,1)].map(tint=>{
    const m=material.clone();m.blending=THREE.AdditiveBlending;m.uniforms={...uniforms,uTint:{value:tint},uShift:{value:new THREE.Vector2()},uOpacity:{value:.5}};return new THREE.LineSegments(geometry,m);
  });
  const particlePositions=[],particleSeeds=[];
  for(let vertex=0;vertex<count;vertex+=2)if(leads[vertex]){particlePositions.push(...centres.subarray(vertex*3,vertex*3+3));particleSeeds.push(seeds[vertex]);}
  const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.Float32BufferAttribute(particlePositions,3));particleGeometry.setAttribute('seed',new THREE.Float32BufferAttribute(particleSeeds,1));particleGeometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),8);
  const particleMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{...uniforms,uPixelRatio:{value:1},uFringe:{value:0}},vertexShader:`
    attribute float seed;uniform float uReveal,uPixelRatio;uniform vec2 uShift;varying float vAlpha;
    void main(){float phase=uReveal-seed*.15,travel=smoothstep(0.,.65,phase),trace=smoothstep(.35,.85,phase);
      vec3 p=position+vec3(sin(seed*91.)*4.,1.5+seed*3.,cos(seed*31.)*3.)*(1.-travel);
      vAlpha=.95*(1.-trace)*smoothstep(0.,.04,phase);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_Position.xy+=uShift*gl_Position.w;gl_PointSize=3.2*uPixelRatio*mix(1.,.7,travel);
    }`,fragmentShader:`
    uniform vec3 uAccent,uTint;uniform float uOpacity,uFringe;varying float vAlpha;
    void main(){vec2 uv=gl_PointCoord-.5;float disk=1.-smoothstep(.18,.25,dot(uv,uv));gl_FragColor=vec4(mix(uAccent,uTint,uFringe),disk*vAlpha*uOpacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const particle=new THREE.Points(particleGeometry,particleMaterial);particle.renderOrder=2;
  const particleFringes=[new THREE.Color(1,0,0),new THREE.Color(0,1,1)].map(tint=>{const m=particleMaterial.clone();m.blending=THREE.AdditiveBlending;m.uniforms={...particleMaterial.uniforms,uTint:{value:tint},uShift:{value:new THREE.Vector2()},uOpacity:{value:.25},uFringe:{value:1}};return new THREE.Points(particleGeometry,m);});
  rig.add(...fringes,wire,...particleFringes,particle);rig.visible=false;scene.add(rig);let started=null;
  return {
    reset(){started=null;rig.visible=false;},
    update(seconds,{rect,width,height,camera,active,reduced=false,pan=[0,0]}){
      if(!active||!rect||rect.top>height||rect.bottom<0){rig.visible=false;return {reveal:started===null?0:1};}
      if(started===null&&(rect.top+rect.height*.5)<height*.9)started=seconds;
      const reveal=reduced?1:started===null?0:Math.min(1,(seconds-started)/1.1);
      rig.visible=reveal>0;particle.visible=reveal<1;particleFringes.forEach(mesh=>mesh.visible=reveal<1);particleMaterial.uniforms.uPixelRatio.value=Math.min(globalThis.devicePixelRatio||1,1.75);
      const span=2*camera.position.length()*Math.tan(camera.fov*Math.PI/360),worldWidth=span*width/height;
      rig.scale.setScalar(rect.width/width*worldWidth/5.8);
      rig.position.set(((rect.left+rect.width/2)/width-.5+pan[0]*.4)*worldWidth,(.5-(rect.top+rect.height/2)/height+pan[1]*.4)*span,0);
      rig.rotation.set(.48+pan[1]*3,-.5+(reduced?0:seconds*.055)+pan[0]*3,0);
      uniforms.uReveal.value=reveal;
      fringes.forEach((mesh,i)=>{const sign=i?1:-1;mesh.material.uniforms.uShift.value.set(sign*1.1*2/width,sign*.25*2/height);});
      particleFringes.forEach((mesh,i)=>{const sign=i?1:-1;mesh.material.uniforms.uShift.value.set(sign*.7*2/width,sign*.15*2/height);});
      return {reveal};
    },
    dispose(){geometry.dispose();material.dispose();fringes.forEach(n=>n.material.dispose());particleGeometry.dispose();particleMaterial.dispose();particleFringes.forEach(n=>n.material.dispose());scene.remove(rig);},
  };
}
