import * as THREE from './vendor/three.module.js';
import {FlowChannel} from './flow-channel.js';

// The downstream display follows the same measured bore and elbow route as
// the shells. The half-volume is exposed only behind their shared section.
export function createThroughWater({end,route=null,radius,boreRadius=.3895,ballRadius,section,baseMaterial}){
  const fluid=new FlowChannel({end,radius,boreRadius,route}),root=new THREE.Group();root.name='through-water';root.visible=false;
  const levels=new Float32Array(fluid.cells),texture=new THREE.DataTexture(levels,fluid.cells,1,THREE.RedFormat,THREE.FloatType);texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;
  const uniforms={uFlowLevels:{value:texture},uFlowLength:{value:end},uFlowCells:{value:fluid.cells},uFlowRadius:{value:radius},uFlowBore:{value:boreRadius},uFlowBall:{value:ballRadius},uFlowAngle:{value:Math.PI/2},uFlowTime:{value:0},uFlowFeeding:{value:0},uSectionX:section.uSectionX};
  const positions=[],kinds=[],normals=[];
  const start=-ballRadius-.001,count=Math.ceil((end-start)/.03),xs=Array.from({length:count+1},(_,i)=>start+(end-start)*i/count);
  function quad(a,b,c,d,kind){for(const p of [a,b,c,a,c,d]){positions.push(...p);kinds.push(kind);if(kind===0){const r=Math.hypot(p[1],p[2]);normals.push(0,p[1]/r,p[2]/r);}else normals.push(...(kind===1?[0,0,1]:[0,1,0]));}}
  const point=(x,t)=>{const r=fluid.radiusAt(x);return [x,r*Math.cos(t),-r*Math.sin(t)];};
  for(let i=1;i<xs.length;i++){
    const a=xs[i-1],b=xs[i],ra=fluid.radiusAt(a),rb=fluid.radiusAt(b);
    for(let j=0;j<24;j++){const y=-1+2*j/24,z=-1+2*(j+1)/24;quad([a,ra*y,0],[b,rb*y,0],[b,rb*z,0],[a,ra*z,0],1);}
    for(let j=0;j<48;j++)quad(point(a,Math.PI*j/48),point(b,Math.PI*j/48),point(b,Math.PI*(j+1)/48),point(a,Math.PI*(j+1)/48),0);
    for(let j=0;j<8;j++)quad([a,0,-j/8],[b,0,-j/8],[b,0,-(j+1)/8],[a,0,-(j+1)/8],2);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('flowKind',new THREE.Float32BufferAttribute(kinds,1));geometry.computeBoundingBox();
  const sampling=`uniform sampler2D uFlowLevels;uniform float uFlowLength,uFlowCells,uFlowRadius,uFlowBore;
float flowRadius(float x){return mix(uFlowBore,uFlowRadius,clamp((abs(x)-.51)/.02,0.0,1.0));}
float flowHeight(float x){float cell=clamp(x/uFlowLength*uFlowCells-.5,0.0,uFlowCells-1.0),a=floor(cell);float l=texture2D(uFlowLevels,vec2((a+.5)/uFlowCells,.5)).r;float r=texture2D(uFlowLevels,vec2((min(a+1.0,uFlowCells-1.0)+.5)/uFlowCells,.5)).r;return flowRadius(x)*mix(l,r,fract(cell));}`;
  const bend=route?`float flowBend(float x){return clamp((x-(${route.start.toFixed(9)})-${route.straight.toFixed(9)})/${route.radius.toFixed(9)},0.0,1.570796327);}
vec3 flowWorld(vec3 p){float d=p.x-(${route.start.toFixed(9)}),s=${route.straight.toFixed(9)},r=${route.radius.toFixed(9)};float a=flowBend(p.x);vec3 result=p;if(d>s){vec2 c=vec2((${route.start.toFixed(9)})+s+r*sin(a),r*(cos(a)-1.0)-max(0.0,d-s-r*1.570796327));result=vec3(c+vec2(sin(a),cos(a))*p.y,p.z);}return result;}
vec3 flowNormal(vec3 n,float x){float a=flowBend(x);return vec3(cos(a)*n.x+sin(a)*n.y,-sin(a)*n.x+cos(a)*n.y,n.z);}`:'vec3 flowWorld(vec3 p){return p;}vec3 flowNormal(vec3 n,float x){return n;}';
  const material=baseMaterial.clone();material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=sampling+'\n'+bend+'\nattribute float flowKind;varying vec3 vFlowPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nif(flowKind>1.5){float dx=uFlowLength/uFlowCells;float slope=(flowHeight(position.x+dx)-flowHeight(position.x-dx))/(2.0*dx);objectNormal=normalize(vec3(-slope,1.0,0.0));}objectNormal=flowNormal(objectNormal,position.x);');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nif(flowKind>1.5){transformed.y=flowHeight(position.x);transformed.z*=sqrt(max(0.0,pow(flowRadius(position.x),2.0)-transformed.y*transformed.y));}vFlowPosition=transformed;transformed=flowWorld(transformed);');
    shader.fragmentShader=sampling+'\nuniform float uFlowBall,uFlowAngle,uFlowTime,uFlowFeeding,uSectionX;varying vec3 vFlowPosition;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nfloat flowH=flowHeight(vFlowPosition.x),flowR=flowRadius(vFlowPosition.x);if(vFlowPosition.x>uSectionX||flowH<=-flowR+.00001||vFlowPosition.y>flowH+.0001)discard;if(vFlowPosition.x<0.0&&(uFlowFeeding<.5||length(vFlowPosition)>uFlowBall+.0004))discard;if(length(vFlowPosition)<uFlowBall+.001&&length(vec2(vFlowPosition.y,sin(uFlowAngle)*vFlowPosition.x+cos(uFlowAngle)*vFlowPosition.z))>uFlowBore)discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nfloat wave=sin(vFlowPosition.x*11.0-uFlowTime*5.0)*sin(vFlowPosition.y*9.0+uFlowTime*.6);normal=normalize(normal+vec3(wave*.024,sin(vFlowPosition.x*17.0-uFlowTime*7.0)*.016,0.0));');
  };
  material.customProgramCacheKey=()=> 'through-water-v1:'+JSON.stringify(route&&[route.start,route.radius,route.straight]);
  const mesh=new THREE.Mesh(geometry,material);mesh.name='downstream-liquid';mesh.frustumCulled=false;mesh.renderOrder=6;root.add(mesh);
  let lastReduced=false;
  function update({opening=0,feeding=false,cutaway=0,reduced=false},dt=1/60){
    lastReduced=reduced;
    if(!(cutaway>0)){fluid.reset();uniforms.uFlowTime.value=0;root.visible=false;return false;}
    const moving=fluid.step(dt,{opening,feeding,reduced});
    for(let i=0;i<fluid.cells;i++)levels[i]=fluid.heights[i]/fluid.radii[i];texture.needsUpdate=true;uniforms.uFlowAngle.value=(1-opening)*Math.PI/2;uniforms.uFlowFeeding.value=feeding?1:0;
    root.visible=fluid.volume>0;
    if(root.visible&&!reduced)uniforms.uFlowTime.value+=Math.max(0,Math.min(dt,.05))*2.6;
    return moving;
  }
  const displayPoint=(x,y,z=0)=>{if(!route||x<=route.start)return new THREE.Vector3(x,y,z);const p=route.sample(x-route.start);return new THREE.Vector3(p.x+p.nx*y,p.y+p.ny*y,z);};
  return {root,mesh,fluid,uniforms,texture,update,displayPoint,get animated(){return root.visible&&!lastReduced;}};
}
