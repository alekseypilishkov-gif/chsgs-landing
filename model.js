import * as THREE from './vendor/three.module.js';
import {partPath} from './motion.js';
const TAU=Math.PI*2;
export function readCAD(buffer){
  const dv=new DataView(buffer);if(dv.getUint32(0,true)!==0x46546c67)throw Error('Invalid GLB');
  const jsonLength=dv.getUint32(12,true);const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));
  const binaryStart=20+jsonLength+8;
  const attr=index=>{const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];const Type=a.componentType===5125?Uint32Array:Float32Array;return new Type(buffer,binaryStart+(v.byteOffset||0)+(a.byteOffset||0),a.count*(a.type==='VEC3'?3:1));};
  const result=new Map();for(const node of doc.nodes){const p=doc.meshes[node.mesh].primitives[0],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(attr(p.attributes.POSITION),3));g.setAttribute('normal',new THREE.BufferAttribute(attr(p.attributes.NORMAL),3));g.setIndex(new THREE.BufferAttribute(attr(p.indices),1));g.computeBoundingBox();if(node.extras.gridAccessor!==undefined)g.userData.grid=attr(node.extras.gridAccessor);g.userData.faceRanges=node.extras.sourceFaceRanges;result.set(node.name,g);}return result;
}
// Preserve source face identity when a product assigns finishes or timed details.
export function selectCADFaces(source,predicate){
  const geometry=new THREE.BufferGeometry(),positions=[],normals=[],indices=[],grid=[],remap=new Map(),ranges=[];
  for(const face of source.userData.faceRanges.filter(face=>predicate(face.id))){
    const start=indices.length,gridStart=grid.length/3;
    for(let i=face.indexStart;i<face.indexStart+face.indexCount;i++){
      const original=source.index.getX(i);let id=remap.get(original);
      if(id===undefined){id=positions.length/3;remap.set(original,id);for(const [attribute,target] of [['position',positions],['normal',normals]]){const a=source.attributes[attribute];target.push(a.getX(original),a.getY(original),a.getZ(original));}}
      indices.push(id);
    }
    grid.push(...source.userData.grid.subarray(face.gridStart*3,(face.gridStart+face.gridCount)*3));
    ranges.push({...face,indexStart:start,gridStart});
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(indices);
  geometry.userData.grid=new Float32Array(grid);geometry.userData.faceRanges=ranges;geometry.computeBoundingBox();return geometry;
}
export function revolved(profile,axis='x',segments=80){
  const g=new THREE.LatheGeometry(profile.map(([x,r])=>new THREE.Vector2(r,x)),segments);
  if(axis==='x')g.rotateZ(-Math.PI/2);
  return g;
}
export function annulus(inner,outer,thickness,axis='x'){
  return revolved([[-thickness/2,inner],[-thickness/2,outer],[thickness/2,outer],[thickness/2,inner],[-thickness/2,inner]],axis);
}
export function waveAnnulus(inner,outer,envelope,waves=3,segments=144){
  // One closed annular strip, undulating axially within the original package.
  // Wave count and strip gauge are presentation parameters, not CAD dimensions.
  const gauge=envelope*.2,amplitude=(envelope-gauge)/2;
  const section=[[inner,-gauge/2],[outer,-gauge/2],[outer,gauge/2],[inner,gauge/2],[inner,-gauge/2]];
  const positions=[],uv=[],indices=[],stride=section.length;
  for(let i=0;i<=segments;i++){
    const angle=TAU*i/segments,axial=amplitude*Math.sin(waves*angle);
    for(let j=0;j<stride;j++){const [radius,offset]=section[j];positions.push(axial+offset,radius*Math.cos(angle),radius*Math.sin(angle));uv.push(i/segments,j/(stride-1));}
  }
  for(let i=0;i<segments;i++)for(let j=0;j<stride-1;j++){const a=i*stride+j,b=(i+1)*stride+j;indices.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function lineGeometry(segments){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(segments,3));return g;}
function surfaceGrid(geometry){
  if(geometry.userData.grid)return lineGeometry(geometry.userData.grid);
  const uv=geometry.attributes.uv,p=geometry.attributes.position,index=geometry.index;
  if(!uv)return new THREE.EdgesGeometry(geometry,19);
  const points=[];
  // UV isocurves on the authored lathe / cylinder, without triangulation diagonals.
  for(let axis=0;axis<2;axis++)for(let row=1;row<(axis?10:24);row++){
    const level=row/(axis?10:24);
    for(let i=0;i<(index?index.count:p.count);i+=3){
      const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k),hits=[];
      for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],va=axis?uv.getY(a):uv.getX(a),vb=axis?uv.getY(b):uv.getX(b);
        if((va<=level&&vb>level)||(vb<=level&&va>level)){const t=(level-va)/(vb-va);hits.push([p.getX(a)+(p.getX(b)-p.getX(a))*t,p.getY(a)+(p.getY(b)-p.getY(a))*t,p.getZ(a)+(p.getZ(b)-p.getZ(a))*t]);}}
      if(hits.length===2)points.push(...hits[0],...hits[1]);
    }
  }
  return lineGeometry(points);
}
export function drawnWire(geometry){
  const a=geometry.attributes.position,progress=[];let length=0;
  for(let i=0;i<a.count;i+=2){const d=Math.hypot(a.getX(i+1)-a.getX(i),a.getY(i+1)-a.getY(i),a.getZ(i+1)-a.getZ(i));progress.push(length,length+d);length+=d;}
  geometry.setAttribute('linePosition',new THREE.Float32BufferAttribute(progress.map(n=>length?n/length:0),1));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,uniforms:{uDraw:{value:0},uOpacity:{value:.18},uColor:{value:new THREE.Color(0xc9ccd4)}},vertexShader:'attribute float linePosition;varying float vLine;void main(){vLine=linePosition;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform float uDraw;uniform float uOpacity;uniform vec3 uColor;varying float vLine;void main(){if(vLine>uDraw)discard;gl_FragColor=vec4(uColor,uOpacity);}'});
  const wire=new THREE.LineSegments(geometry,material);wire.renderOrder=2;return wire;
}
export function createDisplayModel(materials,paths={},prepared=null){
  const root=new THREE.Group();const parts=[];
  const createPart=(id,offset,stagger=0)=>{const group=new THREE.Group();group.name=id;root.add(group);const p={id,group,offset:new THREE.Vector3(...offset),path:partPath(id,offset,paths),stagger,solids:[],wires:[],occluders:[]};parts.push(p);return p;};
  function add(part,geometry,material='paint',grid=null,options={}){
    geometry.computeBoundingBox();const box=geometry.boundingBox;
    // A slope-scaled bias on closed CAD surfaces can pull grazing internal
    // triangles through the exterior. Keep only a bounded one-unit bias.
    const surfaces=(Array.isArray(material)?material:[material]).map(name=>{const {reflectionEnvironment,...properties}=materials[name];const surface=new THREE.MeshStandardMaterial({...properties,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:0,polygonOffsetUnits:-1});surface.userData.reflectionEnvironment=reflectionEnvironment;return surface;});
    const reveal={value:-.1},edge={value:0};
    const min=box.min.x*.42+box.min.y*.7+box.min.z*.12,max=box.max.x*.42+box.max.y*.7+box.max.z*.12;
    for(const surface of surfaces){surface.onBeforeCompile=shader=>{shader.uniforms.uReveal=reveal;shader.uniforms.uTrace=edge;shader.uniforms.uMin={value:min};shader.uniforms.uRange={value:Math.max(.01,max-min)};
      shader.vertexShader='varying vec3 vSource;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSource=position;');
      shader.fragmentShader='uniform float uReveal;uniform float uTrace;uniform float uMin;uniform float uRange;varying vec3 vSource;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nfloat field=(dot(vSource,vec3(.42,.7,.12))-uMin)/uRange; if(field>uReveal)discard;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nfloat trace=(1.0-smoothstep(.0,.018,abs(field-uReveal)))*uTrace; totalEmissiveRadiance+=vec3(.18,.16,.04)*trace;');};
    surface.customProgramCacheKey=()=> 'source-surface-reveal-v1';}
    const mesh=new THREE.Mesh(geometry,Array.isArray(material)?surfaces:surfaces[0]);mesh.name=part.id+(options.finalDetail?'-weld':'-surface');mesh.renderOrder=1;part.group.add(mesh);part.solids.push({mesh,reveal,edge,finalDetail:!!options.finalDetail});
    if(options.wire===false)return mesh;
    const key=part.id+'/'+part.wires.length;
    let lines;
    if(prepared?.wire)lines=prepared.wire(key,geometry,grid);
    else {
      const edgeGeometry=new THREE.EdgesGeometry(geometry,19),edges=edgeGeometry.attributes.position.array;
      const iso=(grid||surfaceGrid(geometry)).attributes.position.array;
      prepared?.captureWire?.(key,geometry,grid,edges,iso);
      lines=new Float32Array(edges.length+iso.length);lines.set(edges);lines.set(iso,edges.length);
      edgeGeometry.dispose();
    }
    const wire=drawnWire(lineGeometry(lines));part.group.add(wire);part.wires.push(wire);
    return mesh;
  }
  return {root,parts,createPart,add};
}
