import * as THREE from './vendor/three.module.js';

export async function decodePreparedDisplay(buffer,expected){
  const bytes=new Uint8Array(buffer);
  // Some static hosts serve .gz directly, others apply HTTP Content-Encoding.
  // Fetch already decodes the latter, so only expand an actual gzip payload.
  if(bytes[0]===0x1f&&bytes[1]===0x8b)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return readPreparedDisplay(buffer,expected);
}

// Only transforms and measured bounds; no tessellation, materials or GPU meshes.
// They give the early DWG exactly the same camera fit as the completed product.
export function createDrawingFrame(prepared){
  const root=new THREE.Group(),parts=prepared.manifest.framing.map(part=>{
    const group=new THREE.Group();group.name=part.id;root.add(group);
    const solids=part.solids.map(entry=>{
      const mesh=new THREE.Object3D();mesh.matrix.fromArray(entry.matrix);mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);
      mesh.geometry={boundingBox:new THREE.Box3(new THREE.Vector3(...entry.min),new THREE.Vector3(...entry.max))};group.add(mesh);
      return {mesh,finalDetail:entry.finalDetail,reveal:{value:0},edge:{value:0}};
    });
    return {...part,group,solids,wires:[]};
  });
  return {root,parts};
}

// An export-time cache of expensive edge extraction and section tessellation.
// Edge endpoints refer to existing mesh vertices: CAD/isocurve data is not duplicated.
export function readPreparedDisplay(buffer,{id,source}={}){
  const view=new DataView(buffer);
  if(buffer.byteLength<16||view.getUint32(0,true)!==0x5250444c||view.getUint32(4,true)!==1||view.getUint32(12,true)!==buffer.byteLength)throw Error('Invalid prepared display');
  const size=view.getUint32(8,true),start=16+size;
  if(size%4||start>buffer.byteLength)throw Error('Invalid prepared manifest');
  const manifest=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,16,size)));
  if(manifest.id!==id||manifest.source!==source)throw Error('Prepared display belongs to another CAD product');
  const arrays=new Map();
  for(const [key,a] of Object.entries(manifest.arrays)){
    if(!['f32','u32'].includes(a.type)||!Number.isInteger(a.offset)||a.offset<0||a.offset%4||!Number.isInteger(a.length)||a.length<0||start+a.offset+a.length*4>buffer.byteLength)throw Error('Invalid prepared array '+key);
    arrays.set(key,new (a.type==='f32'?Float32Array:Uint32Array)(buffer,start+a.offset,a.length));
  }
  const used=new Set(),get=key=>{if(!arrays.has(key))throw Error('Missing prepared array '+key);return arrays.get(key);};
  return {
    manifest,used,
    wire(key,geometry,grid){
      const entry=manifest.wires[key];
      if(!entry||entry.vertices!==geometry.attributes.position.count)throw Error('Stale prepared wire '+key);
      const indices=get('edge/'+key),p=geometry.attributes.position.array;
      const iso=entry.iso==='cad'?geometry.userData.grid:entry.iso==='provided'?grid?.attributes.position.array:entry.iso==='edges'?null:get('iso/'+key);
      if(entry.iso!=='edges'&&!iso)throw Error('Missing source isocurves '+key);
      const lines=new Float32Array(indices.length*3+(iso?.length??indices.length*3));
      for(let i=0;i<indices.length;i++){
        const n=indices[i]*3;if(n+2>=p.length)throw Error('Invalid prepared vertex '+key);
        lines[i*3]=p[n];lines[i*3+1]=p[n+1];lines[i*3+2]=p[n+2];
      }
      lines.set(iso||lines.subarray(0,indices.length*3),indices.length*3);used.add('wire/'+key);return lines;
    },
    section(key){
      if(!manifest.sections[key])throw Error('Missing prepared section '+key);
      const geometry=new THREE.BufferGeometry();
      for(const name of ['position','normal'])geometry.setAttribute(name,new THREE.BufferAttribute(get('section/'+key+'/'+name),3));
      geometry.userData.section={...manifest.sections[key]};geometry.computeBoundingBox();used.add('section/'+key);return geometry;
    }
  };
}
