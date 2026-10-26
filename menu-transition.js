import {clamp,frameInsets,menuGridAt,menuTiming as time} from './terrain-motion.js';
import {detailFrameAt} from './detail-motion.js';

export function createMenuTransition(root,menu,guides,shade,reduced){
  const detailShade=root.querySelector('.detail-shade');
  const links=[...menu.querySelectorAll('.menu-links a')],list=menu.querySelector('.menu-links'),contacts=menu.querySelector('.menu-contacts');
  const base=['left','right','top','bottom'].map(side=>({node:guides.querySelector('.screen-guide--'+side),axis:['left','right'].includes(side)?'columns':'rows',property:side,fraction:['right','bottom'].includes(side)?1:0,extra:false}));
  let lines=[...base],requested=false,phase='closed',generation=0,intent=0,target=null,pending=Promise.resolve(true),detailMode=false,detailRequested=false;
  const animations=new Map(),waiters=new Set();
  const chars=links.map(link=>{
    const title=link.querySelector('.menu-title'),words=title.textContent.trim().split(/\s+/),result=[];
    title.setAttribute('aria-hidden','true');title.replaceChildren();
    words.forEach((word,index)=>{if(index)title.append(' ');const group=document.createElement('span');group.className='menu-word';
      for(const char of word){const node=document.createElement('span');node.className='menu-char';node.textContent=char;group.append(node);result.push(node);}title.append(group);
    });return result;
  });
  const width=()=>guides.getBoundingClientRect().width,height=()=>guides.getBoundingClientRect().height;
  const frame=()=>{const x=clamp(width()*.02,12,48),y=clamp(height()*.01,8,16);return {columns:[x,width()-x-1],rows:[y,height()-y-1]};};
  const cross=()=>({columns:[(width()-1)/2,(width()-1)/2],rows:[(height()-1)/2,(height()-1)/2]});
  const grid=()=>menuGridAt(width(),height());
  const backgroundFrame=()=>detailRequested?detailFrameAt(width(),height()):frame();
  const closedState=()=>detailRequested?'detail-open':'closed';
  const coordinate=(line,layout)=>{const values=layout[line.axis],p=values[0]+(values.at(-1)-values[0])*line.fraction;return line.property==='right'?width()-p-1:line.property==='bottom'?height()-p-1:p;};
  const state=value=>{phase=value;root.dataset.menu=value;};
  const alive=token=>token===generation;
  function clearText(){links.forEach(link=>link.classList.remove('is-printing','is-printed'));chars.flat().forEach(node=>node.classList.remove('is-typed','is-caret','is-before'));}
  function removeExtras(){for(const line of lines)if(line.extra)line.node.remove();lines=[...base];}
  function addExtras(layout){
    removeExtras();for(const axis of ['columns','rows'])layout[axis].slice(1,-1).forEach((_,index)=>{
      const node=document.createElement('span'),vertical=axis==='columns';node.className='screen-guide screen-guide--grid '+(vertical?'screen-guide--vertical':'screen-guide--horizontal');
      const line={node,axis,property:vertical?'left':'top',fraction:(index+1)/(layout[axis].length-1),extra:true};node.style[line.property]=coordinate(line,cross())+'px';node.style.opacity='0';guides.append(node);lines.push(line);
    });
  }
  function stop(){
    const frozen=lines.map(line=>[line,getComputedStyle(line.node)[line.property],getComputedStyle(line.node).opacity]);
    const shadeOpacity=getComputedStyle(shade).opacity,detailOpacity=getComputedStyle(detailShade).opacity,listOpacity=getComputedStyle(list).opacity,contactOpacity=getComputedStyle(contacts).opacity;
    generation++;for(const animation of animations.keys())animation.cancel();animations.clear();for(const finish of [...waiters])finish(false);
    guides.classList.add('is-morphing');for(const [line,position,opacity] of frozen){line.node.style[line.property]=position;line.node.style.opacity=opacity;}
    shade.style.opacity=shadeOpacity;detailShade.style.opacity=detailOpacity;list.style.opacity=listOpacity;contacts.style.opacity=contactOpacity;target=null;guides.classList.remove('is-active');
  }
  function pause(duration,token){return new Promise(resolve=>{let timer;const finish=ok=>{clearTimeout(timer);waiters.delete(finish);resolve(ok&&alive(token));};waiters.add(finish);timer=setTimeout(()=>finish(true),duration);});}
  async function animate(node,to,duration,token){
    const style=getComputedStyle(node),from=Object.fromEntries(Object.keys(to).map(key=>[key,style[key]]));
    const animation=node.animate([from,to],{duration,easing:'cubic-bezier(.75,0,.25,1)',fill:'forwards'});animations.set(animation,node);
    const completed=await animation.finished.then(()=>true,()=>false);animations.delete(animation);
    if(!completed||!alive(token))return false;
    Object.assign(node.style,to);animation.cancel();return true;
  }
  async function move(layout,duration,token,extraOpacity=1){return (await Promise.all(lines.map(line=>animate(line.node,{[line.property]:coordinate(line,layout)+'px',opacity:String(line.extra?extraOpacity:1)},duration,token)))).every(Boolean);}
  function place(layout){for(const line of lines){line.node.style[line.property]=coordinate(line,layout)+'px';line.node.style.opacity='1';}}
  function complete(open){
    detailMode=!open&&detailRequested;state(open?'open':closedState());guides.classList.remove('is-morphing');menu.inert=!open;
    document.querySelector('#journey').inert=open||detailRequested;if(!open){menu.hidden=true;root.classList.remove('is-menu-active');}
  }
  function snap(open){
    stop();root.classList.toggle('is-menu-active',open);menu.hidden=!open;clearText();list.style.opacity='1';contacts.style.opacity=open?'1':'0';shade.style.opacity=open?'.9':'0';
    guides.classList.toggle('is-detail-frame',!open&&detailRequested);guides.classList.toggle('is-menu-grid',open);if(open){const layout=grid();addExtras(layout);place(layout);links.forEach(link=>link.classList.add('is-printed'));chars.flat().forEach(node=>node.classList.add('is-typed'));}else{removeExtras();place(backgroundFrame());}
    complete(open);
  }
  async function type(token){
    for(let row=0;row<links.length;row++){
      const letters=chars[row];links[row].classList.add('is-printing');letters[0]?.classList.add('is-caret','is-before');let caret=letters[0];
      for(const node of letters){if(!alive(token))return false;caret?.classList.remove('is-caret','is-before');node.classList.add('is-typed','is-caret');caret=node;if(!await pause(time.character,token))return false;}
      if(!await pause(time.rowPause,token))return false;caret?.classList.remove('is-caret');links[row].classList.replace('is-printing','is-printed');
    }return true;
  }
  async function run(open,token){
    if(open){
      root.classList.add('is-menu-active');guides.classList.remove('is-detail-frame');document.querySelector('#journey').inert=true;menu.hidden=false;menu.inert=true;clearText();list.style.opacity='1';contacts.style.opacity='0';state('dimming');
      if(!await animate(shade,{opacity:'.9'},time.dim,token))return false;
      state('collapsing-open');if(!await move(cross(),time.collapse,token,0))return false;
      state('crosshair-open');if(!await pause(time.cross,token))return false;
      const layout=grid();addExtras(layout);guides.classList.add('is-menu-grid');state('expanding-grid');
      if(!await move(layout,time.expand,token))return false;
      state('typing');if(!await type(token))return false;if(!await animate(contacts,{opacity:'1'},240,token))return false;complete(true);return true;
    }
    menu.inert=true;state('hiding');chars.flat().forEach(node=>node.classList.remove('is-caret','is-before'));
    if(!(await Promise.all([list,contacts].map(node=>animate(node,{opacity:'0'},time.hide,token)))).every(Boolean))return false;
    state('collapsing-close');if(!await move(cross(),time.collapse,token,0))return false;
    state('crosshair-close');if(!await pause(time.cross,token))return false;
    removeExtras();guides.classList.remove('is-menu-grid');guides.classList.toggle('is-detail-frame',detailRequested);state('expanding-frame');if(!await move(backgroundFrame(),time.expand,token))return false;
    state('brightening');if(!await animate(shade,{opacity:'0'},time.brighten,token))return false;
    clearText();list.style.opacity='1';complete(false);return true;
  }
  function snapDetail(open){
    stop();removeExtras();guides.classList.remove('is-menu-grid','is-active');guides.classList.toggle('is-detail-frame',open);place(open?detailFrameAt(width(),height()):frame());detailShade.style.opacity=open?'.5':'0';detailMode=open;state(open?'detail-open':'closed');guides.classList.remove('is-morphing');
  }
  async function runDetail(open,token){
    guides.classList.remove('is-menu-grid','is-active');removeExtras();state(open?'detail-dimming':'detail-collapsing-close');
    if(open&&!await animate(detailShade,{opacity:'.5'},180,token))return false;
    state(open?'detail-collapsing-open':'detail-collapsing-close');if(!await move(cross(),380,token,0))return false;
    state('detail-crosshair');if(!await pause(70,token))return false;
    guides.classList.toggle('is-detail-frame',open);state(open?'detail-expanding':'detail-restoring');
    if(!await move(open?detailFrameAt(width(),height()):frame(),560,token))return false;
    if(!open&&!await animate(detailShade,{opacity:'0'},200,token))return false;
    detailMode=open;state(open?'detail-open':'closed');guides.classList.remove('is-morphing');return true;
  }
  state('closed');
  return {
    get target(){return target;},get active(){return !detailMode&&phase!=='closed';},get busy(){return !['closed','open','detail-open'].includes(phase);},
    set(open){
      if(open===requested)return pending;requested=open;detailMode=false;const action=++intent;stop();const token=generation;
      if(reduced.matches){snap(open);pending=Promise.resolve(true);}else pending=run(open,token).then(done=>done||(action===intent&&phase===(open?'open':closedState())));return pending;
    },
    detail(open){
      detailRequested=open;detailMode=true;requested=false;const action=++intent;stop();const token=generation;
      if(reduced.matches){snapDetail(open);pending=Promise.resolve(true);}else pending=runDetail(open,token).then(done=>done||(action===intent&&phase===(open?'detail-open':'closed')));return pending;
    },
    focus(node){
      if(detailMode)return;
      if(phase!=='closed'&&phase!=='open')return;if(reduced.matches||node?.matches(':disabled'))node=null;
      const rect=node?.getBoundingClientRect();if(rect&&(!rect.width||!rect.height))node=null;
      if(node===target)return;stop();target=node;guides.classList.toggle('is-active',!!node);const token=generation;
      let layout=requested?grid():frame();
      if(node){const inset=frameInsets(rect,width(),height());layout={columns:[inset.left,width()-inset.right-1],rows:[inset.top,height()-inset.bottom-1]};}
      const tasks=lines.map(line=>{
        if(line.extra)return animate(line.node,{opacity:node?'0':'1'},180,token);
        return animate(line.node,{[line.property]:coordinate(line,layout)+'px',opacity:'1'},600,token);
      });
      Promise.all(tasks).then(()=>{if(alive(token))guides.classList.remove('is-morphing');});
    },
    finish(){if(detailMode)snapDetail(detailRequested);else snap(requested);pending=Promise.resolve(true);},
    dispose(){stop();},
  };
}
