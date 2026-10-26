import {clamp,factoryCamera} from './terrain-motion.js';

const storageKey='chsgs.factory.views.v1:'+JSON.stringify(factoryCamera),defaultTarget=[0,.35,0];
export function validView(view){const vector=value=>Array.isArray(value)&&value.length===3&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<100);return !!view&&vector(view.position)&&vector(view.rotation)&&(view.target===undefined||vector(view.target));}
export function readViews(text){
  try{const value=JSON.parse(text);return Object.fromEntries(['landscape','portrait'].filter(key=>validView(value?.[key])).map(key=>[key,value[key]]));}catch{return {};}
}
export function orbitFromPose(pose){
  const target=pose.target||defaultTarget;
  const [x,y,z]=pose.position.map((v,i)=>v-target[i]),radius=Math.hypot(x,y,z);
  return {target:[...target],radius:clamp(radius,2,32),theta:Math.atan2(x,z),phi:clamp(Math.acos(clamp(y/(radius||1),-1,1)),.04,Math.PI/2-.001)};
}
export function orbitPose(orbit){
  const {radius,theta,phi,target}=orbit,sin=Math.sin(phi);
  return {target:[...target],position:[target[0]+radius*sin*Math.sin(theta),target[1]+radius*Math.cos(phi),target[2]+radius*sin*Math.cos(theta)],rotation:[phi-Math.PI/2,theta,0]};
}
export function rotateOrbit(orbit,dx,dy,height){
  const angle=orbit.theta-dx/Math.max(1,height)*Math.PI*2;
  return {...orbit,theta:Math.atan2(Math.sin(angle),Math.cos(angle)),phi:clamp(orbit.phi-dy/Math.max(1,height)*Math.PI*2,.04,Math.PI/2-.001)};
}
export function panOrbit(orbit,dx,height){
  const distance=-dx/Math.max(1,height)*2*orbit.radius*Math.tan(factoryCamera.fov*Math.PI/360);
  return {...orbit,target:[clamp(orbit.target[0]+Math.cos(orbit.theta)*distance,-12,12),orbit.target[1],clamp(orbit.target[2]-Math.sin(orbit.theta)*distance,-12,12)]};
}
export function zoomOrbit(orbit,delta){return {...orbit,radius:clamp(orbit.radius*Math.exp(clamp(delta,-1000,1000)*.001),2,32)};}

export function createFactoryView(defaultPose,requestFrame){
  let views={};try{views=readViews(localStorage.getItem(storageKey));}catch{}
  const portrait=()=>innerWidth<innerHeight,slot=()=>portrait()?'portrait':'landscape';
  const controller={active:new URLSearchParams(location.search).has('camera'),saved:vertical=>views[vertical?'portrait':'landscape']};
  if(!controller.active)return controller;
  let orbit=orbitFromPose(controller.saved(portrait())||defaultPose(portrait())),drag=null;
  const root=document.documentElement,panel=document.createElement('section');
  panel.className='camera-panel';panel.setAttribute('aria-label','Настройка ракурса завода');
  panel.innerHTML='<h2>Настройка ракурса</h2><p>ЛКМ — поворот. ПКМ или Shift + ЛКМ — горизонтальный сдвиг. Колесо — масштаб.<br>Стрелки — поворот, Shift + ← / → — сдвиг, + / − — масштаб.</p><label class="camera-copy"><input type="checkbox"> Показать текст страницы</label><div class="camera-actions"><button type="button" data-save>Сохранить ракурс</button><button type="button" data-reset>Сбросить</button><button type="button" data-close>Вернуться на сайт</button></div><label>Параметры ракурса<textarea readonly rows="4" spellcheck="false" aria-label="Параметры ракурса для копирования"></textarea></label><p class="camera-notice" role="status">Сохранение действует в этом браузере. Параметры можно скопировать для переноса.</p>';
  document.body.append(panel);root.classList.add('is-camera-editor');scrollTo({top:0,behavior:'instant'});
  const output=panel.querySelector('textarea'),notice=panel.querySelector('.camera-notice');
  controller.pose=()=>orbitPose(orbit);
  function update(){output.value=JSON.stringify({portrait:portrait(),fov:factoryCamera.fov,...controller.pose()},(_,value)=>typeof value==='number'?Number(value.toFixed(6)):value,2);requestFrame();}
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(views));return true;}catch{notice.textContent='Браузер запретил сохранение. Скопируйте параметры ракурса ниже.';return false;}}
  panel.querySelector('[data-save]').onclick=()=>{views[slot()]=controller.pose();if(persist())notice.textContent='Ракурс сохранён для '+(portrait()?'вертикального':'горизонтального')+' экрана в этом браузере.';update();};
  panel.querySelector('[data-reset]').onclick=()=>{delete views[slot()];orbit=orbitFromPose(defaultPose(portrait()));if(persist())notice.textContent='Возвращён исходный ракурс.';update();};
  panel.querySelector('[data-close]').onclick=()=>{controller.active=false;root.classList.remove('is-camera-editor','camera-show-copy','is-camera-dragging');panel.hidden=true;const url=new URL(location.href);url.searchParams.delete('camera');history.replaceState(null,'',url);requestFrame();document.querySelector('.menu-toggle').focus({preventScroll:true});};
  panel.querySelector('input').onchange=event=>root.classList.toggle('camera-show-copy',event.target.checked);
  output.onclick=()=>output.select();
  document.body.addEventListener('pointerdown',event=>{
    if(!controller.active||![0,2].includes(event.button)||event.isPrimary===false||event.target.closest('a,button,input,textarea,label,.camera-panel'))return;
    event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY,pan:event.button===2||event.shiftKey};document.body.setPointerCapture(event.pointerId);root.classList.add('is-camera-dragging');
  });
  document.body.addEventListener('pointermove',event=>{
    if(!controller.active||drag?.id!==event.pointerId)return;
    orbit=drag.pan?panOrbit(orbit,event.clientX-drag.x,innerHeight):rotateOrbit(orbit,event.clientX-drag.x,event.clientY-drag.y,innerHeight);drag.x=event.clientX;drag.y=event.clientY;update();
  });
  document.body.addEventListener('contextmenu',event=>{if(controller.active&&!event.target.closest('.camera-panel'))event.preventDefault();});
  const end=()=>{drag=null;root.classList.remove('is-camera-dragging');};
  document.body.addEventListener('pointerup',end);document.body.addEventListener('pointercancel',end);document.body.addEventListener('lostpointercapture',end);addEventListener('blur',end);
  addEventListener('wheel',event=>{
    if(!controller.active||event.ctrlKey||event.target.closest('.camera-panel'))return;
    event.preventDefault();event.stopImmediatePropagation();orbit=zoomOrbit(orbit,event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1));update();
  },{passive:false,capture:true});
  document.addEventListener('keydown',event=>{
    if(!controller.active||event.target.closest('input,textarea,button,a'))return;
    const arrows={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
    if(event.key in arrows){event.preventDefault();orbit=event.shiftKey&&['ArrowLeft','ArrowRight'].includes(event.key)?panOrbit(orbit,arrows[event.key][0],innerHeight):rotateOrbit(orbit,...arrows[event.key],innerHeight);update();}
    else if(['+','=','-','_'].includes(event.key)){event.preventDefault();orbit=zoomOrbit(orbit,['-','_'].includes(event.key)?120:-120);update();}
  });
  addEventListener('resize',()=>{if(controller.active)update();});update();return controller;
}
