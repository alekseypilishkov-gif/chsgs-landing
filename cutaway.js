import * as THREE from './vendor/three.module.js';
import {passageField} from './elbow.js';

// Intersect the displayed surfaces with the longitudinal XY plane once.
// Scanline trapezoids retain hollow channels without requiring closed CAD
// face loops: the supplied STEP has open interfaces between display parts.
export function sectionCapGeometry(meshes,{tolerance=.001,boreRadius=0}={}){
  const segments=new Map(),point=new THREE.Vector3(),epsilon=1e-7;
  const key=p=>p.map(v=>Math.round(v/1e-5)).join(',');
  for(const mesh of meshes){
    mesh.updateMatrix();const geometry=mesh.geometry,p=geometry.attributes.position,index=geometry.index;
    const vertex=i=>{point.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrix);return [point.x,point.y,point.z];};
    for(let i=0;i<(index?index.count:p.count);i+=3){
      const triangle=[vertex(i),vertex(i+1),vertex(i+2)];if(triangle.every(p=>Math.abs(p[2])<epsilon))continue;
      const hits=new Map();
      for(let j=0;j<3;j++){
        const a=triangle[j],b=triangle[(j+1)%3];
        if(Math.abs(a[2])<epsilon)hits.set(key(a.slice(0,2)),a.slice(0,2));
        if((a[2]>epsilon&&b[2]<-epsilon)||(a[2]<-epsilon&&b[2]>epsilon)){
          const t=-a[2]/(b[2]-a[2]),p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];hits.set(key(p),p);
        }
      }
      if(hits.size===2){const [a,b]=[...hits.values()],id=[key(a),key(b)].sort().join('|');segments.set(id,[a,b]);}
    }
  }
  const edges=[...segments.values()].filter(([a,b])=>Math.abs(a[0]-b[0])>1e-7);
  const raw=[...new Set(edges.flatMap(edge=>edge.map(p=>p[0])))].sort((a,b)=>a-b),xs=[];
  for(const x of raw)if(!xs.length||x-xs.at(-1)>1e-5)xs.push(x);
  const vertices=[];let area=0,oddSlabs=0;
  function emit(polygon){
    for(let i=1;i<polygon.length-1;i++){
      const [a,b,c]=[polygon[0],polygon[i],polygon[i+1]],size=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
      if(size<1e-12)continue;vertices.push(...a,0,...b,0,...c,0);area+=size;
    }
  }
  function boreClip(polygon,sign){
    const output=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*a[1]-boreRadius,db=sign*b[1]-boreRadius;
      if(da>=0)output.push(a);
      if((da>=0)!==(db>=0)){const t=da/(da-db);output.push([a[0]+(b[0]-a[0])*t,sign*boreRadius]);}
    }
    return output;
  }
  const yAt=(edge,x)=>edge[0][1]+(edge[1][1]-edge[0][1])*(x-edge[0][0])/(edge[1][0]-edge[0][0]);
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],mid=(a+b)/2;
    const crossings=edges.filter(e=>mid>Math.min(e[0][0],e[1][0])&&mid<Math.max(e[0][0],e[1][0])).map(edge=>({edge,y:yAt(edge,mid)})).sort((a,b)=>a.y-b.y);
    const groups=[];for(const hit of crossings){const last=groups.at(-1);if(last&&hit.y-last.at(-1).y<tolerance)last.push(hit);else groups.push([hit]);}
    const lines=groups.map(group=>group[Math.floor(group.length/2)]);
    if(lines.length%2)oddSlabs++;
    for(let j=1;j<lines.length;j+=2){
      const lo=lines[j-1].edge,hi=lines[j].edge;
      const al=Math.min(yAt(lo,a),yAt(hi,a)),ah=Math.max(yAt(lo,a),yAt(hi,a)),bl=Math.min(yAt(lo,b),yAt(hi,b)),bh=Math.max(yAt(lo,b),yAt(hi,b));
      if((ah-al+bh-bl)/2<1e-6)continue;
      const polygon=[[a,al],[b,bl],[b,bh],[a,ah]];
      if(boreRadius){emit(boreClip(polygon,1));emit(boreClip(polygon,-1));}else emit(polygon);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();geometry.computeBoundingBox();
  geometry.userData.section={segments:segments.size,slabs:Math.max(0,xs.length-1),oddSlabs,area};return geometry;
}

