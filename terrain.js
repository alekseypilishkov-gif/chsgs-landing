import * as THREE from './vendor/three.module.js';
import {introAt,sceneDistance} from './terrain-motion.js';

export function flatTerrainGeometry(width,length,columns,rows){
  const positions=[],centres=[],randoms=[];
  const point=(x,z)=>[x,0,z];
  let edgeIndex=0;
  function edge(a,b){
    const r=((Math.sin(++edgeIndex*127.1)*43758.5453)%1+1)%1;
    for(const p of [a,b]){positions.push(...p);centres.push((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);randoms.push(r);}
  }
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const x=-width/2+col*width/columns,z=-length/2+row*length/rows;
    const a=point(x,z),b=point(x+width/columns,z),c=point(x,z+length/rows),d=point(x+width/columns,z+length/rows);
    edge(a,b);edge(a,c);
    if(row===rows-1)edge(c,d);
    if(col===columns-1)edge(b,d);
  }
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  result.setAttribute('centre',new THREE.Float32BufferAttribute(centres,3));
  result.setAttribute('seed',new THREE.Float32BufferAttribute(randoms,1));
  result.setAttribute('strength',new THREE.Float32BufferAttribute(randoms.map(()=>.65),1));
  result.computeBoundingSphere();
  return result;
}
async function factoryGeometry(){
  const [metadataResponse,binaryResponse]=await Promise.all([fetch(new URL('./assets/factory/site-wire.json',import.meta.url)),fetch(new URL('./assets/factory/site-wire.bin',import.meta.url))]);
  if(!metadataResponse.ok||!binaryResponse.ok)throw Error('Factory wire resource unavailable');
  const [meta,buffer]=await Promise.all([metadataResponse.json(),binaryResponse.arrayBuffer()]);
  if(meta.version!==1||!Number.isInteger(meta.gridVertices)||!Number.isInteger(meta.edgeVertices)||meta.gridVertices<=0||meta.edgeVertices<=0||meta.gridVertices%2||meta.edgeVertices%2||buffer.byteLength!==meta.bytes||buffer.byteLength!==(meta.gridVertices+meta.edgeVertices)*12)throw Error('Invalid factory wire asset');
  const positions=new Float32Array(buffer);
  if(!positions.every(Number.isFinite))throw Error('Invalid factory coordinates');
  const centres=new Float32Array(positions.length),seeds=new Float32Array(positions.length/3),strength=new Float32Array(seeds.length);
  for(let vertex=0;vertex<seeds.length;vertex+=2){
    const offset=vertex*3,seed=((Math.sin((vertex+1)*127.1)*43758.5453)%1+1)%1;
    for(let end=0;end<2;end++){
      seeds[vertex+end]=seed;strength[vertex+end]=vertex<meta.gridVertices ? .24 : .55;
      for(let axis=0;axis<3;axis++)centres[offset+end*3+axis]=(positions[offset+axis]+positions[offset+3+axis])/2;
    }
  }
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.BufferAttribute(positions,3));result.setAttribute('centre',new THREE.BufferAttribute(centres,3));result.setAttribute('seed',new THREE.BufferAttribute(seeds,1));result.setAttribute('strength',new THREE.BufferAttribute(strength,1));result.computeBoundingSphere();
  return result;
}
export async function createTerrain(scene){
  const factory=await factoryGeometry();
  const uniforms={uEdge:{value:0},uElevation:{value:0},uFloat:{value:1},uFocus:{value:1},uTime:{value:0},uCamera:{value:new THREE.Vector3()},uAccent:{value:new THREE.Color('#ffec00')},uLine:{value:new THREE.Color('#c9ccd4')}};
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms,
    vertexShader:`
      attribute vec3 centre;
      attribute float seed,strength;
      uniform float uEdge,uElevation,uFloat,uFocus,uTime;
      uniform vec3 uCamera;
      varying float vAlpha,vHighlight;
      void main(){
        float scale=max(.03,smoothstep(0.,1.,(uEdge-seed*.5)*2.));
        vec3 p=centre+(position-centre)*scale;
        p.y*=uElevation;
        p.y+=uFloat*(.5+.5*sin(seed*6.283+uTime*.1))*.8;
        vec4 world=modelMatrix*vec4(p,1.);
        float distanceToCamera=length(world.xyz-uCamera);
        float border=1.-smoothstep(7.5,10.,abs(position.x));
        vAlpha=border*(1.-smoothstep(15.,39.,distanceToCamera));
        vAlpha*=mix(.7,1.,seed)*strength;
        vHighlight=(1.-smoothstep(.15,1.4,length(world.xyz-vec3(.3,0.,-5.2))))*uFocus;
        vAlpha*=max(uEdge*.55,vHighlight);
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader:`
      uniform vec3 uAccent,uLine;
      varying float vAlpha,vHighlight;
      void main(){
        gl_FragColor=vec4(mix(uLine,uAccent,vHighlight),vAlpha*.24+vHighlight*.65);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ground=flatTerrainGeometry(20,20,90,90),bridge=flatTerrainGeometry(20,40,90,180);
  const patches=[];
  for(let index=0;index<4;index++){
    const mesh=new THREE.LineSegments(ground,material);mesh.position.z=index*sceneDistance;scene.add(mesh);patches.push(mesh);
    if(index<3){const connector=new THREE.LineSegments(bridge,material);connector.position.z=index*sceneDistance+30;scene.add(connector);patches.push(connector);}
  }
  const factoryMesh=new THREE.LineSegments(factory,material);factoryMesh.name='factory-buildings-cranes-logos';scene.add(factoryMesh);patches.push(factoryMesh);
  return {
    update(seconds,camera,reduced){
      const intro=introAt(seconds,reduced);
      uniforms.uEdge.value=intro.edge;uniforms.uElevation.value=intro.elevation;uniforms.uFloat.value=intro.float;uniforms.uFocus.value=intro.focus;uniforms.uTime.value=seconds;uniforms.uCamera.value.copy(camera.position);
      for(const mesh of patches)mesh.visible=Math.abs(mesh.position.z-camera.position.z)<55;
    },
    dispose(){ground.dispose();bridge.dispose();factory.dispose();material.dispose();for(const mesh of patches)scene.remove(mesh);},
  };
}
