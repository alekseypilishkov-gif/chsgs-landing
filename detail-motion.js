import {clamp} from './terrain-motion.js';

export function detailFrameAt(width,height){
  const inset=width>=1000?width*.25:Math.max(24,width*.06),y=clamp(height*.01,8,16);
  return {columns:[inset,width-inset-1],rows:[y,height-y-1]};
}
export function detailProductAt(scroll,height,reduced=false){
  const t=clamp(scroll/Math.max(680,height*.8)),exit=t*t*(3-2*t);
  return {scale:2/3,x:1.45,y:reduced?1.35:1.35+exit*5,opacity:1-exit};
}
export function counterAt(progress,value){return Math.round(value*(1-Math.pow(1-clamp(progress),3)));}
export function detailParallaxAt(distance,speed,width){const limit=width<=650?24:110;return clamp(distance*speed,-limit,limit);}
export function inertialScrollAt(current,target,dt){return Math.abs(target-current)<1?target:current+(target-current)*(1-Math.exp(-clamp(dt,0,64)/200));}
