import * as THREE from './vendor/three.module.js';
import {annulus,drawnWire,lineGeometry} from './model.js';
import {bindSection,sectionCapGeometry} from './cutaway.js';

const TAU=Math.PI*2;
// A chamfered, hollow hexagon. The central bore stays open during approach.
function nutGeometry(radius,bore,width){
  const half=width/2,bevel=.004,segments=48,profile=[[-half,bore+.002,0],[-half,radius-.004,1],[-half+bevel,radius,1],[half-bevel,radius,1],[half,radius-.004,1],[half,bore+.002,0],[half-.002,bore,0],[-half+.002,bore,0]],vertices=[];
  const point=(j,i)=>{const [x,r,hex]=profile[j%profile.length],a=TAU*i/segments,phase=((a+Math.PI/6)%(Math.PI/3))-Math.PI/6,radial=hex?r*Math.cos(Math.PI/6)/Math.cos(phase):r;return [x,radial*Math.cos(a),radial*Math.sin(a)];};
  for(let j=0;j<profile.length;j++)for(let i=0;i<segments;i++){const a=point(j,i),b=point(j,i+1),c=point(j+1,i),d=point(j+1,i+1);vertices.push(...a,...b,...c,...b,...d,...c);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingBox();return geometry;
}
function gasketGrid(inner,outer,width){
  const points=[],at=(x,r,a)=>[x,r*Math.cos(a),r*Math.sin(a)];
  for(const x of [-width/2,width/2])for(const r of [outer,inner])for(let i=0;i<96;i++)points.push(...at(x,r,TAU*i/96),...at(x,r,TAU*(i+1)/96));
  return lineGeometry(points);
}
function nutGrid(radius,bore,width){
  const points=[],half=width/2,at=(x,r,a)=>[x,r*Math.cos(a),r*Math.sin(a)];
  for(const [x,r] of [[-half,radius-.004],[-half+.004,radius],[half-.004,radius],[half,radius-.004]])for(let i=0;i<6;i++)points.push(...at(x,r,Math.PI/6+TAU*i/6),...at(x,r,Math.PI/6+TAU*(i+1)/6));
  for(const [x,r] of [[-half,bore+.002],[-half+.002,bore],[half-.002,bore],[half,bore+.002]])for(let i=0;i<48;i++)points.push(...at(x,r,TAU*i/48),...at(x,r,TAU*(i+1)/48));
  for(let i=0;i<6;i++){const a=Math.PI/6+TAU*i/6;points.push(...at(-half+.004,radius,a),...at(half-.004,radius,a));for(const x of [-half,half])points.push(...at(x,bore+.002,a),...at(x,radius-.004,a));}
  return lineGeometry(points);
}
function studGrid(radius,length){
  const points=[],at=(x,a)=>[x,radius*Math.cos(a),radius*Math.sin(a)];
  for(let ring=0;ring<=5;ring++){const x=-length/2+length*ring/5;for(let i=0;i<24;i++)points.push(...at(x,TAU*i/24),...at(x,TAU*(i+1)/24));}
  for(let i=0;i<12;i++)points.push(...at(-length/2,TAU*i/12),...at(length/2,TAU*i/12));
  return lineGeometry(points);
}
function repeatedWire(geometry,centres){
  const source=drawnWire(geometry),instanced=new THREE.InstancedBufferGeometry().copy(source.geometry);instanced.setAttribute('instanceOffset',new THREE.InstancedBufferAttribute(new Float32Array(centres.flat()),3));instanced.instanceCount=centres.length;
  source.geometry=instanced;source.material.vertexShader='attribute vec3 instanceOffset;attribute float linePosition;varying float vLine;void main(){vLine=linePosition;gl_Position=projectionMatrix*modelViewMatrix*vec4(position+instanceOffset,1.0);}';source.frustumCulled=false;source.userData.warmup=true;return source;
}
export function createFlangeConnection(joints,settings){
  const {count,pitchRadius,phase,holeRadius,gasketInner,gasketOuter,gasketThickness,standOff,studRadius,nutRadius,nutWidth,threadPitch,finish}=settings;
  if(!Number.isInteger(count)||count<3||!(studRadius<holeRadius)||!(gasketInner<gasketOuter&&gasketOuter<pitchRadius-holeRadius)||!(gasketThickness>0))throw Error('Invalid flange connection dimensions');
  const root=new THREE.Group();root.name='flange-connection';root.visible=false;
  const gasketGeometry=annulus(gasketInner,gasketOuter,gasketThickness,'x'),gaskets=[];
  for(const joint of joints){
    const group=new THREE.Group(),reveal={value:0},material=new THREE.MeshStandardMaterial({color:0x30353b,roughness:.7,metalness:.05,side:THREE.DoubleSide});
    material.onBeforeCompile=shader=>{
      shader.uniforms.uGasketReveal=reveal;
      shader.vertexShader='varying vec3 vGasket;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGasket=position;');
      shader.fragmentShader='varying vec3 vGasket;uniform float uGasketReveal;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif((atan(vGasket.z,vGasket.y)+3.141592654)/6.283185307>uGasketReveal)discard;');
    };
    material.customProgramCacheKey=()=> 'gasket-sweep-v1';
    const solid=new THREE.Mesh(gasketGeometry,material),wire=drawnWire(gasketGrid(gasketInner,gasketOuter,gasketThickness));wire.material.uniforms.uOpacity.value=.55;
    group.name='pipeline-'+(joint.side<0?'left':'right')+'-gasket';group.position.x=(joint.valveFace+joint.joint)/2;group.add(solid,wire);root.add(group);
    gaskets.push({root:group,solid,wire,reveal,joint,seatedX:group.position.x,cap:null});
  }
  const tail=.018,span=Math.abs(joints[0].pipeStart-joints[0].valveBack),studLength=span+2*(nutWidth+tail);
  const studGeometry=new THREE.CylinderGeometry(studRadius,studRadius,studLength,20,1,false).rotateZ(Math.PI/2);studGeometry.computeBoundingBox();
  const metal=new THREE.MeshStandardMaterial(finish||{color:0x16345f,metalness:.12,roughness:.38}),nutReveal={value:0};
  const thread=metal.clone();
  metal.onBeforeCompile=shader=>{
    shader.uniforms.uNutReveal=nutReveal;shader.vertexShader='varying vec3 vNut;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvNut=position;');
    shader.fragmentShader='varying vec3 vNut;uniform float uNutReveal;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif((vNut.y/'+nutRadius.toFixed(6)+'+1.0)*.5>uNutReveal)discard;');
  };
  metal.customProgramCacheKey=()=> 'fastener-reveal-v1';
  thread.onBeforeCompile=shader=>{
    shader.uniforms.uNutReveal=nutReveal;
    shader.vertexShader='varying vec3 vThread;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvThread=position;');
    shader.fragmentShader='varying vec3 vThread;uniform float uNutReveal;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif((vThread.y/'+studRadius.toFixed(6)+'+1.0)*.5>uNutReveal)discard;').replace('#include <color_fragment>','#include <color_fragment>\nfloat groove=sin(vThread.x*'+(TAU/threadPitch).toFixed(6)+'-atan(vThread.z,vThread.y));diffuseColor.rgb*=.78+.22*smoothstep(-.4,.6,groove);');
  };
  thread.customProgramCacheKey=()=> 'painted-stud-thread-reveal-v2';
  const studs=new THREE.InstancedMesh(studGeometry,thread,count*joints.length),nuts=new THREE.InstancedMesh(nutGeometry(nutRadius,studRadius+.001,nutWidth),metal,count*joints.length*2);
  for(const [mesh,name] of [[studs,'studs'],[nuts,'nuts']]){mesh.name='flange-'+name;mesh.frustumCulled=false;root.add(mesh);}
  const holes=[];for(const joint of joints)for(let i=0;i<count;i++){const angle=phase+TAU*i/count;holes.push({side:joint.side,joint,index:i,y:pitchRadius*Math.cos(angle),z:pitchRadius*Math.sin(angle)});}
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),nutCentres=[],studCentres=[];
  for(const [i,hole] of holes.entries()){
    position.set((hole.joint.valveBack+hole.joint.pipeStart)/2,hole.y,hole.z);studCentres.push(position.toArray());studs.setMatrixAt(i,matrix.makeTranslation(...position.toArray()));
  }
  for(const [i,hole] of holes.entries())for(let end=0;end<2;end++){
    const direction=hole.side*(end?1:-1),face=end?hole.joint.pipeStart:hole.joint.valveBack,id=i*2+end;
    position.set(face+direction*nutWidth/2,hole.y,hole.z);nutCentres.push(position.toArray());nuts.setMatrixAt(id,matrix.makeTranslation(...position.toArray()));
  }
  const nutWire=repeatedWire(nutGrid(nutRadius,studRadius+.001,nutWidth),nutCentres),studWire=repeatedWire(studGrid(studRadius,studLength),studCentres);root.add(nutWire,studWire);
  function section(uniforms,field){
    bindSection(thread,uniforms,{field});bindSection(metal,uniforms,{field});
    const material=new THREE.MeshBasicMaterial({color:0x30353b,side:THREE.DoubleSide});bindSection(material,uniforms,{cap:true,field});
    const geometry=sectionCapGeometry([gaskets[0].solid],{boreRadius:gasketInner});
    for(const gasket of gaskets){const cap=new THREE.Mesh(geometry,material);cap.position.z=.0004;cap.renderOrder=4;cap.visible=false;gasket.root.add(cap);gasket.cap=cap;}
  }
  function update(state){
    const draw=state.gasketDraw||0,solid=state.gasketSolid||0,seat=state.gasketSeat||0,nutDraw=state.nutDraw||0,nutSolid=state.nutSolid||0;
    root.visible=draw>0||nutDraw>0;
    for(const gasket of gaskets){
      gasket.root.position.x=gasket.seatedX+gasket.joint.side*standOff*(1-seat);gasket.root.rotation.y=gasket.joint.side*.30*(1-seat);
      gasket.solid.visible=solid>0;gasket.reveal.value=solid>=1?1.001:solid;gasket.wire.visible=draw>0&&solid<1;gasket.wire.material.uniforms.uDraw.value=draw;gasket.wire.material.uniforms.uOpacity.value=.55*(1-solid);
      if(gasket.cap)gasket.cap.visible=(state.cutaway||0)>0;
    }
    studs.visible=nuts.visible=nutSolid>0;nutReveal.value=nutSolid>=1?1.001:nutSolid;
    for(const wire of [nutWire,studWire]){wire.visible=nutDraw>0&&nutSolid<1;wire.material.uniforms.uDraw.value=nutDraw;wire.material.uniforms.uOpacity.value=.48*(1-nutSolid);}
  }
  return {root,gaskets,studs,nuts,nutWire,studWire,holes,settings,studLength,bindSection:section,update};
}
