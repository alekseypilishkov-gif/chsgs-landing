const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function circleBelow(radius,height){
  if(radius<=0||height<=-radius)return 0;if(height>=radius)return Math.PI*radius*radius;
  return radius*radius*Math.acos(-height/radius)+height*Math.sqrt(Math.max(0,radius*radius-height*height));
}

// Conservative 1D free-surface model. Cells store water volume in the circular
// passage; face flows accelerate under gravity and retain momentum. The closed
// sphere removes the actual downstream capacity.
export class PipeFluid{
  constructor({start,end,radius,ballRadius,cells=128,gravity=40,drag=2.8,viscosity=.04,surfaceDiffusion=.2}){
    if(!(end>start&&radius>0&&ballRadius>radius&&Number.isInteger(cells)&&cells>=8))throw Error('Invalid fluid channel');
    Object.assign(this,{start,end,radius,ballRadius,cells,gravity,drag,viscosity,surfaceDiffusion});this.dx=(end-start)/cells;
    this.volumes=new Float64Array(cells);this.capacity=new Float64Array(cells);this.heights=new Float64Array(cells);this.flows=new Float64Array(cells-1);this.tables=[];
    this.incoming=new Float64Array(cells);this.outgoing=new Float64Array(cells);this.changes=new Float64Array(cells);
    this.previousFlows=new Float64Array(cells-1);
    this.transportFlows=new Float64Array(cells-1);
    this.target=0;this.volume=0;this.time=0;this.active=false;this.levels=96;
    for(let i=0;i<cells;i++){
      const x=start+(i+.5)*this.dx,inner=Math.sqrt(Math.max(0,ballRadius*ballRadius-x*x)),table=new Float64Array(this.levels+1);
      for(let j=0;j<=this.levels;j++){const y=-radius+2*radius*j/this.levels;table[j]=Math.max(0,circleBelow(radius,y)-circleBelow(Math.min(inner,radius),y))*this.dx;}
      this.tables.push(table);this.capacity[i]=table[this.levels];
    }
    this.totalCapacity=this.capacity.reduce((a,b)=>a+b,0);this.heights.fill(-radius);
  }
  heightFor(i,volume){
    const table=this.tables[i];if(volume<=1e-12)return -this.radius;if(volume>=this.capacity[i]-1e-12)return this.radius;
    let a=0,b=this.levels;while(b-a>1){const m=(a+b)>>1;if(table[m]>volume)b=m;else a=m;}
    const f=(volume-table[a])/(table[b]-table[a]);return -this.radius+2*this.radius*(a+f)/this.levels;
  }
  volumeFor(i,height){
    const t=clamp((height+this.radius)/(2*this.radius),0,1)*this.levels,a=Math.min(this.levels-1,Math.floor(t));
    return this.tables[i][a]+(this.tables[i][a+1]-this.tables[i][a])*(t-a);
  }
  setFill(fill,snap=false){
    const next=clamp(fill,0,1)*this.totalCapacity;
    if(next!==this.target){this.target=next;this.active=true;}
    if(next===0){this.volumes.fill(0);this.heights.fill(-this.radius);this.flows.fill(0);this.volume=0;this.active=false;}
    else if(snap){this.volume=next;this.equilibrate();this.active=false;}
  }
  equilibrate(){
    let a=-this.radius,b=this.radius;
    for(let j=0;j<32;j++){const h=(a+b)/2,sum=this.tables.reduce((v,_,i)=>v+this.volumeFor(i,h),0);if(sum<this.volume)a=h;else b=h;}
    const height=(a+b)/2;
    for(let i=0;i<this.cells;i++){this.volumes[i]=this.volumeFor(i,height);this.heights[i]=height;}
    this.flows.fill(0);
  }
  step(seconds){
    if(!this.active)return false;
    const duration=clamp(seconds,0,.05),maxStep=Math.min(.0025,.3*this.dx/Math.sqrt(this.gravity*2*this.radius),.2*this.dx*this.dx/(this.viscosity+this.surfaceDiffusion));
    const steps=Math.max(1,Math.ceil(duration/maxStep)),dt=duration/steps;
    for(let s=0;s<steps;s++){
      this.time+=dt;
      // Once an upstream cell is full, inflow continues through it. Rewind
      // removes the latest wet end while retaining the free-surface dynamics.
      let delta=clamp(this.target-this.volume,-this.totalCapacity*.45*dt,this.totalCapacity*.45*dt);
      const adding=delta>0;delta=Math.abs(delta);
      for(let j=0;j<this.cells&&delta>1e-12;j++){
        const i=adding?j:this.cells-1-j,amount=Math.min(delta,adding?this.capacity[i]-this.volumes[i]:this.volumes[i]);
        this.volumes[i]+=adding?amount:-amount;this.volume+=adding?amount:-amount;delta-=amount;
      }
      for(let i=0;i<this.cells;i++)this.heights[i]=this.heightFor(i,this.volumes[i]);
      this.incoming.fill(0);this.outgoing.fill(0);this.changes.fill(0);
      this.previousFlows.set(this.flows);
      for(let i=0;i<this.flows.length;i++){
        const area=(this.volumes[i]+this.volumes[i+1])/(2*this.dx),head=this.heights[i]-this.heights[i+1];
        const prior=this.previousFlows[i],lap=this.previousFlows[Math.max(0,i-1)]+this.previousFlows[Math.min(this.flows.length-1,i+1)]-2*prior;
        const q=(prior+this.viscosity*lap*dt/(this.dx*this.dx)+this.gravity*area*head*dt/this.dx)*Math.exp(-this.drag*dt);
        this.flows[i]=q;
        // Conservative wetting regularization resolves the shallow leading
        // edge without a vertical dry-cell jump or negative water volumes.
        const transport=q+this.surfaceDiffusion*area*head/this.dx;this.transportFlows[i]=transport;
        const a=transport>0?i:i+1,b=transport>0?i+1:i,amount=Math.abs(transport)*dt;
        this.outgoing[a]+=amount;this.incoming[b]+=amount;
      }
      for(let i=0;i<this.flows.length;i++){
        const q=this.transportFlows[i],a=q>0?i:i+1,b=q>0?i+1:i;
        const limiter=Math.min(1,this.volumes[a]/Math.max(1e-15,this.outgoing[a]),(this.capacity[b]-this.volumes[b])/Math.max(1e-15,this.incoming[b]));
        const amount=Math.abs(q)*dt*Math.max(0,limiter);this.flows[i]*=Math.max(0,limiter);this.changes[a]-=amount;this.changes[b]+=amount;
      }
      for(let i=0;i<this.cells;i++)this.volumes[i]=clamp(this.volumes[i]+this.changes[i],0,this.capacity[i]);
    }
    for(let i=0;i<this.cells;i++)this.heights[i]=this.heightFor(i,this.volumes[i]);
    const massReady=Math.abs(this.target-this.volume)<this.totalCapacity*1e-7;
    const filled=this.volume>this.totalCapacity*(1-1e-7),velocity=Math.max(...this.flows.map(Math.abs));
    const spread=Math.max(...this.heights)-Math.min(...this.heights);
    if(massReady&&(filled||(spread<.002&&velocity<.0008))){this.equilibrate();this.active=false;}
    return this.active;
  }
  get ratio(){return this.volume/this.totalCapacity;}
  get front(){for(let i=this.cells-1;i>=0;i--)if(this.volumes[i]>this.capacity[i]*.002)return this.start+(i+1)*this.dx;return this.start;}
}
