import * as THREE from './vendor/three.module.js';
import {elbowPath,sweptTube,elbowGrid} from './elbow.js';
import {createFlangeConnection} from './flange-connection.js';

function boundsOf(part){
  const box=new THREE.Box3();
  for(const entry of part.solids){if(entry.finalDetail)continue;entry.mesh.updateMatrix();entry.mesh.geometry.computeBoundingBox();box.union(entry.mesh.geometry.boundingBox.clone().applyMatrix4(entry.mesh.matrix));}
  if(box.isEmpty())throw Error('Pipeline source has no surfaces: '+part.id);
  return box;
}

function copyComponent(part,kind){
  const root=new THREE.Group(),bounds=boundsOf(part),reveal={value:-.001},draw={value:0},opacity={value:0};
  const axis=kind==='pipe'?new THREE.Vector3(1,0,0):new THREE.Vector3(.1,.8,.2);
  const start={value:bounds.min.dot(axis)},span={value:Math.max(.0001,bounds.max.dot(axis)-start.value)};
  const solids=[],wires=[];
  for(const entry of part.solids){
    if(entry.finalDetail)continue;
    const geometry=entry.mesh.geometry.clone().applyMatrix4(entry.mesh.matrix);
    const source=Array.isArray(entry.mesh.material)?entry.mesh.material:[entry.mesh.material];
    const materials=source.map(original=>{
      const material=original.clone();
      material.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,{uInstallationReveal:reveal,uInstallationAxis:{value:axis},uInstallationStart:start,uInstallationSpan:span});
        shader.vertexShader='varying vec3 vInstallationSource;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvInstallationSource=position;');
        shader.fragmentShader='varying vec3 vInstallationSource;uniform float uInstallationReveal;uniform vec3 uInstallationAxis;uniform float uInstallationStart;uniform float uInstallationSpan;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif((dot(vInstallationSource,uInstallationAxis)-uInstallationStart)/uInstallationSpan>uInstallationReveal)discard;');
      };
      material.customProgramCacheKey=()=> 'installation-surface-v1';return material;
    });
    const mesh=new THREE.Mesh(geometry,Array.isArray(entry.mesh.material)?materials:materials[0]);mesh.renderOrder=1;root.add(mesh);solids.push(mesh);
  }
  for(const source of part.wires){
    source.updateMatrix();const geometry=source.geometry.clone().applyMatrix4(source.matrix);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,uniforms:{uDraw:draw,uOpacity:opacity,uStart:start,uSpan:span,uTrace:{value:kind==='flange'?1:0},uSolid:reveal,uPipe:{value:kind==='pipe'?1:0},uColor:{value:new THREE.Color(0xc9ccd4)}},vertexShader:'attribute float linePosition;uniform float uStart;uniform float uSpan;uniform float uTrace;varying float vField;void main(){vField=mix((position.x-uStart)/uSpan,linePosition,uTrace);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform float uDraw;uniform float uOpacity;uniform float uSolid;uniform float uPipe;uniform vec3 uColor;varying float vField;void main(){if(vField>uDraw||(uPipe>.5&&vField<=uSolid))discard;gl_FragColor=vec4(uColor,uOpacity);}'});
    const wire=new THREE.LineSegments(geometry,material);wire.renderOrder=2;root.add(wire);wires.push(wire);
  }
  return {root,kind,bounds,reveal,draw,opacity,axis,start,span,solids,wires};
}

// Resample the rotational pipe envelope after choosing its displayed length.
// CAD edge density at weld/end interfaces must not determine the wire spacing.
function regularPipeGrid(unit,length,step=.18){
  const edges=[];
  for(const mesh of unit.solids){
    const {position:p}=mesh.geometry.attributes,index=mesh.geometry.index,count=index?index.count:p.count;
    const point=i=>{const v=index?index.getX(i):i;return [p.getX(v),p.getY(v),p.getZ(v)];};
    for(let i=0;i<count;i+=3){const t=[point(i),point(i+1),point(i+2)];for(let k=0;k<3;k++)edges.push([t[k],t[(k+1)%3]]);}
  }
  const intervals=Math.max(2,Math.ceil(length/step)),rings=[],points=[],segments=80,meridians=24;
  for(let i=0;i<=intervals;i++){
    const x=unit.bounds.min.x+(unit.bounds.max.x-unit.bounds.min.x)*i/intervals;let radius=0;
    for(const [a,b] of edges){
      if(x<Math.min(a[0],b[0])-1e-6||x>Math.max(a[0],b[0])+1e-6)continue;
      if(Math.abs(a[0]-b[0])<1e-7){if(Math.abs(x-a[0])<1e-6)radius=Math.max(radius,Math.hypot(a[1],a[2]),Math.hypot(b[1],b[2]));continue;}
      const t=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));radius=Math.max(radius,Math.hypot(a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t));
    }
    rings.push([x,radius]);
  }
  const at=([x,r],angle)=>[x,r*Math.cos(angle),r*Math.sin(angle)];
  for(const ring of rings)for(let j=0;j<segments;j++)points.push(...at(ring,j*Math.PI*2/segments),...at(ring,(j+1)*Math.PI*2/segments));
  for(let j=0;j<meridians;j++)for(let i=1;i<rings.length;i++)points.push(...at(rings[i-1],j*Math.PI*2/meridians),...at(rings[i],j*Math.PI*2/meridians));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('linePosition',new THREE.Float32BufferAttribute(new Float32Array(points.length/3),1));
  geometry.userData.regularGrid={rings:rings.length,ringVertices:segments*2,worldStep:length/intervals};
  const first=unit.wires[0];
  for(const wire of unit.wires){wire.geometry.dispose();if(wire!==first){unit.root.remove(wire);wire.material.dispose();}}
  first.geometry=geometry;unit.wires=[first];
}

