const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const areaBelow=(r,h)=>h<=-r?0:h>=r?Math.PI*r*r:r*r*Math.acos(-h/r)+h*Math.sqrt(Math.max(0,r*r-h*h));

// Conservative transport downstream of the valve. Inlet flux follows the
// actual opening on both strokes; stored water drains after complete closure.
// Transport speed is a presentation parameter, not a hydraulic model.
export class FlowChannel{
  constructor({end,radius=.4055,boreRadius=.3895,cells=144,route=null,speed=2.6}){
    if(!(Number.isFinite(end)&&end>0&&radius>=boreRadius&&boreRadius>0&&Number.isInteger(cells)&&cells>=16&&speed>0))throw Error('Invalid flow passage');
    Object.assign(this,{start:0,end,radius,boreRadius,cells,route});this.dx=end/cells;this.maxFlux=Math.PI*boreRadius*boreRadius*speed;
    this.volumes=new Float64Array(cells);this.previous=new Float64Array(cells);this.capacity=new Float64Array(cells);this.heights=new Float64Array(cells);this.speeds=new Float64Array(cells);this.fluxes=new Float64Array(cells+1);this.radii=new Float64Array(cells);
    this.tables=[];this.levels=96;
    for(let i=0;i<cells;i++){
      const x=(i+.5)*this.dx,r=this.radiusAt(x);
      // Equal full-bore discharge at every section keeps the downward elbow
      // completely flooded when open instead of thinning into a falling film.
      this.radii[i]=r;this.capacity[i]=Math.PI*r*r*this.dx;this.speeds[i]=this.maxFlux/(Math.PI*r*r);
      this.tables.push(Float64Array.from({length:this.levels+1},(_,j)=>areaBelow(r,-r+2*r*j/this.levels)*this.dx));
    }
    this.totalCapacity=this.capacity.reduce((a,b)=>a+b,0);this.maxSpeed=Math.max(...this.speeds);this.reset();
  }
  radiusAt(x){const t=clamp((Math.abs(x)-.51)/.02);return this.boreRadius+(this.radius-this.boreRadius)*t;}
  reset(){this.volumes.fill(0);this.previous.fill(0);for(let i=0;i<this.cells;i++)this.heights[i]=-this.radii[i];this.fluxes.fill(0);this.volume=this.incoming=this.outgoing=this.inletFlux=this.outletFlux=0;this.active=this.moving=false;}
  heightFor(i,volume){
    if(volume<=1e-12)return -this.radii[i];if(volume>=this.capacity[i]-1e-12)return this.radii[i];
    const table=this.tables[i];let a=0,b=this.levels;while(b-a>1){const m=(a+b)>>1;if(table[m]>volume)b=m;else a=m;}
    return -this.radii[i]+2*this.radii[i]*(a+(volume-table[a])/(table[b]-table[a]))/this.levels;
  }
  step(seconds,{opening=0,feeding=false,reduced=false}={}){
    this.previous.set(this.volumes);
    const desired=feeding?this.maxFlux*Math.sin(clamp(opening)*Math.PI/2)**2:0;
    if(reduced){
      const previous=this.volume;
      for(let i=0;i<this.cells;i++)this.volumes[i]=Math.min(this.capacity[i],desired/this.speeds[i]*this.dx);
      this.volume=this.volumes.reduce((a,b)=>a+b,0);if(this.volume>=previous)this.incoming+=this.volume-previous;else this.outgoing+=previous-this.volume;
      this.inletFlux=this.outletFlux=desired;this.active=false;
    }else{
      const duration=Math.max(0,Math.min(seconds,.05)),steps=Math.max(1,Math.ceil(duration/(.6*this.dx/this.maxSpeed))),dt=duration/steps;
      for(let step=0;step<steps;step++){
        const f=this.fluxes;f[0]=desired;
        for(let i=0;i<this.cells;i++)f[i+1]=this.speeds[i]*this.volumes[i]/this.dx;
        // Limit incoming flux against capacity plus the water leaving in the
        // same step; propagate bottlenecks upstream without losing volume.
        if(dt>0)for(let i=this.cells-1;i>=0;i--)f[i]=Math.min(f[i],Math.max(0,(this.capacity[i]-this.volumes[i])/dt+f[i+1]));
        for(let i=0;i<this.cells;i++)this.volumes[i]=Math.max(0,Math.min(this.capacity[i],this.volumes[i]+(f[i]-f[i+1])*dt));
        this.incoming+=f[0]*dt;this.outgoing+=f[this.cells]*dt;this.inletFlux=f[0];this.outletFlux=f[this.cells];
      }
      this.volume=this.volumes.reduce((a,b)=>a+b,0);
      if(!feeding&&this.volume<this.totalCapacity*1e-7){this.outgoing+=this.volume;this.volumes.fill(0);this.volume=this.inletFlux=this.outletFlux=0;}
      this.active=desired>0||this.volume>0;
    }
    this.moving=false;
    for(let i=0;i<this.cells;i++){this.heights[i]=this.heightFor(i,this.volumes[i]);if(!reduced&&Math.abs(this.volumes[i]-this.previous[i])>this.capacity[i]*1e-6)this.moving=true;}
    return this.moving;
  }
  get ratio(){return this.volume/this.totalCapacity;}
  get front(){for(let i=this.cells-1;i>=0;i--)if(this.volumes[i]>this.capacity[i]*.001)return (i+1)*this.dx;return 0;}
  get tail(){for(let i=0;i<this.cells;i++)if(this.volumes[i]>this.capacity[i]*.001)return i*this.dx;return this.end;}
}
