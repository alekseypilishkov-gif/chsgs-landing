import * as THREE from 'three';
import {RoomEnvironment} from './vendor/RoomEnvironment.js';
import {readCAD} from './model.js';
import {decodePreparedDisplay,createDrawingFrame} from './prepared-display.js';
import {loadProfile} from './product-profile.js';
import {clamp,smooth,stateAt,pathPosition,dragYaw,cameraTurns,stops,titles,chapter,follow,response,pointerParallax,visibleParallax,scrollAtTimeline,timelineAtScroll,timelineSpan,installationEnd,cutawayEnd,waterEnd,openingEnd,rotationAllowed} from './motion.js';
import {FillScrollGate,openingIntentAt} from './valve-operation.js';
import {createSceneWarmup} from './scene-warmup.js';

const section=document.querySelector('#experience'),canvas=document.querySelector('#scene'),wrap=document.querySelector('#canvas-wrap');
const chapterTitle=document.querySelector('#chapter-title'),loadCopy=document.querySelector('#load-copy'),retry=document.querySelector('#retry');
const buttons=[...document.querySelectorAll('[data-stop]')];
const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
let renderer,scene,camera,product,profile,draft,draftGuide,environment,frame=0,current=0,target=0,lastTime=0,ready=false,drawingReady=false,visible=true,reduced=motionQuery.matches;
let lastChapter=-1,renderCount=0,sizeDirty=true,abort=new AbortController();
let reflectionTargets=[];
let warmup=null;
let sequenceEnd=1,sequenceStops=stops;
let yaw=0,targetYaw=0,pointer=null;
let openingIntent=false;
const fillGate=new FillScrollGate();
const parallax={x:0,y:0,yaw:0},parallaxTarget={x:0,y:0,yaw:0};
const box=new THREE.Box3(),temp=new THREE.Vector3(),targetCenter=new THREE.Vector3(),viewDir=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();
const fill=document.querySelector('#progress-fill'),loadFill=document.querySelector('#load-fill');
function nativeTop(p){const travel=section.offsetHeight-innerHeight;return section.offsetTop+travel*(reduced?p/sequenceEnd:scrollAtTimeline(p,sequenceEnd));}
function updateTarget(){
  const travel=section.offsetHeight-innerHeight;let p=travel>0?clamp((scrollY-section.offsetTop)/travel):0;
  const requested=reduced?p*sequenceEnd:timelineAtScroll(p,sequenceEnd);
  if(profile?.opening)openingIntent=openingIntentAt(openingIntent,target,requested,fillGate.complete);
  target=ready&&profile.water?fillGate.request(requested):requested;
  if(fillGate.locked){const top=nativeTop(target);if(Math.abs(scrollY-top)>.5)window.scrollTo({top,behavior:'instant'});p=reduced?target/sequenceEnd:scrollAtTimeline(target,sequenceEnd);}
  section.dataset.nativeProgress=p.toFixed(5);section.dataset.scrollLocked=String(fillGate.locked);section.dataset.settled='false';requestRender();
}
function requestRender(){if(!frame&&visible)frame=requestAnimationFrame(render);}
function goTo(p){const next=ready&&profile.water?fillGate.request(p):p;window.scrollTo({top:nativeTop(next),behavior:'instant'});updateTarget();}
function restartExperience(){
  if(pointer&&canvas.hasPointerCapture(pointer.id))canvas.releasePointerCapture(pointer.id);
  pointer=null;openingIntent=false;fillGate.reset();product?.operation?.reset();canvas.classList.remove('dragging');current=target=yaw=targetYaw=0;lastTime=0;lastChapter=-1;
  parallax.x=parallax.y=parallax.yaw=parallaxTarget.x=parallaxTarget.y=parallaxTarget.yaw=0;
  window.scrollTo({top:0,left:0,behavior:'instant'});updateTarget();
}
buttons.forEach(button=>button.addEventListener('click',()=>goTo(Number(button.dataset.stop))));
document.querySelector('#next-stage').addEventListener('click',()=>goTo(target>sequenceEnd-.03?0:(sequenceStops.find(p=>p>target+.025)||sequenceEnd)));
function makeDraft(paths){
  // Sort drawing paths into a readable sweep, then draw each vector with a
  // shared cumulative length. These are sampled paths from the supplied DWG.
  paths.sort((a,b)=>{const ay=a.reduce((v,p)=>v+p[1],0)/a.length,by=b.reduce((v,p)=>v+p[1],0)/b.length;return by-ay;});
  const positions=[],progress=[];let length=0;
  for(const path of paths)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],dist=Math.hypot(b[0]-a[0],b[1]-a[1]);if(dist<1e-6)continue;
    positions.push(a[0],a[1],.008,b[0],b[1],.008);progress.push(length,length+dist);length+=dist;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('linePosition',new THREE.Float32BufferAttribute(progress.map(p=>p/length),1));
  const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,uniforms:{uDraw:{value:0},uDissolve:{value:0},uOpacity:{value:1},uColor:{value:new THREE.Color(0xc9ccd4)}},vertexShader:'attribute float linePosition;varying float vLine;void main(){vLine=linePosition;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform float uDraw;uniform float uDissolve;uniform float uOpacity;uniform vec3 uColor;varying float vLine;void main(){if(vLine>uDraw)discard;float grain=fract(sin(floor(vLine*720.0)*12.9898)*43758.5453);float threshold=.12+.76*grain;float remaining=1.0-smoothstep(threshold-.08,threshold+.08,uDissolve);if(remaining<.001)discard;gl_FragColor=vec4(uColor,uOpacity*remaining);}'});
  const lines=new THREE.LineSegments(geometry,material);lines.renderOrder=4;return lines;
}
async function fetchBuffer(url){
  const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('Asset '+response.status);
  const total=Number(response.headers.get('content-length'))||6607792;
  if(!response.body)return response.arrayBuffer();
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;loadFill.style.width=Math.min(94,size/total*94)+'%';}
  const data=new Uint8Array(size);let cursor=0;for(const chunk of chunks){data.set(chunk,cursor);cursor+=chunk.length;}return data.buffer;
}
async function initialize(){
  try{
    section.dataset.state='loading';retry.hidden=true;loadCopy.textContent='Подготавливаем модель';
    profile=await loadProfile(new URL(section.dataset.product,document.baseURI).href);
    sequenceEnd=profile.opening?openingEnd:profile.water?waterEnd:profile.cutaway?cutawayEnd:profile.installation?installationEnd:1;sequenceStops=[...stops,...(profile.installation?[installationEnd]:[]),...(profile.cutaway?[cutawayEnd]:[]),...(profile.water?[waterEnd]:[]),...(profile.opening?[openingEnd]:[])];
    section.style.setProperty('--story-length',String(timelineSpan(sequenceEnd)));section.style.setProperty('--reduced-length',String(sequenceEnd));
    document.querySelector('button[data-installation]').hidden=!profile.installation;document.querySelector('button[data-cutaway]').hidden=!profile.cutaway;document.querySelector('button[data-water]').hidden=!profile.water;document.querySelector('button[data-opening]').hidden=!profile.opening;updateTarget();
    // Start the large model transfer without making the DWG wait for it.
    const modelBuffer=fetchBuffer(profile.assetURLs.model);modelBuffer.catch(()=>{});
    const [{createProduct,createProductAsync},paths,prepared]=await Promise.all([import(profile.adapterURL),fetch(profile.assetURLs.drawing,{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Drawing');return r.json();}),profile.assetURLs.prepared?fetch(profile.assetURLs.prepared,{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Prepared display '+r.status);return r.arrayBuffer();}).then(b=>decodePreparedDisplay(b,{id:profile.id,source:profile.source.stepSHA256})):null]);
    section.setAttribute('aria-label',profile.sectionLabel);canvas.setAttribute('aria-label',profile.canvasLabel);
    const fallback=document.querySelector('.fallback');fallback.src=profile.assetURLs.fallback;fallback.alt=profile.drawingAlt;
    section.dataset.productId=profile.id;section.dataset.sourceSha256=profile.source.stepSHA256;lastChapter=-1;
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,innerWidth<600?1.5:2));renderer.setClearColor(0x262626,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(profile.camera.fov,1,profile.camera.near,profile.camera.far);
    draft=makeDraft(paths);scene.add(draft);
    draftGuide=new THREE.LineSegments(draft.geometry,draft.material.clone());draftGuide.material.uniforms.uDraw.value=1;draftGuide.renderOrder=3;scene.add(draftGuide);
    if(prepared?.manifest.framing){
      product=createDrawingFrame(prepared);scene.add(product.root);drawingReady=true;section.dataset.state='drawing';section.dataset.drawingReady='true';sizeDirty=true;requestRender();
    }
    const buffer=await modelBuffer;
    await new Promise(resolve=>setTimeout(resolve,0));
    const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
    room.traverse(object=>{if(object.isMesh&&object.material?.isMeshStandardMaterial)object.material.color.setHex(0x303339);});
    environment=pmrem.fromScene(room,.035);room.dispose();scene.environment=environment.texture;scene.environmentIntensity=.9;
    scene.add(new THREE.HemisphereLight(0xffffff,0x292d36,1.25));
    const key=new THREE.DirectionalLight(0xfffcf2,3);key.position.set(-3,5,5);scene.add(key);
    const rim=new THREE.DirectionalLight(0xe1edf7,3);rim.position.set(4,2,-3);scene.add(rim);
    const complete=await (createProductAsync||createProduct)(readCAD(buffer),profile.installation,profile.cutaway,profile.water,profile.opening,prepared,{signal:abort.signal});
    if(drawingReady)product.root.removeFromParent();product=complete;drawingReady=false;
    section.dataset.preparation=JSON.stringify(product.preparation||null);
    if(profile.installation&&!product.installation)throw Error('Product needs an installation adapter');
    if(profile.cutaway&&!product.cutaway)throw Error('Product needs a cutaway adapter');
    if(profile.water&&!product.water)throw Error('Product needs a water adapter');
    if(profile.opening&&!product.operation)throw Error('Product needs a valve-operation adapter');
    for(const target of reflectionTargets)target.dispose();reflectionTargets=[];
    // A product can give polished surfaces their own reflection studio without
    // changing the lighting or coating of the remaining assembly.
    for(const [id,settings] of Object.entries(product.reflectionEnvironments||{})){
      const studio=new RoomEnvironment();studio.traverse(object=>{if(object.isMesh&&object.material?.isMeshStandardMaterial)object.material.color.setHex(object.isInstancedMesh?settings.boxColor:settings.wallColor);});
      const target=pmrem.fromScene(studio,settings.blur??.02);reflectionTargets.push(target);studio.dispose();
      product.root.traverse(object=>{if(object.isMesh)for(const surface of Array.isArray(object.material)?object.material:[object.material])if(surface.userData.reflectionEnvironment===id)surface.envMap=target.texture;});
    }
    pmrem.dispose();scene.add(product.root);
    ready=true;updateTarget();section.dataset.state='ready';loadFill.style.width='100%';current=target;sizeDirty=true;
    requestRender();
    warmup=createSceneWarmup(renderer,scene,camera,{signal:abort.signal,textures:[product.water?.texture,product.water?.through?.texture],onReady:()=>{section.dataset.warmup=JSON.stringify(warmup.stats);requestRender();},onError:error=>{console.warn('Scene preparation deferred to first use',error);section.dataset.warmup=JSON.stringify(warmup.stats);requestRender();}});
    section.dataset.warmup=JSON.stringify(warmup?.stats||null);
  }catch(error){drawingReady=false;fillGate.reset();if(error.name==='AbortError')return;console.error('Model initialization failed',error);section.dataset.state='error';loadCopy.textContent='Не удалось загрузить 3D-модель';retry.hidden=false;}
}
function resetParallax(){parallaxTarget.x=0;parallaxTarget.y=0;parallaxTarget.yaw=0;requestRender();}
function resize(){sizeDirty=true;lastChapter=-1;if(ready)window.scrollTo({top:nativeTop(target),behavior:'instant'});resetParallax();}
function fitCamera(state,mobile){
  const turns=cameraTurns(state,yaw),turning=turns.automatic;
  const direction=profile.camera.automaticDirection;
  viewDir.set(direction[0]*turning,direction[1]*turning,direction[2]);
  if(profile.installation)viewDir.lerp(temp.set(...profile.installation.direction),state.installationTurn);
  viewDir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),turns.manual);
  right.crossVectors(camera.up,viewDir).normalize();up.crossVectors(viewDir,right).normalize();
  product.root.updateMatrixWorld(true);
  const points=[];
  for(const part of product.parts){
    for(const entry of part.solids){
      const b=entry.mesh.geometry.boundingBox;
      const matrix=part.frameInGroup?part.group.matrixWorld:entry.mesh.matrixWorld;
      for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(matrix));
    }
  }
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const p of points){const x=p.dot(right),y=p.dot(up);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  targetCenter.copy(right).multiplyScalar((minX+maxX)/2).addScaledVector(up,(minY+maxY)/2);
  const aspect=wrap.clientWidth/wrap.clientHeight;
  const margin=profile.camera.margin[mobile?'mobile':'desktop']*(1+((profile.installation?.frameMargin||1)-1)*state.installationTurn);
  // Fit every moved part through the perspective frustum. A corner closer
  // to the lens needs additional distance; a whole-assembly AABB loses scale.
  const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));let distance=0;
  for(const point of points){temp.copy(point).sub(targetCenter);const depth=temp.dot(viewDir);distance=Math.max(distance,Math.abs(temp.dot(up))/tangent+depth,Math.abs(temp.dot(right))/(tangent*aspect)+depth);}
  distance*=margin;
  camera.aspect=aspect;camera.position.copy(targetCenter).addScaledVector(viewDir,distance);
  camera.lookAt(targetCenter);
  // Apply only the vertical cursor shift after fitting, fading it in with
  // the model's depth. The drawing stays fixed and has no hover response.
  const pose=visibleParallax(parallax,state);
  camera.setViewOffset(wrap.clientWidth,wrap.clientHeight,0,-pose.y,wrap.clientWidth,wrap.clientHeight);
}
function render(time){
  frame=0;if(!visible)return;
  const dt=lastTime?Math.max(0,(time-lastTime)/1000):1/60;lastTime=time;
  current=reduced?target:follow(current,target,dt,target>.84||current>.84?response.assembly:response.scroll);
  const state=stateAt(drawingReady?Math.min(current,.18):current,reduced),rotatable=rotationAllowed(state,target),mounting=state.chapter>=5||chapter(target)>=5;section.dataset.progress=current.toFixed(5);
  if(!state.volume)parallaxTarget.y=parallaxTarget.yaw=0;
  if(mounting)parallaxTarget.yaw=0;
  parallax.y=reduced?0:follow(parallax.y,parallaxTarget.y,dt,response.parallax,.01);
  parallax.yaw=reduced?0:follow(parallax.yaw,parallaxTarget.yaw,dt,response.parallax,.00001);
  const pointerPose=visibleParallax(parallax,state);
  if(!rotatable&&pointer)endDrag({pointerId:pointer.id});
  if(mounting)targetYaw=0;
  yaw=reduced?targetYaw:follow(yaw,targetYaw,dt,response.rotation,.0001);
  const c=state.chapter;if(c!==lastChapter){lastChapter=c;chapterTitle.textContent=(profile?.chapters||titles)[c];buttons.forEach((b,i)=>{if(i===c)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});const active=buttons[c],nav=active.parentElement,a=active.getBoundingClientRect(),n=nav.getBoundingClientRect();nav.scrollLeft+=a.left-n.left-(nav.clientWidth-a.width)/2;}
  fill.style.width=(current/sequenceEnd*100)+'%';
  const cue=document.querySelector('#cue-copy');cue.textContent=current>sequenceEnd-.03?'Начать заново':'Продолжайте скролл';
  let fluidMoving=false,operationMoving=false;
  if(ready||drawingReady){
    const mobile=wrap.clientWidth<600;
    if(sizeDirty){sizeDirty=false;renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);warmup?.refresh();}
    product.root.visible=state.wireDraw>0||state.material>0;
    product.root.scale.z=reduced?1:Math.max(.003,state.volume);
    product.root.rotation.y=pointerPose.yaw;
    product.root.rotation.z=mobile&&!reduced?profile.camera.mobileExplodedRotation*state.explode:0;
    product.installation?.update(state);
    // A direct jump into water can arrive before idle preparation completes.
    // Keep the section visible and start its automatic fill once it is ready.
    if(warmup&&!warmup.ready)state.waterFill=0;
    state.openValve=profile.opening&&fillGate.complete&&openingIntent?1:0;
    operationMoving=!!product.update?.(state,dt);
    product.cutaway?.update(state);
    fluidMoving=product.water?.update(state,dt)||false;
    if(ready&&profile.water)fillGate.update({ratio:product.water.fluid.ratio,cutaway:state.cutaway,target});
    section.dataset.scrollLocked=String(fillGate.locked);section.dataset.fillGate=fillGate.phase;
    for(const part of product.parts){
      const amount=reduced?(state.chapter===2||state.chapter===3?1:0):state.explode;
      part.group.position.fromArray(pathPosition(part.path,amount));
      for(const entry of part.solids){const amount=entry.finalDetail?state.finalDetail:state.material;entry.mesh.visible=state.material>0&&amount>0;entry.reveal.value=-.04+amount*1.1;entry.edge.value=!entry.finalDetail&&state.material>0&&state.material<1?1:0;}
      for(const wire of part.wires){wire.visible=state.wire>.001&&state.wireDraw>0;wire.material.uniforms.uDraw.value=reduced?1:state.wireDraw;wire.material.uniforms.uOpacity.value=state.wire*profile.wireOpacity;}
    }
    draft.visible=state.draft>.001;draft.material.uniforms.uDraw.value=state.draw;draft.material.uniforms.uOpacity.value=state.draft;draft.material.uniforms.uDissolve.value=state.draftDissolve;
    draftGuide.visible=draft.visible;draftGuide.material.uniforms.uOpacity.value=state.draft*.12;draftGuide.material.uniforms.uDissolve.value=state.draftDissolve;
    fitCamera(state,mobile);renderer.render(scene,camera);renderCount++;
    section.dataset.cameraPosition=camera.position.toArray().map(v=>v.toFixed(5)).join(',');
    section.dataset.renderCount=String(renderCount);
    section.dataset.yaw=yaw.toFixed(4);section.dataset.yawTarget=targetYaw.toFixed(4);section.dataset.scrollTarget=target.toFixed(5);section.dataset.parts=String(product.parts.length);
    section.dataset.parallaxX=pointerPose.x.toFixed(2);section.dataset.parallaxY=pointerPose.y.toFixed(2);section.dataset.parallaxTargetX=parallaxTarget.x.toFixed(2);section.dataset.parallaxTargetY=parallaxTarget.y.toFixed(2);section.dataset.parallaxYaw=pointerPose.yaw.toFixed(5);section.dataset.parallaxTargetYaw=parallaxTarget.yaw.toFixed(5);
    section.dataset.draftOpacity=state.draft.toFixed(4);section.dataset.draftDissolve=state.draftDissolve.toFixed(4);section.dataset.volume=state.volume.toFixed(4);section.dataset.autoTurn=state.turn.toFixed(4);
    section.dataset.weldReveal=state.finalDetail.toFixed(4);
    section.dataset.installationTurn=state.installationTurn.toFixed(4);section.dataset.pipeWire=state.pipeWire.toFixed(4);section.dataset.pipeSolid=state.pipeSolid.toFixed(4);section.dataset.flangeWire=state.flangeWire.toFixed(4);section.dataset.flangeSolid=state.flangeSolid.toFixed(4);section.dataset.contextParts=String(product.installation?.units.length||0);
    for(const key of ['gasketDraw','gasketSolid','gasketSeat','studDraw','studSolid','nutDraw','nutSolid'])section.dataset[key]=state[key].toFixed(4);
    section.dataset.mountingGaskets=String(product.installation?.fastening?.gaskets.length||0);section.dataset.mountingStuds=String(product.installation?.fastening?.studs.count||0);section.dataset.mountingNuts=String(product.installation?.fastening?.nuts.count||0);
    section.dataset.cutaway=state.cutaway.toFixed(4);section.dataset.cutX=product.cutaway?.uniforms.uSectionX.value.toFixed(4)||'';section.dataset.sectionFaces=String(product.cutaway?.entries.length||0);
    section.dataset.valveAngle=(state.closeValve*(1-(product.operation?.value||0))*90).toFixed(2);section.dataset.wheelAngle=((product.wheelPivot?.rotation.z||0)*180/Math.PI).toFixed(2);section.dataset.opening=(product.operation?.value||0).toFixed(5);section.dataset.operationMoving=String(operationMoving);
    section.dataset.waterFill=state.waterFill.toFixed(4);section.dataset.waterFront=product.water?.uniforms.uFront.value.toFixed(4)||'';section.dataset.waterVolume=(product.water?.fluid.ratio||0).toFixed(4);
    const through=product.water?.through?.fluid;
    section.dataset.flowInput=(through?.inletFlux||0).toFixed(5);section.dataset.flowOutput=(through?.outletFlux||0).toFixed(5);section.dataset.flowVolume=(through?.ratio||0).toFixed(5);section.dataset.flowFront=(through?.front||0).toFixed(4);section.dataset.flowTail=(through?.tail||0).toFixed(4);section.dataset.flowRequested=String(!!state.flowRequested);
    section.dataset.camera=camera.type;section.dataset.wireMode='transparent';
    section.dataset.draggable=String(rotatable);
    document.querySelector('#drag-hint').hidden=!rotatable;
    const canvasLabel=c>=7&&!fillGate.locked&&state.flowRequested?'Кран открывается, вода проходит через шар и течёт по правой трубе.':c>=7&&!fillGate.locked&&through?.volume>0?'Кран закрывается. Остатки воды стекают по правой трубе.':c>=7?(fillGate.locked?'Вода заполняет левую трубу до закрытого шара.':'Левая труба заполнена водой до закрытого шара. Продолжайте прокрутку, чтобы открыть кран.'):c>=6?'Трёхмерная модель крана в продольном разрезе. Ракурс зафиксирован.':mounting?'Трёхмерная модель крана. На этапе монтажа ракурс зафиксирован.':profile.canvasLabel;
    if(canvas.getAttribute('aria-label')!==canvasLabel)canvas.setAttribute('aria-label',canvasLabel);
  }
  const moving=current!==target||yaw!==targetYaw||fluidMoving||operationMoving||(!reduced&&(parallax.y!==parallaxTarget.y||parallax.yaw!==parallaxTarget.yaw));
  section.dataset.settled=String(!moving);
  if(moving||product?.water?.animated)requestRender();else lastTime=0;
}
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||!ready||!rotationAllowed(stateAt(current,reduced),target)||event.pointerType==='touch')return;
  event.preventDefault();canvas.focus({preventScroll:true});
  targetYaw=yaw;parallaxTarget.y=parallax.y;parallaxTarget.yaw=parallax.yaw;
  pointer={id:event.pointerId,x:event.clientX,yaw};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove',event=>{if(!pointer||pointer.id!==event.pointerId)return;if(!rotationAllowed(stateAt(current,reduced),target)){endDrag(event);return;}event.preventDefault();targetYaw=dragYaw(pointer.yaw,event.clientX-pointer.x);requestRender();});
