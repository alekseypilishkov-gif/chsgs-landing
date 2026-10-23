import {clamp,smooth,waterEnd,openingStart} from './motion.js';

// A reverse gesture closes immediately, even within the opening chapter.
// Ignore sub-pixel scroll rounding when layout or viewport size changes.
export function openingIntentAt(intent,previous,next,ready){
  if(!ready||next<openingStart)return false;
  if(Math.abs(next-previous)<.0001)return intent;
  return next>previous;
}

// A timed actuation, independent of the distance or speed of the next scroll.
// The driven shaft stops cleanly; only the handwheel receives a small recoil.
export class QuarterTurn{
  constructor(duration=.9){if(!(duration>0&&Number.isFinite(duration)))throw Error('Invalid actuation duration');this.duration=duration;this.reset();}
  reset(){this.value=this.wheelValue=this.from=this.wheelFrom=this.goal=0;this.elapsed=this.duration;}
  step(open,seconds=1/60,reduced=false){
    const goal=open?1:0;
    if(reduced){this.value=this.wheelValue=this.from=this.wheelFrom=this.goal=goal;this.elapsed=this.duration;return false;}
    if(goal!==this.goal){this.from=this.value;this.wheelFrom=this.wheelValue;this.goal=goal;this.elapsed=0;}
    this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,Math.min(seconds,.05)));
    if(this.duration-this.elapsed<1e-9)this.elapsed=this.duration;
    const t=clamp(this.elapsed/this.duration),turn=smooth(t,0,.8),kick=.008*smooth(t,.6,.8)*(1-smooth(t,.8,1));
    this.value=this.from+(this.goal-this.from)*turn;
    this.wheelValue=this.wheelFrom+(this.goal-this.wheelFrom)*turn+(this.goal-this.from)*kick;
    if(t===1)this.value=this.wheelValue=this.goal;
    return t<1;
  }
}

// Discard every scroll request during the fill. Never queue an opening request
// behind the fill: completion releases the gate at the same physical stop.
export class FillScrollGate{
  constructor(){this.reset();}
  reset(){this.phase='idle';}
  request(progress){
    if(this.phase==='idle'&&progress>=1.90)this.phase='filling';
    return this.locked?waterEnd:progress;
  }
  update({ratio,cutaway,target}){
    if(this.locked&&ratio>=1-1e-7)this.phase='ready';
    if(this.phase==='ready'&&cutaway===0&&ratio===0&&target<1.90)this.reset();
  }
  get locked(){return this.phase==='filling';}
  get complete(){return this.phase==='ready';}
}
