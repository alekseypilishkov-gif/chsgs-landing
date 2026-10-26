import {clamp,panAt} from './terrain-motion.js';
import {createMenuTransition} from './menu-transition.js';
import {createHeroCopy} from './hero-copy.js';
import {createFactoryDetail} from './factory-detail.js';


const root=document.documentElement,chapters=[...document.querySelectorAll('.chapter')];
const links=[...document.querySelectorAll('.section-menu a')];
const menu=document.querySelector('#section-menu'),menuToggle=document.querySelector('.menu-toggle'),status=document.querySelector('#scene-status');
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),finePointer=matchMedia('(hover: hover) and (pointer: fine)');
let current=-1,progress=0,frame=0,last=0,clock=0,selected=0;
let renderer,scene,camera,presentation,THREE,factoryModel,factoryLoading;
let menuOpen=false,menuBlend=0,detailBlend=0;
const pointer=[0,0],pan=[0,0],blueprint=document.querySelector('.blueprint-grid');


root.classList.add('is-enhanced');
const heroCopy=createHeroCopy(document.querySelector('#factory'));
const screenGuides=document.querySelector('.screen-guides');
const menuMotion=createMenuTransition(root,menu,screenGuides,document.querySelector('.menu-shade'),reduced);
root.dataset.menuEffect='grid-typewriter';
const detail=createFactoryDetail(root,menuMotion,reduced,requestFrame);
const focusGuides=target=>menuMotion.focus(target);
const menuFills=new Map();
function fillMenuLink(link,active){
  const title=link.querySelector('.menu-title'),to=active?'#ffec00':'#fff',previous=menuFills.get(link);
  if(previous?.color===to)return;
  previous?.animation?.cancel();const from=previous?.color||'#fff';
  title.style.backgroundImage='linear-gradient(90deg,'+to+' 50%,'+from+' 50%)';title.style.backgroundPosition='100% 0';
  const animation=title.animate([{backgroundPosition:'100% 0'},{backgroundPosition:'0% 0'}],{duration:reduced.matches?0:400,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
  const state={color:to,animation};menuFills.set(link,state);
  animation.finished.then(()=>{if(menuFills.get(link)!==state)return;title.style.backgroundImage='linear-gradient('+to+','+to+')';title.style.backgroundPosition='0% 0';animation.cancel();state.animation=null;},()=>{});
}
for(const link of links){
  link.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'&&!menuMotion.busy)fillMenuLink(link,true);});
  link.addEventListener('pointerleave',()=>fillMenuLink(link,false));
  link.addEventListener('focus',()=>{if(link.matches(':focus-visible'))fillMenuLink(link,true);});
  link.addEventListener('blur',()=>{if(!link.matches(':hover'))fillMenuLink(link,false);});
}
const interactive=element=>element instanceof Element?element.closest('a[href],button'):null;
document.addEventListener('pointerover',event=>{if(event.pointerType!=='touch'&&finePointer.matches)focusGuides(interactive(event.target));});
document.addEventListener('pointerout',event=>{if(menuMotion.target&&!menuMotion.target.contains(event.relatedTarget))focusGuides(null);});
document.addEventListener('focusin',event=>{const target=interactive(event.target);if(target?.matches(':focus-visible'))focusGuides(target);});
document.addEventListener('focusout',event=>{if(menuMotion.target===interactive(event.target)&&!menuMotion.target?.matches(':hover'))focusGuides(null);});
function targetProgress(){return selected;}
async function setMenu(open){
  if(open&&detail.active){menuToggle.disabled=true;const done=await detail.set(false);menuToggle.disabled=false;if(!done)return false;}
  if(!open)for(const link of links)fillMenuLink(link,false);
  if(open!==menuOpen){menuOpen=open;root.classList.toggle('is-menu-open',open);
    menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Закрыть меню':'Меню разделов');}
  const finished=menuMotion.set(open);
  finished.then(done=>{if(done&&open&&menuOpen)(menu.querySelector('a[aria-current]')||menu.querySelector('a')).focus({preventScroll:true});});
  requestFrame();return finished;
}
menuToggle.addEventListener('click',()=>setMenu(!menuOpen));
function go(index){
  focusGuides(null);selected=clamp(index,0,3);progress=selected;updateUI();requestFrame();
}
async function ensureFactory(){
  if(factoryModel){detail.setModelStatus(true);return;}
  if(!renderer){detail.setModelStatus(false);return;}
  if(!factoryLoading)factoryLoading=import('./factory-detail-model.js').then(module=>module.createFactoryDetailModel(scene)).then(model=>{factoryModel=model;detail.setModelStatus(true);root.dataset.factory='ready';requestFrame();}).catch(error=>{console.error('Factory detail initialization failed',error);detail.setModelStatus(false);root.dataset.factory='unavailable';}).finally(()=>{factoryLoading=null;});
  return factoryLoading;
}
async function openFactory(){
  if(menuMotion.active&&!await setMenu(false))return;
  factoryModel?.reset();ensureFactory();await detail.set(true);
}
document.querySelector('#factory-more').addEventListener('click',openFactory);
document.querySelector('.detail-close').addEventListener('click',async()=>{if(await detail.set(false))document.querySelector('#factory-more').focus({preventScroll:true});});
for(const link of document.querySelectorAll('a[href^="#"]'))link.addEventListener('click',async event=>{
  const index=chapters.findIndex(chapter=>'#'+chapter.id===link.hash);
  if(index<0)return;
  event.preventDefault();if(detail.active&&!await detail.set(false))return;if(menuMotion.active){const done=await setMenu(false);if(!done||menuOpen)return;}go(index);
  if(link.closest('.section-menu'))menuToggle.focus();
  if(link.classList.contains('skip')){const heading=chapters[index].querySelector('h1');heading.tabIndex=-1;heading.focus({preventScroll:true});}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&detail.active){detail.set(false).then(done=>{if(done)document.querySelector('#factory-more').focus({preventScroll:true});});return;}
  if(event.key==='Escape'&&menuOpen){setMenu(false);menuToggle.focus();return;}
  if(menuMotion.active&&event.key==='Tab'){
    const controls=[document.querySelector('.identity'),menuToggle,...(menuMotion.busy?[]:menu.querySelectorAll('a'))],index=controls.indexOf(document.activeElement);
    if(event.shiftKey&&index===0){event.preventDefault();controls.at(-1).focus();}
    else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0].focus();}
    return;
  }

});
function updateUI(){
  const index=Math.round(progress),fraction=Math.abs(progress-index);
  const opacity=reduced.matches?1:1-clamp(fraction*2.5);
  chapters.forEach((chapter,i)=>{
    const content=chapter.firstElementChild,active=i===index;
    content.classList.toggle('is-current',active);
    content.style.opacity=active?opacity:0;
    content.style.visibility=active?'visible':'hidden';
    content.style.transform=`translateY(${reduced.matches?0:(1-opacity)*16}px)`;
    content.inert=!active;content.setAttribute('aria-hidden',String(!active));
  });
  document.querySelector('#journey-progress').style.transform='scaleX(0)';
  if(index===current)return;
  current=index;
  for(const link of links){if(link.hash==='#'+chapters[index].id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
  root.dataset.section=chapters[index].id;
}
function requestFrame(){if(!frame&&!document.hidden)frame=requestAnimationFrame(render);}
function render(now){
  frame=0;const dt=Math.min(50,now-(last||now));last=now;
  const target=targetProgress();
  progress=reduced.matches?target:progress+(target-progress)*(1-Math.exp(-dt*.012));
  if(Math.abs(target-progress)<.00001)progress=target;
  const panTarget=panAt(pointer[0],pointer[1],finePointer.matches&&!reduced.matches);
  for(let axis=0;axis<2;axis++){pan[axis]+=(panTarget[axis]-pan[axis])*(1-Math.exp(-dt*.002));if(Math.abs(pan[axis]-panTarget[axis])<.00001)pan[axis]=panTarget[axis];}
  const detailState=detail.update(now);
  blueprint.style.translate=(-pan[0]*1600).toFixed(3)+'px '+(pan[1]*1800-(reduced.matches?0:Math.min(detailState.scroll*.035,40))).toFixed(3)+'px';
  updateUI();
  document.querySelector('#journey-progress').style.transform='scaleX('+detailState.progress+')';
  if(renderer&&presentation){
    clock+=dt/1000;
    const menuTarget=menuMotion.active?1:0;menuBlend=reduced.matches?menuTarget:menuBlend+(menuTarget-menuBlend)*(1-Math.exp(-dt*.006));
    const detailTarget=detail.active?1:0;detailBlend=reduced.matches?detailTarget:detailBlend+(detailTarget-detailBlend)*(1-Math.exp(-dt*.006));
    const state=presentation.update(clock,{progress,pan,reduced:reduced.matches,menu:menuBlend,detail:detailBlend,detailScroll:detailState.scroll,height:innerHeight});
    if(factoryModel){const factoryState=factoryModel.update(clock,{...detailState,active:detailState.factoryActive,width:innerWidth,height:innerHeight,camera,pan,reduced:reduced.matches});root.dataset.factoryReveal=factoryState.reveal.toFixed(3);}
    root.classList.toggle('hero-copy-visible',state.copy);heroCopy.update(state);root.dataset.intro=state.stage;root.dataset.copy=state.copyStage;
    root.dataset.product=presentation.manifest.models[state.from].id;root.dataset.rotation=state.angle.toFixed(3);root.dataset.morph=state.morph.toFixed(4);
    renderer.render(scene,camera);root.dataset.pan=pan.map(v=>v.toFixed(5)).join(',');
  }
  root.dataset.progress=progress.toFixed(5);
  if(Math.abs(target-progress)>.00001||(!reduced.matches&&((renderer&&presentation)||detail.active))||pan.some((v,i)=>Math.abs(v-panTarget[i])>.00001))requestFrame();
}
addEventListener('scroll',()=>{focusGuides(null);requestFrame();},{passive:true});
addEventListener('pointermove',event=>{if(event.pointerType==='mouse'){pointer[0]=event.clientX/innerWidth-.5;pointer[1]=event.clientY/innerHeight-.5;requestFrame();}},{passive:true});
function centrePointer(){pointer.fill(0);focusGuides(null);requestFrame();}
document.addEventListener('pointerleave',centrePointer);addEventListener('blur',centrePointer);
function resizeScene(){
  if(!renderer)return;
  presentation?.resize(camera,innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(innerWidth,innerHeight,false);
}
addEventListener('resize',()=>{menuMotion.finish();detail.measure();resizeScene();requestFrame();});
reduced.addEventListener('change',()=>{menuMotion.finish();pointer.fill(0);pan.fill(0);requestFrame();});
finePointer.addEventListener('change',()=>focusGuides(null));
document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden){menuMotion.finish();cancelAnimationFrame(frame);frame=0;}else requestFrame();});
addEventListener('pageshow',()=>{last=0;requestFrame();});
function showFailure(){
  detail.setModelStatus(false);
  root.dataset.scene='unavailable';root.classList.add('hero-copy-visible');heroCopy.finish();status.hidden=false;status.replaceChildren('Не удалось показать 3D-продукцию. Разделы доступны. ');
  const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить';retry.addEventListener('click',()=>location.reload());status.append(retry);
}
async function init(){
  try{
    const modules=await Promise.all([import('three'),import('./product-hero.js')]);THREE=modules[0];
    renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#product-scene'),alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(innerWidth,innerHeight,false);renderer.setClearColor(0x292929,0);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.1,60);
    presentation=await modules[1].createProductHero(scene);resizeScene();
    renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frame);frame=0;renderer=null;showFailure();});
    clock=0;root.dataset.scene='ready';status.hidden=true;requestFrame();
  }catch(error){console.error('Product hero initialization failed',error);renderer?.dispose();renderer=null;showFailure();}
}
progress=targetProgress();updateUI();requestFrame();init();
addEventListener('pagehide',event=>{if(!event.persisted){cancelAnimationFrame(frame);presentation?.dispose();factoryModel?.dispose();detail.dispose();heroCopy.dispose();menuMotion.dispose();for(const state of menuFills.values())state.animation?.cancel();renderer?.dispose();}});
