import {clamp,waterEnd,openingStart} from './motion.js';

// A reverse gesture starts closing, even within the opening chapter.
// Ignore sub-pixel scroll rounding when layout or viewport size changes.
export function openingIntentAt(intent,previous,next,ready){
  if(!ready||next<openingStart)return false;
  if(Math.abs(next-previous)<.0001)return intent;
  return next>previous;
}

export const handwheelTurns=100;
export const handwheelTravel=handwheelTurns*Math.PI*2;
export const actuationDuration=6;
// Only the working actuator turns the wheel. Preparing the closed ball after
// assembly leaves the source wheel orientation untouched. Opening turns it
// counterclockwise, closing clockwise, seen from the operator side.
export const handwheelAngle=(opened=0)=>handwheelTravel*opened;

// Integrate a short smooth acceleration/deceleration and constant middle
// speed. The ball moves throughout the drive instead of finishing early.
function driveProgress(seconds,duration){
  if(duration===0)return 1;
  const t=clamp(seconds/duration),r=Math.min(.35/duration,.15);
  const ramp=x=>x*x*x/(r*r)-.5*x*x*x*x/(r*r*r);
  return t<r?ramp(t)/(1-r):t>1-r?1-ramp(1-t)/(1-r):(t-r/2)/(1-r);
}

// A full 90-degree shaft travel takes six seconds and 100 wheel turns.
// Reverse from the actual position, with proportional remaining travel time.
// The small final recoil is wheel-only and remains .72 degrees, irrespective
// of the gearbox ratio. Elapsed wall time is not truncated at low frame rates.
export class QuarterTurn{
  constructor(duration=actuationDuration){if(!(duration>0&&Number.isFinite(duration)))throw Error('Invalid actuation duration');this.duration=duration;this.recoilTime=Math.min(.18,duration*.15);this.reset();}
  reset(){this.value=this.wheelValue=this.from=this.wheelFrom=this.goal=0;this.travel=this.duration-this.recoilTime;this.total=this.elapsed=this.duration;}
  step(open,seconds=1/60,reduced=false){
    const goal=open?1:0;
    if(reduced){this.value=this.wheelValue=this.from=this.wheelFrom=this.goal=goal;this.total=this.elapsed=this.duration;return false;}
    if(goal!==this.goal){
      this.from=this.value;this.wheelFrom=this.wheelValue;this.goal=goal;this.elapsed=0;
      this.travel=(this.duration-this.recoilTime)*Math.abs(goal-this.from);this.total=this.travel+this.recoilTime;
    }
    this.elapsed=Math.min(this.total,this.elapsed+(Number.isFinite(seconds)?Math.max(0,seconds):0));
    if(this.total-this.elapsed<1e-9)this.elapsed=this.total;
    const turn=driveProgress(this.elapsed,this.travel),settle=clamp((this.elapsed-this.travel)/this.recoilTime);
    const kick=Math.sin(Math.PI*settle)**2*(.72*Math.PI/180)/handwheelTravel*Math.sign(this.goal-this.wheelFrom);
    this.value=this.from+(this.goal-this.from)*turn;
    this.wheelValue=this.wheelFrom+(this.goal-this.wheelFrom)*turn+kick;
    if(this.elapsed===this.total)this.value=this.wheelValue=this.goal;
    return this.elapsed<this.total;
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
