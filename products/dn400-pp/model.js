import * as THREE from '../../vendor/three.module.js';
import {createDisplayModel,selectCADFaces,revolved,annulus,waveAnnulus,lineGeometry,drawnWire} from '../../model.js';
import {materials,extractionPaths,reflectionEnvironments,pipelineFinish,flangeConnection} from './settings.js';
import {createPipeline} from '../../pipeline.js';
import {createCutaway} from '../../cutaway.js';
import {createInletWater} from '../../water.js';
import {QuarterTurn,handwheelAngle} from '../../valve-operation.js';
const TAU=Math.PI*2;
function coatedFlange(geometry){
  // Retain the actual machined raised sealing face, X=+/-485mm, as bare steel.
  const p=geometry.attributes.position,index=geometry.index;geometry.clearGroups();
  let start=0,slot=-1;
  for(let i=0;i<index.count;i+=3){
    const next=[0,1,2].every(k=>Math.abs(Math.abs(p.getX(index.getX(i+k)))-.97)<.00001)?1:0;
    if(next!==slot){if(slot>=0)geometry.addGroup(start,i-start,slot);start=i;slot=next;}
  }
  geometry.addGroup(start,index.count-start,slot);return geometry;
}
function wheelGrid(){
  const points=[],center=[-.362,1.019,.888714],major=.57873,minor=.02127;
  const p=(u,v)=>[center[0]+(major+minor*Math.cos(v))*Math.cos(u),center[1]+(major+minor*Math.cos(v))*Math.sin(u),center[2]+minor*Math.sin(v)];
  for(let j=0;j<6;j++)for(let i=0;i<96;i++)points.push(...p(TAU*i/96,TAU*j/6),...p(TAU*(i+1)/96,TAU*j/6));
  for(let j=0;j<24;j++)for(let i=0;i<12;i++)points.push(...p(TAU*j/24,TAU*i/12),...p(TAU*j/24,TAU*(i+1)/12));
  // Source rim and spoke geometry remains intact; these meridians describe
  // the measured toroidal rim without using its triangulation diagonals.
  return lineGeometry(points);
}
function latheGrid(sample,from,to,steps=12,meridians=24){
  const a=[];const point=(x,t)=>[x,Math.cos(t)*sample(x),Math.sin(t)*sample(x)];
  for(let j=0;j<=steps;j++){const x=from+(to-from)*j/steps;for(let k=0;k<80;k++)a.push(...point(x,TAU*k/80),...point(x,TAU*(k+1)/80));}
  for(let j=0;j<meridians;j++){const t=TAU*j/meridians;for(let k=0;k<50;k++){const x=from+(to-from)*k/50,n=from+(to-from)*(k+1)/50;a.push(...point(x,t),...point(n,t));}}
  return lineGeometry(a);
}
export function createProduct(...args){
  const steps=buildProduct(...args);let result;do{result=steps.next();}while(!result.done);return result.value;
}
export async function createProductAsync(cad,installation,cutaway,water,opening,prepared,{signal,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),budget=8}={}){
  const steps=buildProduct(cad,installation,cutaway,water,opening,prepared);
  const preparation={activeMs:0,maxTaskMs:0,tasks:0};
  try{
    while(true){
      await yieldTask();if(signal?.aborted)throw new DOMException('Preparation aborted','AbortError');
      const start=performance.now();let result;
      do{result=steps.next();}while(!result.done&&result.value!=='task'&&performance.now()-start<budget);
      const elapsed=performance.now()-start;preparation.activeMs+=elapsed;preparation.maxTaskMs=Math.max(preparation.maxTaskMs,elapsed);preparation.tasks++;
      if(result.done){result.value.preparation=preparation;return result.value;}
    }
  }finally{steps.return();}
}
function* buildProduct(cad,installationSettings=null,cutawayEnabled=false,waterEnabled=false,openingEnabled=false,prepared=null){
  const {root,parts,createPart,add}=createDisplayModel(materials,extractionPaths,prepared);
  const weldOptions={finalDetail:true,wire:false};
  function splitWelds(part,geometry,ids){
    const welds=new Set(ids);
    add(part,selectCADFaces(geometry,id=>!welds.has(id)),'bluePaint');
    add(part,selectCADFaces(geometry,id=>welds.has(id)),'bluePaint',null,weldOptions);
  }
  function pipePatch(part,side,start,end){const patch=revolved([[side*start,.426],[side*end,.426]]);add(part,patch,'bluePaint');}
  const body=createPart('body',[0,-1.4,.3]);
  splitWelds(body,cad.get('body'),[162,3495,3496]);
  // Close only the hidden weld interfaces removed by the fused source export.
  for(const side of [-1,1]){const cap=revolved([[side*.660547502,.426],[side*.692697885,.45]]);add(body,cap,'bluePaint');}
  yield;
  for(const side of [-1,1]){
    const name=side<0?'left':'right';const flange=createPart(name+'-flange',[side*3.3,0,0]);
    add(flange,coatedFlange(cad.get(name+'-flange')),['bluePaint','steel']);
    const inlet=new THREE.CylinderGeometry(.406,.406,.060,80,1,true);inlet.rotateZ(Math.PI/2);inlet.translate(side*(.882+.030),0,0);add(flange,inlet,'steel');
    const mating=annulus(.406,.44,.001);mating.translate(side*.882,0,0);add(flange,mating,'steel');
    yield;
    const patrubok=createPart(name+'-pipe',[side*2.5,0,0]);splitWelds(patrubok,cad.get(name+'-pipe'),side<0?[3619,3621]:[3497,3499]);
    const start=side<0?-.6927:.523,end=side<0?-.523:.6927;
    const sleeve=new THREE.CylinderGeometry(.426,.426,end-start,80,1,true);sleeve.rotateZ(Math.PI/2);sleeve.translate((start+end)/2,0,0);add(patrubok,sleeve,'bluePaint');
    // Smooth measured pipe beneath the two source weld beads.
    pipePatch(patrubok,side,.692697886,.722697886);pipePatch(patrubok,side,.869037390,.882);
    const insideTube=new THREE.CylinderGeometry(.406,.406,.359,80,1,true);insideTube.rotateZ(Math.PI/2);insideTube.translate(side*(.523+.359/2),0,0);add(patrubok,insideTube,'steel');
    for(const x of [.523,.882]){const lip=annulus(.406,.426,.001);lip.translate(side*x,0,0);add(patrubok,lip,'steel');}
    yield;
  }
  const ball=createPart('ball',[-.85,0,.06],.025);add(ball,cad.get('ball'),'stainless',latheGrid(x=>Math.sqrt(.596**2-x*x),-.40605128,.40605128,10,24));
  // Preserve the source hollow sphere and drive slot, closing only interfaces
  // erased by the factory union. R195 is the measured continuous axial bore.
  const ballRadius=.596,boreRadius=.39,sourceEnd=.40605128,chamfer=.004,mouthRadius=boreRadius+chamfer,mouthX=Math.sqrt(ballRadius**2-mouthRadius**2),boreEnd=mouthX-chamfer;
  const bore=new THREE.CylinderGeometry(boreRadius,boreRadius,boreEnd*2,96,1,true);bore.rotateZ(Math.PI/2);add(ball,bore,'stainless');
  // The fused export truncates the ball shoulders. Continue its spherical
  // profile into the measured bore instead of adding broad flat annular lids.
  for(const side of [-1,1]){
    const from=side<0?-mouthX:sourceEnd,to=side<0?-sourceEnd:mouthX;
    const radius=x=>Math.sqrt(Math.max(0,ballRadius**2-x*x));
    const shoulder=revolved(Array.from({length:17},(_,i)=>{const x=from+(to-from)*i/16;return [x,radius(x)];}));
    const p=shoulder.attributes.position,n=shoulder.attributes.normal;
    for(let i=0;i<p.count;i++)n.setXYZ(i,p.getX(i)/ballRadius,p.getY(i)/ballRadius,p.getZ(i)/ballRadius);
    add(ball,shoulder,'stainless',latheGrid(radius,from,to,2,24));
    const bevel=revolved([[side*mouthX,mouthRadius],[side*boreEnd,boreRadius]]),bp=bevel.attributes.position,bn=bevel.attributes.normal,lines=[];
    for(let i=0;i<bp.count;i++){const r=Math.hypot(bp.getY(i),bp.getZ(i));bn.setXYZ(i,side/Math.SQRT2,-bp.getY(i)/r/Math.SQRT2,-bp.getZ(i)/r/Math.SQRT2);}
    for(let i=0;i<24;i++){const a=TAU*i/24;lines.push(side*mouthX,mouthRadius*Math.cos(a),mouthRadius*Math.sin(a),side*boreEnd,boreRadius*Math.cos(a),boreRadius*Math.sin(a));}
    add(ball,bevel,'stainless',lineGeometry(lines));
  }
  yield;
  const neck=createPart('neck',[-1,.65,.12]);splitWelds(neck,cad.get('neck-tube'),[164]);
  for(const [a,b] of [[.621902,.659974720],[.840494026,.864]]){const tube=revolved([[a,.13],[b,.13]],'y');add(neck,tube,'bluePaint');}
  const adapter=createPart('adapter',[1,.65,-.1]);const adapterGeometry=cad.get('neck-adapter');
  // Paint the plate; leave its bolt heads and machined holes bare steel.
  add(adapter,selectCADFaces(adapterGeometry,id=>id===165||id===230),'bluePaint');
  add(adapter,selectCADFaces(adapterGeometry,id=>id!==165&&id!==230),'steel');
  const neckLiner=new THREE.CylinderGeometry(.102,.102,.242098,64,1,true);neckLiner.translate(0,.742951,0);add(neck,neckLiner,'steel');
  for(const y of [.621902,.864]){const end=annulus(.102,.13,.001,'y');end.translate(0,y,0);add(neck,end,'steel');}
  yield;
  const gearbox=createPart('gearbox',[0,1.05,-.08],-.04);add(gearbox,cad.get('gearbox'),'gear');
  const wheel=createPart('handwheel',[0,1.05,-.08],-.04);add(wheel,cad.get('handwheel'),'gear');
  const rim=drawnWire(wheelGrid());wheel.group.add(rim);wheel.wires.push(rim);
  const wheelPivot=new THREE.Group();wheelPivot.name='handwheel-axis';wheelPivot.position.set(-.362,1.019,.888714);
  for(const child of [...wheel.group.children]){wheelPivot.add(child);child.position.sub(wheelPivot.position);}
  wheel.group.add(wheelPivot);wheel.frameInGroup=true;
  const shaftCap=new THREE.CylinderGeometry(.02,.02,.008,32);shaftCap.rotateX(Math.PI/2);shaftCap.translate(-.362,1.019,.619);add(gearbox,shaftCap,'steel');
  yield;
  const stem=createPart('stem',[0,.6,.2],.04);add(stem,cad.get('stem-bottom'),'steel');const shaft=new THREE.CylinderGeometry(.072,.072,.31,48);shaft.translate(0,.755,0);add(stem,shaft,'steel');
  for(const side of [-1,1]){
    // ENERGY DN250-400 PP: retain the seat, backup seal, support and wave spring.
    // The previous additional thrust ring had no confirmed catalog position.
    const defs=[['seat',.39,.463,.025,.419,.72,'seat'],['seal',.447,.466,.013,.444,.83,'seal'],['support',.39,.461,.014,.468,.94,'steel'],['spring',.398,.462,.016,.49,1.04,'spring']];
    for(const [index,[id,inner,outer,thickness,x,spread,material]] of defs.entries()){
      const part=createPart((side<0?'left-':'right-')+id,[side*(1.02+index*.4-x),index*.045,0],.04+spread*.025);
      let geo;
      if(id==='spring')geo=waveAnnulus(inner,outer,thickness);
      else geo=annulus(inner,outer,thickness);
      geo.translate(side*x,0,0);add(part,geo,material);
      yield;
    }
  }
  // Visual ordering and finish tones follow the manufacturer's exploded image.
  // Gold is a filled-polymer bearing appearance, not a brass grade assertion.
  const stemStack=[
    ['bearing-lower',.098,.07,.73,[-.4,.35,.16],'brass'],
    ['bearing-polymer',.096,.035,.77,[-.4,.48,.16],'seat'],
    ['bearing-upper',.098,.07,.84,[-.4,.72,.16],'brass'],
    ['spacer-lower',.094,.014,.695,[.44,.18,.2],'steel'],
    ['seal-epdm',.088,.012,.71,[.44,.28,.2],'seat'],
    ['seal-green-lower',.088,.012,.80,[.44,.39,.2],'seal'],
    ['seal-blue',.088,.012,.865,[.44,.49,.2],'blueSeal'],
    ['seal-green-upper',.088,.012,.887,[.44,.59,.2],'seal'],
    ['spacer-upper',.094,.014,.90,[.44,.70,.2],'steel'],
    ['retaining-ring',.094,.012,.918,[.44,.80,.2],'seat'],
  ];
  for(const [id,radius,thickness,y,offset,material] of stemStack){const part=createPart('stem-'+id,offset);const geo=annulus(.072,radius,thickness,'y');geo.translate(0,y,0);add(part,geo,material);yield;}
  const springPart=createPart('stem-spring',[-.4,.95,.16]);
  const coil=new THREE.CatmullRomCurve3(Array.from({length:97},(_,i)=>{const t=i/96;return new THREE.Vector3(.085*Math.cos(TAU*3*t),.94+.10*t,.085*Math.sin(TAU*3*t));}));
  add(springPart,new THREE.TubeGeometry(coil,96,.007,8,false),'spring');
  yield;
  let installation=null;
  if(installationSettings){
    const part=id=>parts.find(part=>part.id===id);
    // Place an actual thin gasket between the two raised sealing faces.
    installation=createPipeline({left:{valveFlange:part('left-flange'),flangeSource:part('right-flange'),pipeSource:part('right-pipe')},right:{valveFlange:part('right-flange'),flangeSource:part('left-flange'),pipeSource:part('left-pipe')}},{length:installationSettings.pipeLength??4.2,connection:{...flangeConnection,finish:materials.bluePaint},elbow:installationSettings.elbow});
    // Match all cloned pipeline exteriors; retain machined steel and the blue valve.
    for(const unit of installation.units)for(const mesh of unit.solids)for(const surface of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
      if(surface.color.getHex()===materials.bluePaint.color){surface.setValues(pipelineFinish);surface.userData.reflectionEnvironment='polishedSteel';}
    }
    root.add(installation.root);
    yield;
  }
  let cutaway=null;
  if(cutawayEnabled){
    if(!installation)throw Error('Cutaway requires an installed pipeline');
    const shellIds=['body','left-pipe','right-pipe','left-flange','right-flange'];
    const groups=parts.filter(part=>shellIds.includes(part.id)).map(part=>({id:part.id,parent:part.group,meshes:part.solids.map(entry=>entry.mesh),innerFinish:part.id==='body',pipeBore:part.id!=='body'}));
    groups.push(...installation.units.map(unit=>({id:unit.root.name,parent:unit.root,meshes:unit.solids,pipeBore:!unit.route})));
    groups.push(...installation.fastening.gaskets.map(gasket=>({id:gasket.root.name,parent:gasket.root,meshes:[gasket.solid],pipeBore:true})));
    const connections=installation.joints.map(joint=>{const flange=installation.units.find(unit=>unit.kind==='flange'&&unit.side===joint.side);return {x:(joint.valveFace+joint.joint)/2,outerRadius:Math.max(Math.abs(flange.bounds.min.y),Math.abs(flange.bounds.max.y))};});
    const outerEnd=installationSettings.elbow?Math.abs(installation.joints[0].pipeStart):undefined;
    cutaway=createCutaway(groups,{bore:{radius:.406,innerEnd:.523,outerEnd,parent:root,material:materials.steel},interiorFinish:materials.stainless,connections,routes:installation.units.map(unit=>unit.route).filter(Boolean),prepared});
    installation.fastening.bindSection(cutaway.uniforms,cutaway.passage.shader);
    yield 'task';
  }
  let water=null;
  if(waterEnabled){
    if(!cutaway)throw Error('Water requires the longitudinal section');
    const inlet=installation.joints.find(joint=>joint.side<0);
    const outlet=installation.joints.find(joint=>joint.side>0);
    water=createInletWater({start:inlet.pipeEnd,route:inlet.route,radius:.4055,ballRadius:.596,section:cutaway.uniforms,outlet:openingEnabled?{end:outlet.pipeEnd,route:outlet.route}:null});root.add(water.root);
    yield;
  }
  if(openingEnabled&&!water)throw Error('Valve opening requires inlet water');
  const operation=openingEnabled?new QuarterTurn():null;
  function update(state,dt=1/60){
    // Once reverse travel has hidden and cleared the passage, a fresh inlet
    // cycle starts closed even if the previous six-second closing was cut short.
    if(operation&&!state.openValve&&state.cutaway===0&&water.fluid.ratio===0)operation.reset();
    const moving=operation?.step(!!state.openValve&&water.fluid.ratio>=1-1e-7,dt,state.reduced)||false;
    ball.group.rotation.y=stem.group.rotation.y=(state.closeValve||0)*(1-(operation?.value||0))*Math.PI/2;
    wheelPivot.rotation.z=handwheelAngle(operation?.wheelValue||0);
    state.valveOpening=operation?.value||0;state.flowRequested=openingEnabled&&!!state.openValve;
    return moving;
  }
  return {root,parts,add,reflectionEnvironments,installation,cutaway,water,operation,wheelPivot,update};
}