section.addEventListener('pointermove',event=>{
  if(event.pointerType!=='mouse'||!ready||pointer||reduced)return;
  const state=stateAt(current,reduced);if(!state.volume)return;
  const rect=wrap.getBoundingClientRect();
  Object.assign(parallaxTarget,pointerParallax((event.clientX-rect.left)/Math.max(1,rect.width)*2-1,(event.clientY-rect.top)/Math.max(1,rect.height)*2-1,false,state.chapter>=5||chapter(target)>=5));requestRender();
},{passive:true});
section.addEventListener('pointerleave',resetParallax);
canvas.addEventListener('dragstart',event=>event.preventDefault());
function endDrag(event){if(!pointer||pointer.id!==event.pointerId)return;pointer=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);requestRender();}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('lostpointercapture',()=>{pointer=null;canvas.classList.remove('dragging');});
document.querySelector('#reset-view').addEventListener('click',()=>{if(!ready||!rotationAllowed(stateAt(current,reduced),target))return;targetYaw=0;resetParallax();});
canvas.addEventListener('keydown',event=>{if(!ready||!rotationAllowed(stateAt(current,reduced),target)||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();targetYaw+=event.key==='ArrowLeft'?-.12:.12;requestRender();});
retry.addEventListener('click',()=>{fillGate.reset();warmup?.cancel();warmup=null;abort.abort();abort=new AbortController();if(renderer)renderer.dispose();ready=false;initialize();});
function blockScroll(event){if(ready&&fillGate.locked&&event.cancelable)event.preventDefault();}
window.addEventListener('wheel',blockScroll,{passive:false,capture:true});window.addEventListener('touchmove',blockScroll,{passive:false,capture:true});
window.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))blockScroll(event);},{capture:true});
window.addEventListener('scroll',updateTarget,{passive:true});window.addEventListener('resize',resize,{passive:true});
window.addEventListener('pageshow',restartExperience);
window.addEventListener('blur',()=>{if(pointer)endDrag({pointerId:pointer.id});resetParallax();});
document.addEventListener('visibilitychange',()=>{visible=!document.hidden;lastTime=0;if(visible)requestRender();else{parallaxTarget.x=parallaxTarget.y=parallaxTarget.yaw=parallax.x=parallax.y=parallax.yaw=0;}});
motionQuery.addEventListener('change',()=>{const anchor=target;reduced=motionQuery.matches;goTo(anchor);resize();});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();warmup?.cancel();fillGate.reset();ready=false;section.dataset.state='error';loadCopy.textContent='3D-сцена приостановлена';retry.hidden=false;});
new ResizeObserver(resize).observe(wrap);
restartExperience();initialize();