export function bindSection(material,uniforms,{cap=false,liner=false,interior=false,innerFinish=false,boreRadius=0,field='float sectionCoordinate(vec3 p){return p.x;}'}={}){
  const previous=material.onBeforeCompile,cacheKey=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='varying vec3 vSectionPosition;varying float vSectionInner;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec4 sectionVertex=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nsectionVertex=instanceMatrix*sectionVertex;\n#endif\nvSectionPosition=(modelMatrix*sectionVertex).xyz;vSectionInner=step(.2,-dot(normalize(normal),normalize(vec3(0.0,position.y,position.z)+vec3(0.0,.000001,0.0))));');
    let clip='float sectionPosition=sectionCoordinate(vSectionPosition);';
    clip+=cap?'if(uSectionEnabled<.5||sectionPosition>uSectionX)discard;':liner?'if(uSectionEnabled<.5||sectionPosition>uSectionX||vSectionPosition.z>.00001)discard;':'if(uSectionEnabled>.5&&sectionPosition<uSectionX&&vSectionPosition.z>.00001)discard;';
    if(interior)clip+='if(uSectionEnabled<.5||sectionPosition>uSectionX||vSectionInner<.5)discard;';
    if(innerFinish)clip+='if(uSectionEnabled>.5&&sectionPosition<uSectionX&&vSectionInner>.5)discard;';
    // In section only, replace overlapping source inlet patches and internal
    // annular end faces with one continuous bore. External faces stay intact.
    if(boreRadius)clip+='if(uSectionEnabled>.5&&sectionPosition<uSectionX&&length(vSectionPosition.yz)<'+(boreRadius+.045).toFixed(6)+')discard;';
    shader.fragmentShader=field+'\nvarying vec3 vSectionPosition;varying float vSectionInner;uniform float uSectionEnabled;uniform float uSectionX;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n'+clip);
  };
  material.customProgramCacheKey=()=>cacheKey()+':longitudinal-cut-v5:'+Number(cap)+Number(liner)+Number(interior)+Number(innerFinish)+':'+boreRadius+':'+field;material.needsUpdate=true;
}