// Context geometry is kept outside the valve's exploded-part inventory.
// Opposite-side source parts already face the mating joint correctly.
export function createPipeline(sides,{length=2.8,gap=.004,matingInset=0,elbow=null,innerRadius=.406,outerRadius=.426,connection=null}={}){
  if(!(length>0)||!(gap>=0)||!(matingInset>=0))throw Error('Invalid pipeline dimensions');
  const root=new THREE.Group();root.name='pipeline-context';root.visible=false;
  const units=[],joints=[];
  for(const [name,side] of [['left',-1],['right',1]]){
    const source=sides[name],valve=boundsOf(source.valveFlange);
    const flange=copyComponent(source.flangeSource,'flange'),pipe=copyComponent(source.pipeSource,'pipe');
    const face=side<0?flange.bounds.max.x:flange.bounds.min.x,back=side<0?flange.bounds.min.x:flange.bounds.max.x;
    const valveFace=side<0?valve.min.x:valve.max.x,valveBack=side<0?valve.max.x:valve.min.x,joint=valveFace+side*(connection?connection.gasketThickness:gap-matingInset);
    flange.root.position.x=joint-face;
    const pipeStart=back+flange.root.position.x,near=side<0?pipe.bounds.max.x:pipe.bounds.min.x,far=side<0?pipe.bounds.min.x:pipe.bounds.max.x;
    const scale=length/(pipe.bounds.max.x-pipe.bounds.min.x);
    pipe.root.scale.x=scale;pipe.root.position.x=pipeStart-near*scale;pipe.start.value=near;pipe.span.value=far-near;
    if(elbow){
      const route=elbowPath({side,start:pipeStart,length,...elbow}),geometry=sweptTube(route,innerRadius,outerRadius),grid=elbowGrid(route,outerRadius);
      const surface=pipe.solids[0].material,wireMaterial=pipe.wires[0].material;
      const distance=`float installationDistance(vec3 p){float q=${side.toFixed(1)}*(p.x-(${pipeStart.toFixed(9)}));float r=${route.radius.toFixed(9)},s=${route.straight.toFixed(9)};if(q<=s)return q;if(p.y>=-r)return s+r*clamp(atan(q-s,p.y+r),0.0,1.570796327);return s+r*1.570796327-r-p.y;}`;
      surface.onBeforeCompile=shader=>{
        shader.uniforms.uInstallationReveal=pipe.reveal;
        shader.vertexShader='varying vec3 vInstallationSource;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvInstallationSource=position;');
        shader.fragmentShader=distance+'\nvarying vec3 vInstallationSource;uniform float uInstallationReveal;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(installationDistance(vInstallationSource)/'+length.toFixed(9)+'>uInstallationReveal)discard;');
      };
      surface.customProgramCacheKey=()=> 'installation-elbow-'+[side,pipeStart,length,route.radius,route.straight].join(':');surface.needsUpdate=true;
      wireMaterial.vertexShader=distance+'\nattribute float linePosition;varying float vField;void main(){vField=installationDistance(position)/'+length.toFixed(9)+';gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';wireMaterial.needsUpdate=true;
      for(const mesh of pipe.solids){pipe.root.remove(mesh);mesh.geometry.dispose();if(mesh.material!==surface)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();}
      for(const wire of pipe.wires){pipe.root.remove(wire);wire.geometry.dispose();if(wire.material!==wireMaterial)wire.material.dispose();}
      const mesh=new THREE.Mesh(geometry,surface),wire=new THREE.LineSegments(grid,wireMaterial);mesh.renderOrder=1;wire.renderOrder=2;pipe.root.add(mesh,wire);
      pipe.root.scale.set(1,1,1);pipe.root.position.set(0,0,0);pipe.solids=[mesh];pipe.wires=[wire];pipe.bounds.copy(geometry.boundingBox);pipe.route=route;pipe.outerRadius=outerRadius;pipe.innerRadius=innerRadius;
    }else regularPipeGrid(pipe,length);
    for(const unit of [flange,pipe]){unit.side=side;unit.root.name='pipeline-'+name+'-'+unit.kind;root.add(unit.root);units.push(unit);}
    joints.push({side,valveFace,valveBack,joint,pipeStart,pipeEnd:pipeStart+side*length,route:pipe.route||null});
  }
  const fastening=connection?createFlangeConnection(joints,connection):null;if(fastening)root.add(fastening.root);
  function update(state){
    root.visible=state.gasketDraw>0||state.flangeWire>0||state.flangeSolid>0||state.pipeWire>0||state.pipeSolid>0;
    fastening?.update(state);
    for(const unit of units){
      const wire=unit.kind==='flange'?state.flangeWire:state.pipeWire,solid=unit.kind==='flange'?state.flangeSolid:state.pipeSolid;
      unit.draw.value=wire;unit.reveal.value=solid*1.002-.001;unit.opacity.value=.4*(1-solid);
      for(const mesh of unit.solids)mesh.visible=solid>0;
      for(const mesh of unit.wires)mesh.visible=wire>0&&solid<1;
    }
  }
  return {root,units,joints,fastening,update};
}
