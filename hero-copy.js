const NS='http://www.w3.org/2000/svg';
export function createHeroCopy(section){
  const title=section.querySelector('h1'),subtitle=section.querySelector('p'),button=section.querySelector('.hero-button'),text=title.textContent;
  title.setAttribute('aria-label',text);
  document.documentElement.classList.add('has-hero-letter-animation');
  const svgNode=(name,attrs={})=>{const node=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);return node;};
  const nativeText=document.createElement('span');nativeText.className='hero-title-text';nativeText.textContent=text;title.replaceChildren(nativeText);
  const svg=svgNode('svg',{'class':'hero-title-art','aria-hidden':'true',focusable:'false'}),defs=svgNode('defs'),fillLayer=svgNode('g');
  const filter=svgNode('filter',{id:'hero-outline-boundary',x:'-10%',y:'-20%',width:'120%',height:'140%'});
  filter.append(svgNode('feMorphology',{in:'SourceAlpha',operator:'dilate',radius:'.7',result:'outer'}),svgNode('feMorphology',{in:'SourceAlpha',operator:'erode',radius:'.7',result:'inner'}),svgNode('feComposite',{in:'outer',in2:'inner',operator:'out',result:'border'}),svgNode('feFlood',{'flood-color':'white',result:'white'}),svgNode('feComposite',{in:'white',in2:'border',operator:'in'}));
  const mask=svgNode('mask',{id:'hero-outline-clean'}),maskText=svgNode('text',{x:'50%','text-anchor':'middle',fill:'white',filter:'url(#hero-outline-boundary)'});maskText.textContent=text;mask.append(maskText);
  const outline=svgNode('text',{'class':'hero-title-outline',mask:'url(#hero-outline-clean)',x:'50%','text-anchor':'middle'});outline.textContent=text;svg.append(defs,outline,fillLayer);title.append(svg);
  const spoken=document.createElement('span');spoken.className='hero-sr-text';spoken.textContent=[...subtitle.childNodes].map(node=>node.nodeName==='BR'?' ':node.textContent).join('');
  const visual=document.createElement('span');visual.setAttribute('aria-hidden','true');const characters=[];
  for(const node of [...subtitle.childNodes]){
    if(node.nodeName==='BR'){visual.append(document.createElement('br'));continue;}
    for(const token of node.textContent.split(/(\s+)/)){
      if(!token)continue;if(/^\s+$/.test(token)){visual.append(document.createTextNode(token));continue;}
      const word=document.createElement('span');word.className='menu-word';
      for(const char of token){const glyph=document.createElement('span');glyph.className='menu-char';glyph.textContent=char;word.append(glyph);characters.push(glyph);}visual.append(word);
    }
  }
  subtitle.replaceChildren(spoken,visual);button.tabIndex=-1;
  const context=document.createElement('canvas').getContext('2d');let height=1,length=1,last=null,typed=-1,caret=null,waves=[];
  function resize(){
    const style=getComputedStyle(title),size=parseFloat(style.fontSize),width=title.getBoundingClientRect().width;height=title.getBoundingClientRect().height;length=size*6;
    if(context)context.font=style.fontWeight+' '+style.fontSize+' '+style.fontFamily;const metrics=context?.measureText(text)||{},ascent=metrics.fontBoundingBoxAscent??size*.9,descent=metrics.fontBoundingBoxDescent??size*.25,baseline=(height-ascent-descent)/2+ascent;
    outline.setAttribute('y',baseline);maskText.setAttribute('y',baseline);outline.style.strokeDasharray=String(length);defs.replaceChildren(filter,mask);fillLayer.replaceChildren();waves=[];
    const amplitude=size*.035;
    for(let i=0;i<text.length;i++){
      if(/\s/.test(text[i]))continue;
      const point=outline.getStartPositionOfChar(i),box=outline.getExtentOfChar(i),width=Math.max(1,box.width),id='hero-liquid-fill-'+i;
      const group=svgNode('g',{transform:'translate('+point.x+' '+baseline+')'}),glyph=svgNode('text',{'class':'hero-title-fill',x:0,y:0,'clip-path':'url(#'+id+')'});glyph.textContent=text[i];group.append(glyph);fillLayer.append(group);
      const clip=svgNode('clipPath',{id,clipPathUnits:'userSpaceOnUse'}),wave=svgNode('path');
      let d='M '+(-width*3)+' '+(-height)+' L 0 '+(-height);
      for(let y=-height;y<height;y+=height/2)d+=' Q '+amplitude+' '+(y+height/8)+' 0 '+(y+height/4)+' Q '+(-amplitude)+' '+(y+height*3/8)+' 0 '+(y+height/2);
      d+=' H '+(-width*3)+' Z';wave.setAttribute('d',d);clip.append(wave);defs.append(clip);waves.push({node:wave,width,amplitude});
    }
    const state=last;last=null;if(state)update(state);
  }
  function update(state){
    if(!last||last.titleOutline!==state.titleOutline||last.titleFill!==state.titleFill){outline.style.strokeDashoffset=String((1-state.titleOutline)*length);outline.style.opacity=String(1-state.titleFill);for(const wave of waves)wave.node.style.transform='translate('+(-wave.amplitude*2+(wave.width+wave.amplitude*4)*state.titleFill)+'px,'+(Math.sin(state.titleFill*Math.PI*2)*wave.amplitude)+'px)';}
    const count=Math.floor(state.subtitle*characters.length);
    if(count!==typed){
      characters.forEach((node,i)=>node.classList.toggle('is-typed',i<count));caret?.classList.remove('is-caret','is-before');
      caret=state.subtitle>0&&state.subtitle<1?characters[Math.max(0,count-1)]:null;caret?.classList.add('is-caret');if(count===0)caret?.classList.add('is-before');typed=count;
    }
    if(!last||last.button!==state.button){button.style.opacity=String(state.button);button.style.translate='0 '+((1-state.button)*12)+'px';button.style.pointerEvents=state.button>.99?'auto':'none';button.tabIndex=state.button>.99?0:-1;}
    last=state;
  }
  const observer=new ResizeObserver(resize);observer.observe(title);document.fonts.ready.then(resize);resize();
  return {update,finish(){update({titleOutline:1,titleFill:1,subtitle:1,button:1});},dispose(){observer.disconnect();}};
}
