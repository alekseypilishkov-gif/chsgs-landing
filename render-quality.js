export const renderInterval=1000/60;
export function renderPixelRatio(dpr,low){return Math.min(dpr,low?1.25:1.75);}
export function createRenderQuality(low=false){
  let elapsed=0,frames=0;
  return {
    get low(){return low;},
    sample(dt){
      if(low||dt<=0||dt>250)return false;
      elapsed+=dt;frames++;
      if(elapsed<2500)return false;
      const slow=elapsed/frames>24;elapsed=frames=0;
      if(slow){low=true;return true;}return false;
    },
  };
}
