import {clamp} from './terrain-motion.js';
import {counterAt,detailParallaxAt,inertialScrollAt} from './detail-motion.js';

export function createFactoryDetail(root,frames,reduced,requestFrame){
  const view=document.querySelector('#factory-detail'),trigger=document.querySelector('#factory-more'),close=view.querySelector('.detail-close'),journey=document.querySelector('#journey');
  const cue=view.querySelector('.detail-scroll-cue'),visual=view.querySelector('.factory-visual'),status=visual.querySelector('[role="status"]');
  const layers=[...view.querySelectorAll('[data-parallax]')].map(node=>({node,target:node.matches('.detail-photo')?node.querySelector('img'):node,speed:Number(node.dataset.parallax),shift:0,top:0,height:0}));
  for(const layer of layers)layer.parent=layers.find(parent=>parent!==layer&&parent.node.contains(layer.node));
  const counters=[...view.querySelectorAll('[data-count]')].map(node=>({node,value:Number(node.dataset.count),started:null,top:0}));
  const format=new Intl.NumberFormat('ru-RU');let requested=false,covered=false,phase='closed',generation=0,pending=Promise.resolve(true),animation,cueEnd=0,wheelTarget=0,wheelPosition=0,wheelActive=false,expectedScroll=null,lastScrollFrame=0;
  const stopScroll=()=>{wheelActive=false;expectedScroll=null;};
  let previousScroll=-1,visualBounds=null,scrollRange=1;
  const state=value=>{phase=value;root.dataset.detail=value;};
  function measure(){
    if(view.hidden)return;stopScroll();
    cueEnd=cue.offsetTop+cue.offsetHeight+4;
    layers.forEach(layer=>{const rect=layer.node.getBoundingClientRect();layer.top=rect.top+view.scrollTop-(layer.target===layer.node?layer.shift:0)-(layer.parent?.shift||0);layer.height=rect.height;});
    counters.forEach(item=>{item.top=item.node.getBoundingClientRect().top+view.scrollTop;});requestFrame();
    const rect=visual.getBoundingClientRect();visualBounds={left:rect.left,width:rect.width,height:rect.height,top:rect.top+view.scrollTop};scrollRange=Math.max(1,view.scrollHeight-view.clientHeight);previousScroll=-1;
  }
  async function fade(open,token){
    const from=getComputedStyle(view).opacity;animation?.cancel();
    if(reduced.matches){view.style.opacity=open?'1':'0';return token===generation;}
    animation=view.animate([{opacity:from,transform:'translateY(0)'},{opacity:open?1:0,transform:open?'translateY(0)':'translateY(-20px)'}],{duration:open?300:180,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
    const done=await animation.finished.then(()=>true,()=>false);
    if(!done||token!==generation)return false;view.style.opacity=open?'1':'0';animation.cancel();animation=null;return true;
  }
  async function run(open,token){
    if(open){
      view.hidden=false;view.inert=true;view.style.opacity='0';view.scrollTop=0;
      root.classList.add('is-detail-active');journey.inert=true;trigger.setAttribute('aria-expanded','true');
      counters.forEach(item=>{item.started=null;item.node.textContent='0';});layers.forEach(layer=>{layer.shift=0;layer.target.style.translate='0 0';});
      measure();state('opening');requestFrame();
      if(!await frames.detail(true)||token!==generation)return false;
      state('revealing');if(!await fade(true,token))return false;
      view.inert=covered;state('open');if(!covered)close.focus({preventScroll:true});requestFrame();return true;
    }
    state('closing');view.inert=true;if(!await fade(false,token))return false;
    if(!await frames.detail(false)||token!==generation)return false;
    view.hidden=true;view.scrollTop=0;root.classList.remove('is-detail-active');journey.inert=false;trigger.setAttribute('aria-expanded','false');state('closed');requestFrame();return true;
  }
  const onScroll=()=>{if(wheelActive&&expectedScroll!==null&&Math.abs(view.scrollTop-expectedScroll)>2)stopScroll();requestFrame();};
  const onWheel=event=>{
    if(covered||phase!=='open'||reduced.matches||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)){stopScroll();return;}
    event.preventDefault();const continuing=wheelActive,delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?view.clientHeight:1);
    wheelTarget=clamp((wheelActive?wheelTarget:view.scrollTop)+delta,0,Math.max(0,view.scrollHeight-view.clientHeight));wheelActive=Math.abs(wheelTarget-view.scrollTop)>1;expectedScroll=null;if(!continuing){wheelPosition=view.scrollTop;lastScrollFrame=performance.now();}requestFrame();
  };
  view.addEventListener('scroll',onScroll,{passive:true});view.addEventListener('wheel',onWheel,{passive:false});
  for(const type of ['pointerdown','touchstart','keydown'])view.addEventListener(type,stopScroll,{passive:true});
  const observer=new ResizeObserver(measure);observer.observe(view.querySelector('.detail-content'));document.fonts.ready.then(measure);
  state('closed');
  return {
    get active(){return phase!=='closed';},get requested(){return requested;},
    set(open){if(open===requested)return pending;requested=open;stopScroll();const token=++generation;animation?.cancel();pending=run(open,token);return pending;},
    cover(open){covered=open;stopScroll();view.inert=covered||phase!=='open';view.classList.toggle('is-covered',open);},
    measure,
    setModelStatus(ready){status.hidden=ready;status.textContent=ready?'':'Не удалось показать 3D-модель завода. Текст и фотографии доступны.';},
    update(now){
      if(view.hidden)return {active:false,factoryActive:false,scroll:0,progress:0,rect:null};
      if(wheelActive){
        wheelPosition=inertialScrollAt(wheelPosition,wheelTarget,now-lastScrollFrame);view.scrollTop=wheelPosition;expectedScroll=view.scrollTop;lastScrollFrame=now;
        if(Math.abs(wheelTarget-wheelPosition)<=1){view.scrollTop=wheelTarget;stopScroll();}
      }
      const scroll=view.scrollTop,height=innerHeight;
      const progress=scroll/scrollRange;
      if(scroll!==previousScroll){
        close.style.setProperty('--reading-progress',progress.toFixed(5));
        for(const layer of layers){
        layer.shift=reduced.matches?0:detailParallaxAt(height*.6-(layer.top-scroll+(layer.parent?.shift||0)+layer.height/2),layer.speed,innerWidth);
        if(layer.target!==layer.node){const limit=Math.max(0,layer.height*.12-1);layer.shift=clamp(layer.shift,-limit,limit);}
        layer.target.style.translate='0 '+layer.shift.toFixed(2)+'px';
        }
        cue.classList.toggle('is-offscreen',scroll>=cueEnd);previousScroll=scroll;
      }
      if(phase==='open'||phase==='revealing')for(const item of counters){
        if(item.started===null&&item.top-scroll<height*.88)item.started=now;
        if(item.started!==null){const value=reduced.matches?item.value:counterAt((now-item.started)/1400,item.value),text=format.format(value);if(item.node.textContent!==text)item.node.textContent=text;}
      }
      const top=visualBounds?visualBounds.top-scroll:0;
      const rect=visualBounds?{...visualBounds,top,bottom:top+visualBounds.height}:null;
      return {active:true,factoryActive:phase==='open'&&scroll>30,scroll,progress,rect};
    },
    dispose(){animation?.cancel();stopScroll();observer.disconnect();view.removeEventListener('scroll',onScroll);view.removeEventListener('wheel',onWheel);for(const type of ['pointerdown','touchstart','keydown'])view.removeEventListener(type,stopScroll);},
  };
}
