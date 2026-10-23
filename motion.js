export const clamp = (n, a=0, b=1) => Math.min(b, Math.max(a, n));
export const linear = (p,a,b) => clamp((p-a)/(b-a));
export const smooth = (p,a,b) => {const t=linear(p,a,b);return t*t*(3-2*t);};
export const response=Object.freeze({scroll:6,assembly:4,rotation:12,parallax:5,maxShiftY:8,maxPointerYaw:2.5*Math.PI/180});
const assemblyStart=.84,assemblyEnd=.98,assemblyExtra=.16;
const mountingHoldStart=1.515,mountingHoldEnd=1.64,mountingTravel=-.10;
export const timelineSpan=end=>end+assemblyExtra+mountingTravel*linear(end,mountingHoldStart,mountingHoldEnd);
export const installationEnd=1.64;
export const cutawayEnd=1.88;
export const waterEnd=1.94;
export const openingStart=1.95,openingEnd=2.04;
// Give assembly extra native scroll travel while preserving the earlier
// chapters' physical travel. This mapping and its inverse keep stage buttons
// and reverse scrolling aligned with the same product timeline.
export function scrollAtTimeline(progress,end=1){
  const p=clamp(progress,0,end);return (p+assemblyExtra*linear(p,assemblyStart,assemblyEnd)+mountingTravel*linear(p,mountingHoldStart,mountingHoldEnd))/timelineSpan(end);
}
export function timelineAtScroll(progress,end=1){
  const normalized=clamp(progress);if(normalized===0||normalized===1)return normalized*end;
  let p=normalized*timelineSpan(end);
  if(p<=assemblyStart)return p;
  if(p<assemblyEnd+assemblyExtra)return assemblyStart+(p-assemblyStart)*(assemblyEnd-assemblyStart)/(assemblyEnd-assemblyStart+assemblyExtra);
  p-=assemblyExtra;
  if(p<=mountingHoldStart)return clamp(p,0,end);
  if(p>=mountingHoldEnd+mountingTravel)return clamp(p-mountingTravel,0,end);
  return mountingHoldStart+(p-mountingHoldStart)*(mountingHoldEnd-mountingHoldStart)/(mountingHoldEnd-mountingHoldStart+mountingTravel);
}
// Exponential response uses elapsed seconds, so drag/scroll feel the same at
// different refresh rates. Snap the final fraction to let the renderer sleep.
export function follow(value,target,dt,rate,epsilon=.00008){
  const next=value+(target-value)*(1-Math.exp(-rate*Math.max(0,dt)));
  return Math.abs(target-next)<=epsilon?target:next;
}
export function pointerParallax(x,y,reduced=false,mounting=false){
  return reduced?{x:0,y:0,yaw:0}:{x:0,y:-clamp(y,-1,1)*response.maxShiftY,yaw:mounting?0:-clamp(x,-1,1)*response.maxPointerYaw};
}
export function visibleParallax(pose,state){
  if(state.reduced||state.volume===0)return {x:0,y:0,yaw:0};
  return {x:0,y:pose.y*state.volume,yaw:state.installationTurn===1?0:pose.yaw*state.volume*(1-state.installationTurn)};
}
export const stops = [.08,.37,.64,.77,1];
export const titles = ['Чертёж','Объём','Детали','Материалы','Изделие в сборе','Трубопровод','Продольный разрез','Заполнение водой','Открытие крана'];
export function chapter(p){return p<.19?0:p<.38?1:p<.65?2:p<.84?3:p<1.05?4:p<1.70?5:p<1.90?6:p<openingStart?7:8;}
export function rotationAllowed(state,targetProgress=state.progress){return state.volume>.98&&state.chapter<5&&chapter(targetProgress)<5;}
export function stateAt(p,reduced=false){
  p=clamp(p,0,openingEnd);
  const draftDissolve=smooth(p,.18,.24);
  const pipeWire=reduced?(p>=1.425?1:0):smooth(p,1.425,1.49),pipeSolid=reduced?(p>=1.425?1:0):smooth(p,1.44,1.515);
  return {progress:p,draft:1-draftDissolve,draftDissolve,draw:linear(p,0,.17),
    wire:1-smooth(p,.80,.86),wireDraw:linear(p,.17,.35),volume:smooth(p,.24,.36),
    turn:smooth(p,.29,.38),explode:smooth(p,.38,.63)*(1-smooth(p,.84,.98)),
    material:linear(p,.65,.81),assembly:smooth(p,.84,.98),finalDetail:smooth(p,.98,1),
    intro:1-smooth(p,.04,.13),reduced,chapter:chapter(p),
    installationTurn:reduced?(p>=1.05?1:0):smooth(p,1.05,1.23),
    gasketDraw:reduced?(p>=1.24?1:0):linear(p,1.24,1.285),
    gasketSolid:reduced?(p>=1.24?1:0):smooth(p,1.255,1.30),
    gasketSeat:reduced?(p>=1.30?1:0):smooth(p,1.30,1.355),
    flangeWire:reduced?(p>=1.36?1:0):linear(p,1.36,1.405),
    flangeSolid:reduced?(p>=1.36?1:0):smooth(p,1.375,1.42),
    pipeWire,pipeSolid,studDraw:pipeWire,studSolid:pipeSolid,nutDraw:pipeWire,nutSolid:pipeSolid,
    closeValve:reduced?(p>=1.05?1:0):smooth(p,1,1.14),
    cutaway:reduced?(p>=1.70?1:0):smooth(p,1.70,1.84),
    waterFill:p>=1.90?1:0,openValve:p>=openingStart?1:0};
}
// Explicit extraction waypoints, as in Strizh: open the connection first,
// then move to the display position. The same path runs backwards on assembly.
export function pathPosition(path,t){
  t=clamp(t);let i=1;while(i<path.length-1&&t>path[i][0])i++;
  const [a,start]=path[i-1],[b,end]=path[i],f=smooth(t,a,b);
  return start.map((v,k)=>v+(end[k]-v)*f);
}
export function partPath(id,offset,paths={}){
  return paths[id]||[[0,[0,0,0]],[.82,[0,0,0]],[1,offset]];
}
export function dragYaw(start,deltaX){return start-deltaX*.006;}
export function cameraTurns(state,yaw){return {automatic:state.reduced?0:state.turn,manual:state.volume>.98?yaw:0};}
export function partExplosion(p,offset=0){
  return smooth(p,.37+offset,.56+offset)*(1-smooth(p,.84+offset*.25,.98+offset*.1));
}
