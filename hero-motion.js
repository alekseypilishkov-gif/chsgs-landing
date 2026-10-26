const clamp=n=>Math.max(0,Math.min(1,n));
const progress=(seconds,start,end)=>seconds>=end?1:clamp((seconds-start)/(end-start));
const smooth=n=>{const t=clamp(n);return t*t*(3-2*t);};
export const assemblyEnd=2.8,copyStart=3,rotationSpeed=14,rotationStart=.25,morphEvery=100,morphSpan=18;
export const outlineEnd=copyStart+.65,fillStart=outlineEnd+.04,fillEnd=fillStart+.75,subtitleStart=fillEnd+.08,subtitleEnd=subtitleStart+.85,buttonStart=subtitleEnd+.08,copyEnd=buttonStart+.4;
export function heroAt(seconds,{reduced=false,models=3}={}){
  if(reduced)return {assembly:1,particles:false,copy:true,angle:0,from:0,to:1%models,morph:0,titleOutline:1,titleFill:1,subtitle:1,button:1,copyStage:'complete',stage:'complete'};
  const angle=Math.max(0,seconds-rotationStart)*rotationSpeed,cycle=Math.floor(angle/morphEvery),part=angle-cycle*morphEvery;
  return {assembly:progress(seconds,1.2,assemblyEnd),particles:seconds>=.25&&seconds<assemblyEnd,copy:seconds>=copyStart,angle,from:cycle%models,to:(cycle+1)%models,morph:smooth((part-(morphEvery-morphSpan))/morphSpan),titleOutline:progress(seconds,copyStart,outlineEnd),titleFill:progress(seconds,fillStart,fillEnd),subtitle:progress(seconds,subtitleStart,subtitleEnd),button:progress(seconds,buttonStart,copyEnd),copyStage:seconds<copyStart?'hidden':seconds<fillStart?'outline':seconds<subtitleStart?'fill':seconds<buttonStart?'subtitle':seconds<copyEnd?'button':'complete',stage:seconds<.25?'frame':seconds<1.2?'particles':seconds<assemblyEnd?'assembly':seconds<copyEnd?'copy':'complete'};
}

export function ambientAt(seconds,seed=0){
  const elapsed=seconds-copyEnd-2;if(elapsed<0)return [];
  const burst=Math.floor(elapsed/14),phase=elapsed-burst*14;
  const random=n=>((Math.sin(n*127.1+seed*19.7)*43758.5453)%1+1)%1;
  const count=1+Math.floor(random(burst*7+1)*3),particles=[];
  for(let i=0;i<count;i++){
    const key=burst*31+i*5+5,duration=7+random(key)*2,t=(phase-random(key+1)*1.2)/duration;
    if(t<=0||t>=1)continue;
    particles.push({x:-1.1+t*2.2,y:-.75+random(key+2)*1.5+Math.sin(t*Math.PI)*.02,alpha:smooth(t*8)*smooth((1-t)*8)*.55});
  }
  return particles;
}