// Join the section faces in assembled space. Small open export interfaces
// must not leave pinholes in the displayed wall; the actual bore stays empty.
function continuousSectionGeometry(entries,parent,{radius:boreRadius,innerEnd,outerEnd=Infinity},maxGap=.025){
  const triangles=[],xs=[-innerEnd,innerEnd];
  for(const entry of entries){
    entry.cap.updateWorldMatrix(true,false);const p=entry.cap.geometry.attributes.position;
    for(let i=0;i<p.count;i+=3){const t=[];for(let k=0;k<3;k++){const v=new THREE.Vector3().fromBufferAttribute(p,i+k).applyMatrix4(entry.cap.matrixWorld);t.push([v.x,v.y]);xs.push(v.x);}triangles.push(t);}
  }
  xs.sort((a,b)=>a-b);const stops=[];for(const x of xs)if(!stops.length||x-stops.at(-1)>1e-6)stops.push(x);
  function slice(t,x){
    const ys=[];for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3];if(x<Math.min(a[0],b[0])-1e-7||x>Math.max(a[0],b[0])+1e-7)continue;
      if(Math.abs(a[0]-b[0])<1e-8){if(Math.abs(x-a[0])<1e-7)ys.push(a[1],b[1]);}
      else{const f=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));ys.push(a[1]+(b[1]-a[1])*f);}}
    return ys.length?[Math.min(...ys),Math.max(...ys)]:null;
  }
  const slabs=[];
  for(let i=1;i<stops.length;i++){
    const a=stops[i-1],b=stops[i],mid=(a+b)/2,ranges=[];
    for(const t of triangles){const m=slice(t,mid);if(!m||m[1]-m[0]<1e-8)continue;const l=slice(t,a),r=slice(t,b);if(l&&r)ranges.push({lo:m[0],hi:m[1],al:l[0],ah:l[1],bl:r[0],bh:r[1]});}
    ranges.sort((a,b)=>a.lo-b.lo);const merged=[];
    for(const range of ranges){const last=merged.at(-1);if(last&&range.lo<=last.hi+.001){last.hi=Math.max(last.hi,range.hi);last.al=Math.min(last.al,range.al);last.ah=Math.max(last.ah,range.ah);last.bl=Math.min(last.bl,range.bl);last.bh=Math.max(last.bh,range.bh);}else merged.push({...range});}
    slabs.push({a,b,ranges:merged});
  }
  const primary=(slab,sign)=>slab.ranges.filter(r=>sign>0?r.lo>0:r.hi<0).sort((a,b)=>sign>0?a.lo-b.lo:b.hi-a.hi)[0];let bridged=0;
  for(const sign of [-1,1])for(let i=0;i<slabs.length;i++){
    if(primary(slabs[i],sign))continue;const start=i;while(i<slabs.length&&!primary(slabs[i],sign))i++;const end=i-1;
    if(!start||i>=slabs.length||slabs[end].b-slabs[start].a>maxGap)continue;
    const left=primary(slabs[start-1],sign),right=primary(slabs[i],sign);if(!left||!right)continue;
    const from=slabs[start].a,to=slabs[end].b,at=x=>{const f=(x-from)/(to-from);return [left.bl+(right.al-left.bl)*f,left.bh+(right.ah-left.bh)*f];};
    for(let j=start;j<=end;j++){const s=slabs[j],[al,ah]=at(s.a),[bl,bh]=at(s.b);s.ranges.push({al,ah,bl,bh,lo:(al+bl)/2,hi:(ah+bh)/2});}bridged++;
  }
  const vertices=[];
  for(const slab of slabs){
    // The inlet sleeve extends inside the body. Unite its section with the
    // surrounding weld/body wall, including the small radial export voids.
    // Starting at the measured sleeve end preserves the central body cavity.
    if((slab.b<=-innerEnd+1e-6||slab.a>=innerEnd-1e-6)&&slab.a>=-outerEnd-1e-6&&slab.b<=outerEnd+1e-6){
      const wall=[];
      for(const sign of [-1,1]){
        const ranges=slab.ranges.filter(r=>sign>0?r.lo>0:r.hi<0);if(!ranges.length)continue;
        wall.push(sign>0?{al:boreRadius,bl:boreRadius,ah:Math.max(...ranges.map(r=>r.ah)),bh:Math.max(...ranges.map(r=>r.bh))}:{al:Math.min(...ranges.map(r=>r.al)),bl:Math.min(...ranges.map(r=>r.bl)),ah:-boreRadius,bh:-boreRadius});
      }
      slab.ranges=wall;
    }
    for(const r of slab.ranges)vertices.push(slab.a,r.al,0,slab.b,r.bl,0,slab.b,r.bh,0,slab.a,r.al,0,slab.b,r.bh,0,slab.a,r.ah,0);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));parent.updateWorldMatrix(true,false);geometry.applyMatrix4(parent.matrixWorld.clone().invert());geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.userData.section={continuous:true,sourceCaps:entries.length,slabs:slabs.length,bridged};return geometry;
}

