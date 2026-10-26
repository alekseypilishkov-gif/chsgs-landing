import * as THREE from './vendor/three.module.js';
import {ambientAt} from './hero-motion.js';
export function createAmbientParticles(scene){
  const seed=Math.random()*1000,positions=new Float32Array(9),alpha=new Float32Array(3),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1));
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,uniforms:{uColor:{value:new THREE.Color('#ffec00')},uShift:{value:new THREE.Vector2()},uStrength:{value:1},uSize:{value:2}},vertexShader:`
    attribute float alpha;uniform vec2 uShift;uniform float uSize;varying float vAlpha;
    void main(){gl_Position=vec4(position.xy+uShift,.999,1.);gl_PointSize=uSize;vAlpha=alpha;}
  `,fragmentShader:`
    uniform vec3 uColor;uniform float uStrength;varying float vAlpha;
    void main(){float radius=length(gl_PointCoord-.5);if(radius>.5)discard;gl_FragColor=vec4(uColor,vAlpha*uStrength*(1.-smoothstep(.1,.5,radius)));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  const core=new THREE.Points(geometry,material),halos=['#ff315f','#42baff'].map(color=>{const fringe=material.clone();fringe.uniforms={...material.uniforms,uColor:{value:new THREE.Color(color)},uShift:{value:new THREE.Vector2()},uStrength:{value:.55}};return new THREE.Points(geometry,fringe);});
  const group=new THREE.Group();group.add(...halos,core);for(const points of group.children){points.frustumCulled=false;points.renderOrder=-1;}scene.add(group);
  return {
    resize(width,height){material.uniforms.uSize.value=2*Math.min(devicePixelRatio,1.75);halos.forEach((points,i)=>points.material.uniforms.uShift.value.set((i?-.9:.9)*2/width,(i?-.15:.15)*2/height));},
    update(seconds,reduced){const particles=reduced?[]:ambientAt(seconds,seed);group.visible=particles.length>0;geometry.setDrawRange(0,particles.length);particles.forEach((p,i)=>{positions[i*3]=p.x;positions[i*3+1]=p.y;alpha[i]=p.alpha;});geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;},
    dispose(){geometry.dispose();material.dispose();for(const points of halos)points.material.dispose();scene.remove(group);},
  };
}
