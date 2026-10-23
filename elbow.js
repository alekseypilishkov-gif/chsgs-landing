import * as THREE from './vendor/three.module.js';

// Analytic, tangent-continuous route in the longitudinal section plane.
// Lengths describe the presentation layout, not a fabrication specification.
export function elbowPath({side,start,length,radius,straight}){
  const arc=radius*Math.PI/2,drop=length-straight-arc;
  if(![-1,1].includes(side)||![start,length,radius,straight].every(Number.isFinite)||!(radius>0&&straight>=0&&drop>0))throw Error('Invalid elbow route');
  function sample(distance){
    const s=Math.max(0,Math.min(length,distance));
    if(s<=straight)return {x:start+side*s,y:0,nx:0,ny:1};
    if(s<straight+arc){const a=(s-straight)/radius;return {x:start+side*(straight+radius*Math.sin(a)),y:radius*(Math.cos(a)-1),nx:side*Math.sin(a),ny:Math.cos(a)};}
    return {x:start+side*(straight+radius),y:-radius-(s-straight-arc),nx:side,ny:0};
  }
  function project(x,y){
    const q=side*(x-start);
    if(q<=straight)return {distance:q,radial:y};
    const a=Math.max(0,Math.min(Math.PI/2,Math.atan2(q-straight,y+radius)));
    if(y>=-radius)return {distance:straight+radius*a,radial:Math.hypot(q-straight,y+radius)-radius};
    return {distance:straight+arc-radius-y,radial:q-straight-radius};
  }
  return {side,start,length,radius,straight,arc,drop,sample,project};
}

export function sweptTube(path,inner,outer,{step=.045,segments=80}={}){
  if(!(outer>inner&&inner>0&&path.radius>outer))throw Error('Invalid elbow section');
  const count=Math.ceil(path.length/step),positions=[],normals=[],uv=[],indices=[];
  for(const [r,sign] of [[outer,1],[inner,-1]]){
    const base=positions.length/3;
    for(let i=0;i<=count;i++)for(let j=0;j<=segments;j++){
      const s=path.length*i/count,p=path.sample(s),t=2*Math.PI*j/segments,c=Math.cos(t),z=Math.sin(t);
      positions.push(p.x+p.nx*r*c,p.y+p.ny*r*c,r*z);normals.push(sign*p.nx*c,sign*p.ny*c,sign*z);uv.push(s/path.length,j/segments);
    }
    for(let i=0;i<count;i++)for(let j=0;j<segments;j++){
      const a=base+i*(segments+1)+j,b=a+segments+1;
      indices.push(a,b,a+1,b,b+1,a+1);
    }
  }
  // The two annular ends close the wall while preserving an open bore.
  for(const s of [0,path.length]){
    const p=path.sample(s),base=positions.length/3;
    for(const r of [inner,outer])for(let j=0;j<=segments;j++){
      const t=2*Math.PI*j/segments,c=Math.cos(t),z=Math.sin(t),sign=s===0?-1:1;
      positions.push(p.x+p.nx*r*c,p.y+p.ny*r*c,r*z);normals.push(sign*path.side*p.ny,-sign*path.side*p.nx,0);uv.push(r,j/segments);
    }
    for(let j=0;j<segments;j++){const a=base+j,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeBoundingBox();return g;
}

export function elbowGrid(path,radius,step=.18){
  const count=Math.ceil(path.length/step),segments=80,meridians=24,points=[];
  const at=(s,t)=>{const p=path.sample(s);return [p.x+p.nx*radius*Math.cos(t),p.y+p.ny*radius*Math.cos(t),radius*Math.sin(t)];};
  for(let i=0;i<=count;i++)for(let j=0;j<segments;j++)points.push(...at(path.length*i/count,j*Math.PI*2/segments),...at(path.length*i/count,(j+1)*Math.PI*2/segments));
  for(let j=0;j<meridians;j++)for(let i=0;i<count*4;i++)points.push(...at(path.length*i/(count*4),j*Math.PI*2/meridians),...at(path.length*(i+1)/(count*4),j*Math.PI*2/meridians));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('linePosition',new THREE.Float32BufferAttribute(new Float32Array(points.length/3),1));geometry.userData.regularGrid={rings:count+1,ringVertices:segments*2,worldStep:path.length/count};return geometry;
}

// A shared signed distance along the full passage. Equal values lie across
// the local pipe axis, including both bends and their vertical legs.
export function passageField(routes=[]){
  const active=routes.filter(Boolean);
  const coordinate=({x,y})=>{const route=active.find(r=>r.side*(x-r.start)>0);return route?route.start+route.side*route.project(x,y).distance:x;};
  const f=n=>'('+n.toFixed(9)+')';
  const shader='float sectionCoordinate(vec3 p){float result=p.x;'+active.map(r=>`if(${f(r.side)}*(p.x-${f(r.start)})>0.0){float q=${f(r.side)}*(p.x-${f(r.start)}),s=${f(r.straight)},r=${f(r.radius)};float d=q;if(q>s){if(p.y>=-r)d=s+r*clamp(atan(q-s,p.y+r),0.0,1.570796327);else d=s+r*1.570796327-r-p.y;}result=${f(r.start)}+${f(r.side)}*d;}`).join('')+'return result;}';
  return {coordinate,shader,min:Math.min(...active.map(r=>r.start+r.side*r.length)),max:Math.max(...active.map(r=>r.start+r.side*r.length))};
}