export function createCutaway(groups,{bore=null,interiorFinish=null,connections=[],routes=[],prepared=null}={}){
  const passage=passageField(routes),field=passage.shader;
  const uniforms={uSectionEnabled:{value:0},uSectionX:{value:0}},bounds=new THREE.Box3(),entries=[],interiors=[],offsets=new Map();
  for(const group of groups){
    group.parent.updateWorldMatrix(true,true);
    for(const mesh of group.meshes){
      mesh.geometry.computeBoundingBox();bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        offsets.set(material,material.polygonOffset);bindSection(material,uniforms,{innerFinish:group.innerFinish,boreRadius:group.pipeBore?bore?.radius:0,field});
      }
      if(group.innerFinish){
        if(!interiorFinish)throw Error('Section interior finish is required');
        const {reflectionEnvironment,...settings}=interiorFinish,material=new THREE.MeshStandardMaterial({...settings,side:THREE.DoubleSide});
        material.userData.reflectionEnvironment=reflectionEnvironment;bindSection(material,uniforms,{interior:true,field});
        // A finish layer on the existing inward CAD faces, never a lid over
        // the ball bore. Its reflection studio leaves the blue exterior alone.
        const layer=new THREE.Mesh(mesh.geometry,material);layer.name=group.id+'-section-interior';layer.matrix.copy(mesh.matrix);layer.matrixAutoUpdate=false;layer.visible=false;layer.renderOrder=1;group.parent.add(layer);interiors.push(layer);
      }
    }
    const geometry=prepared?.section?prepared.section(group.id):sectionCapGeometry(group.meshes,{boreRadius:group.pipeBore?bore?.radius:0}),material=new THREE.MeshStandardMaterial({color:0xb7bdc5,metalness:.65,roughness:.34,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    bindSection(material,uniforms,{cap:true,field});const cap=new THREE.Mesh(geometry,material);cap.name=group.id+'-section-face';cap.renderOrder=3;cap.visible=false;group.parent.add(cap);
    entries.push({id:group.id,cap,stats:geometry.userData.section});
  }
  let cap=null;
  if(bore){const geometry=prepared?.section?prepared.section('continuous'):continuousSectionGeometry(entries,bore.parent,bore);cap=new THREE.Mesh(geometry,entries[0].cap.material);cap.name='continuous-longitudinal-section';cap.visible=false;cap.renderOrder=3;for(const entry of entries)entry.cap.removeFromParent();bore.parent.add(cap);}
  const liners=[];
  if(bore)for(const [a,b] of [[Math.max(bounds.min.x,-(bore.outerEnd??Infinity)),-bore.innerEnd],[bore.innerEnd,Math.min(bounds.max.x,bore.outerEnd??Infinity)]]){
    const geometry=new THREE.CylinderGeometry(bore.radius,bore.radius,b-a,96,1,true);geometry.rotateZ(Math.PI/2);geometry.translate((a+b)/2,0,0);
    const material=new THREE.MeshStandardMaterial({...bore.material,side:THREE.DoubleSide});bindSection(material,uniforms,{liner:true,field});
    const mesh=new THREE.Mesh(geometry,material);mesh.name='section-continuous-bore';mesh.visible=false;bore.parent.add(mesh);liners.push(mesh);
  }
  const seams=[];
  if(bore)for(const joint of connections){
    const material=new THREE.MeshBasicMaterial({color:0x242a32});bindSection(material,uniforms,{cap:true,field});
    const radius=bore.radius-.0015,arc=Array.from({length:49},(_,i)=>{const t=Math.PI*i/48;return new THREE.Vector3(joint.x,radius*Math.cos(t),-radius*Math.sin(t));});
    const paths=[arc,...[-1,1].map(side=>[new THREE.Vector3(joint.x,side*bore.radius,.001),new THREE.Vector3(joint.x,side*joint.outerRadius,.001)])];
    for(const path of paths){const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),64,.0018,6,false),material);mesh.name='section-flange-interface';mesh.visible=false;mesh.renderOrder=4;bore.parent.add(mesh);seams.push(mesh);}
  }
  const min=Math.min(bounds.min.x,passage.min)-.01,max=Math.max(bounds.max.x,passage.max)+.01,focus=Math.min(1.1,(max-min)/4);
  function update(state){
    const p=state.cutaway||0;uniforms.uSectionEnabled.value=p>0?1:0;
    // Edge-on CAD faces have an extreme depth slope. Their assembly bias can
    // otherwise pull hidden flange faces through the section's bore surface.
    for(const [material,original] of offsets)material.polygonOffset=p>0?false:original;
    // Spend most of the scroll on the valve; the long outer pipes cut faster.
    const path=[[0,min],[.18,-focus],[.82,focus],[1,max]];let i=1;while(i<path.length-1&&p>path[i][0])i++;
    const [a,x]=path[i-1],[b,y]=path[i],t=Math.max(0,Math.min(1,(p-a)/(b-a)));uniforms.uSectionX.value=x+(y-x)*t;
    if(cap)cap.visible=p>0;else for(const entry of entries)entry.cap.visible=p>0;
    for(const liner of liners)liner.visible=p>0;
    for(const interior of interiors)interior.visible=p>0;
    for(const seam of seams)seam.visible=p>0;
  }
  return {cap,entries,liners,interiors,seams,uniforms,bounds,passage,update};
}
