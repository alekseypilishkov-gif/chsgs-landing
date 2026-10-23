import * as THREE from './vendor/three.module.js';
import {PipeFluid} from './pipe-fluid.js';
import {createThroughWater} from './through-water.js';

// Sectioned fluid volume, outside the valve's exploded-part inventory.
export function createInletWater({start,radius,ballRadius,contactGap=.001,section=null,route=null,outlet=null}){
  if(!Number.isFinite(start)||!(radius>0&&ballRadius>radius)||!(contactGap>0))throw Error('Invalid water passage');
  const contact=r=>-Math.sqrt(ballRadius**2-r*r)-contactGap,end=contact(radius);
  if(start>=contact(0))throw Error('Water inlet must precede the closed ball');
  const fluid=new PipeFluid({start,end,radius,ballRadius}),root=new THREE.Group();root.name='inlet-water';root.visible=false;
  const levels=new Float32Array(fluid.cells);levels.fill(-radius);
  const texture=new THREE.DataTexture(levels,fluid.cells,1,THREE.RedFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  const uniforms={uLevels:{value:texture},uStart:{value:start},uLength:{value:end-start},uCells:{value:fluid.cells},uRadius:{value:radius},uBallRadius:{value:ballRadius},uPhase:{value:0},uFront:{value:start},uSectionX:section?.uSectionX||{value:1e6}};
  const positions=[],sections=[];
  function quad(a,b,c,d,section){for(const v of [a,b,c,a,c,d]){positions.push(...v);sections.push(section);}}
  const steps=64,axial=route?128:1,point=(x,r,t)=>[x,r*Math.cos(t),-r*Math.sin(t)];
  for(let j=0;j<steps;j++){
    const a=-radius+2*radius*j/steps,b=-radius+2*radius*(j+1)/steps;
    for(let k=0;k<axial;k++){
      const x=(y,t)=>start+(contact(Math.abs(y))-start)*t;
      quad([x(a,k/axial),a,0],[x(a,(k+1)/axial),a,0],[x(b,(k+1)/axial),b,0],[x(b,k/axial),b,0],1);
    }
  }
  for(let j=0;j<steps;j++){
    const a=Math.PI*j/steps,b=Math.PI*(j+1)/steps;
    for(let k=0;k<axial;k++){const x=start+(end-start)*k/axial,y=start+(end-start)*(k+1)/axial;quad(point(x,radius,a),point(y,radius,a),point(y,radius,b),point(x,radius,b),0);}
    for(let k=0;k<16;k++){
      const r=radius*k/16,s=radius*(k+1)/16;
      quad(point(contact(r),r,a),point(contact(s),s,a),point(contact(s),s,b),point(contact(r),r,b),0);
      quad(point(start,r,a),point(start,s,a),point(start,s,b),point(start,r,b),0);
    }
  }
  function geometryOf(p,s){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('waterSection',new THREE.Float32BufferAttribute(s,1));g.computeVertexNormals();g.computeBoundingBox();return g;}
  const sampling=`uniform sampler2D uLevels;uniform float uStart,uLength,uCells,uRadius;
float waterHeight(float x){
  float cell=clamp((x-uStart)/uLength*uCells-.5,0.0,uCells-1.0),a=floor(cell);
  float l=texture2D(uLevels,vec2((a+.5)/uCells,.5)).r;
  float r=texture2D(uLevels,vec2((min(a+1.0,uCells-1.0)+.5)/uCells,.5)).r;
  return mix(l,r,fract(cell));
}`;
  // Fluid coordinates retain distance along the passage. Only the display
  // frame bends; the same conservative inlet solver and section front apply.
  const bend=route?`float waterBend(float x){return clamp((${route.start.toFixed(9)}-x-${route.straight.toFixed(9)})/${route.radius.toFixed(9)},0.0,1.570796327);}
vec3 waterWorld(vec3 p){float d=${route.start.toFixed(9)}-p.x,s=${route.straight.toFixed(9)},r=${route.radius.toFixed(9)},arc=r*1.570796327;if(d<=s)return p;float a=waterBend(p.x);vec2 c=vec2(${route.start.toFixed(9)}-s-r*sin(a),r*(cos(a)-1.0)-max(0.0,d-s-arc));return vec3(c+vec2(-sin(a),cos(a))*p.y,p.z);}
vec3 waterNormal(vec3 n,vec3 p){float a=waterBend(p.x);return vec3(cos(a)*n.x-sin(a)*n.y,sin(a)*n.x+cos(a)*n.y,n.z);}`:'vec3 waterWorld(vec3 p){return p;}vec3 waterNormal(vec3 n,vec3 p){return n;}';
  // Three's physical transmission pass refracts the actual steel behind the
  // liquid. No flat blue overlay or second hand-authored reflection image.
  const material=new THREE.MeshPhysicalMaterial({color:0xd5f5fb,metalness:0,roughness:.045,transmission:.94,thickness:.38,ior:1.333,attenuationColor:0x7fc7d7,attenuationDistance:1.8,clearcoat:.65,clearcoatRoughness:.1,envMapIntensity:.8,opacity:.78,transparent:true,side:THREE.DoubleSide,depthWrite:false});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=sampling+'\n'+bend+'\nattribute float waterSection;varying vec3 vWaterPosition;varying vec3 vWaterWorld;varying float vWaterSection;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nif(waterSection>1.5){float dx=uLength/uCells;float slope=(waterHeight(position.x+dx)-waterHeight(position.x-dx))/(2.0*dx);objectNormal=normalize(vec3(-slope,1.0,0.0));}objectNormal=waterNormal(objectNormal,position);');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nif(waterSection>1.5){transformed.y=waterHeight(position.x);transformed.z*=sqrt(max(0.0,uRadius*uRadius-transformed.y*transformed.y));}vWaterPosition=transformed;transformed=waterWorld(transformed);vWaterWorld=(modelMatrix*vec4(transformed,1.0)).xyz;vWaterSection=waterSection;');
    shader.fragmentShader=sampling+'\nuniform float uBallRadius,uPhase,uSectionX;varying vec3 vWaterPosition;varying vec3 vWaterWorld;varying float vWaterSection;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nfloat height=waterHeight(vWaterPosition.x);if(vWaterPosition.x>uSectionX||height<-uRadius+.00001||vWaterPosition.y>height+.0002||length(vWaterPosition)<uBallRadius+.0004)discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nfloat ripple=sin(vWaterPosition.x*5.2+vWaterPosition.y*9.0-uPhase)*sin(vWaterPosition.x*9.0-vWaterPosition.y*4.0+uPhase*.7);normal=normalize(normal+vec3(ripple*.018,sin(vWaterPosition.x*7.0-uPhase)*.012,0.0));');
  };
  material.customProgramCacheKey=()=> 'inlet-water-physical-v2:'+JSON.stringify(route&&[route.start,route.radius,route.straight]);
  const volume=new THREE.Mesh(geometryOf(positions,sections),material);volume.name='water-inlet-volume';volume.renderOrder=5;volume.frustumCulled=false;root.add(volume);
  const surfacePositions=[],surfaceSections=[];
  const xs=[start,...Array.from({length:fluid.cells},(_,i)=>start+(i+.5)*fluid.dx),end];
  for(let i=1;i<xs.length;i++)for(let j=0;j<8;j++){
    const a=xs[i-1],b=xs[i],z=-j/8,w=-(j+1)/8;
    for(const v of [[a,0,z],[b,0,z],[b,0,w],[a,0,z],[b,0,w],[a,0,w]]){surfacePositions.push(...v);surfaceSections.push(2);}
  }
  const surface=new THREE.Mesh(geometryOf(surfacePositions,surfaceSections),material);surface.name='water-free-surface';surface.frustumCulled=false;surface.renderOrder=6;root.add(surface);
  const through=outlet?createThroughWater({...outlet,radius,ballRadius,section,baseMaterial:material}):null;if(through)root.add(through.root);
  let lastReduced=false,latched=false,wasActive=false,opticalTime=0;
  function update(state,dt=1/60){
    // Reversing into the section retains the liquid. Clear only once the
    // opaque shells have fully hidden the passage, before the next replay.
    if(!(state.cutaway>0))latched=false;else if(state.waterFill)latched=true;
    const fill=latched?1:0;lastReduced=state.reduced;
    if(!fill&&wasActive)opticalTime=0;wasActive=!!fill;
    fluid.setFill(fill,state.reduced);const moving=fluid.step(dt);
    root.visible=fluid.volume>0&&state.cutaway>0;surface.visible=fluid.ratio>0&&fluid.ratio<1-1e-7;
    if(root.visible&&!state.reduced)opticalTime+=Math.max(0,Math.min(dt,.05));
    levels.set(fluid.heights);texture.needsUpdate=true;uniforms.uFront.value=fluid.front;uniforms.uPhase.value=opticalTime*1.2;
    // Scroll chooses the actuator's goal; the actual aperture sets discharge
    // throughout both opening and closing. Retain supply while it narrows.
    const opening=state.valveOpening||0;
    const downstreamMoving=through?.update({opening,feeding:opening>0&&fluid.ratio>=1-1e-7,cutaway:state.cutaway,reduced:state.reduced},dt)||false;
    return moving||downstreamMoving;
  }
  const displayPoint=(x,y,z=0)=>{if(!route||x>=route.start)return new THREE.Vector3(x,y,z);const p=route.sample(route.start-x);return new THREE.Vector3(p.x+p.nx*y,p.y+p.ny*y,z);};
  return {root,volume,surface,fluid,through,uniforms,texture,start,end,radius,ballRadius,route,displayPoint,update,get animated(){return root.visible&&!lastReduced;}};
}
