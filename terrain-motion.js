// Orano route, with an elevated first camera for the factory hero; FOV 35, YXZ rotation.
export const sceneDistance=60;
export const introDuration=8;
export const flightDuration=3;
export const parallaxAmplitude=[.06,.04];
export const factoryCamera={fov:35,target:[4.764624,.35,-1.729124],position:[5.786865,.391694,-5.771146],rotation:[-.01,2.893883,0]};
const landscape=[
  factoryCamera,
  {position:[-.32,.12,-5.8],rotation:[0,2.14,0]},
  {position:[.18,.5,-5.8],rotation:[-.25,3.64,0]},
  {position:[-.472,2.713,-6.2],rotation:[-.55,3.34,0]},
];
const portrait=[
  {position:[.089,12.5,-20],rotation:[-.57,3.18,0]},
  {position:[-.2,.085,-5.9],rotation:[0,2.32,0]},
  {position:[-.1,.5,-7],rotation:[-.25,3.64,0]},
  {position:[-.462,2.713,-6.6],rotation:[-.55,3.49,0]},
];
export const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
export const ease=value=>value<.5?8*value**4:1-8*(1-value)**4;
export const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
export function cameraAt(progress,{portrait:vertical=false,reduced=false,firstPose=null}={}){
  const p=clamp(progress,0,3),index=Math.min(2,Math.floor(p)),fraction=p-index;
  const t=reduced?Math.round(fraction):ease(fraction),defaults=vertical?portrait:landscape;
  const states=firstPose?[firstPose,...defaults.slice(1)]:defaults;
  const from=states[index],to=states[index+1];
  const position=from.position.map((v,axis)=>v+(to.position[axis]-v)*t);
  const wave=reduced?0:Math.sin(t*Math.PI);
  position[0]+=wave*Math.sin(40*t)*.02;
  position[1]+=wave*(.6+Math.sin(50*t)*.02);
  position[2]+=sceneDistance*(index+t);
  return {position,rotation:from.rotation.map((v,axis)=>{const delta=to.rotation[axis]-v;return v+(index===0?Math.atan2(Math.sin(delta),Math.cos(delta)):delta)*t;})};
}
export function introAt(seconds,reduced=false){
  if(reduced)return {edge:1,elevation:1,float:0,focus:0,approach:1};
  return {edge:smooth((seconds-3)/4),elevation:smooth((seconds-3)/2),float:1-smooth(seconds/4),focus:1-smooth((seconds-3)/3),approach:1-(1-clamp(seconds/4))**5};
}
export function panAt(x,y,enabled=true){
  return enabled?[clamp(x,-.5,.5)*parallaxAmplitude[0],-clamp(y,-.5,.5)*parallaxAmplitude[1]]:[0,0];
}

export function frameInsets(rect,width,height){
  return {top:rect.top,right:width-rect.right,bottom:height-rect.bottom,left:rect.left};
}

export const menuTiming={dim:180,collapse:380,cross:80,expand:520,character:28,rowPause:160,hide:180,brighten:260};
export function menuGridAt(width,height){
  const spacing=Math.min(333,width*.6,height*.6);
  const lines=size=>{const count=Math.max(2,Math.floor(size/spacing));return Array.from({length:count},(_,i)=>(size-1)/2+(i-(count-1)/2)*spacing);};
  return {columns:lines(width),rows:lines(height)};
}
