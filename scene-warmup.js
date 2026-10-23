import * as THREE from './vendor/three.module.js';

// Preparation uses the actual renderer, scene and camera: transmission targets
// are cached per scene/camera. No fluid solver or narrative state is advanced.
export function createSceneWarmup(renderer,scene,camera,{signal,textures=[],onReady=()=>{},onError=()=>{},schedule=callback=>{
  if(globalThis.requestIdleCallback)return {id:requestIdleCallback(callback,{timeout:250}),idle:true};
  return {id:setTimeout(callback,16),idle:false};
},unschedule=handle=>handle.idle?cancelIdleCallback(handle.id):clearTimeout(handle.id)}={}){
  const meshes=[];scene.traverse(object=>{if(object.isMesh||object.userData.warmup)meshes.push(object);});
  const liquid=meshes.filter(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(material=>material.transmission>0));
  const opaque=meshes.filter(mesh=>!liquid.includes(mesh));
  const scratch=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  const stats={state:'preparing',startedAt:performance.now(),tasks:0,maxTaskMs:0,parallel:renderer.extensions.has('KHR_parallel_shader_compile')};
  let cancelled=false,handle=null,wake=null,disposed=false;
  const cleanup=()=>{if(!disposed){scratch.dispose();disposed=true;}};
  function cancel(){cancelled=true;if(handle){unschedule(handle);handle=null;}wake?.();cleanup();}
  signal?.addEventListener('abort',cancel,{once:true});
  const check=()=>{if(cancelled||signal?.aborted||renderer.getContext().isContextLost())throw new DOMException('Warmup cancelled','AbortError');};
  async function pause(ms){
    check();await new Promise(resolve=>{wake=resolve;handle={id:setTimeout(()=>{handle=null;wake=null;resolve();},ms),idle:false};});check();
  }
  async function turn(){
    check();await new Promise(resolve=>{
      wake=resolve;const resume=deadline=>{
        if(deadline&&!deadline.didTimeout&&deadline.timeRemaining()<4){handle=schedule(resume);return;}
        handle=null;wake=null;resolve();
      };handle=schedule(resume);
    });check();
    // A background tab need not consume GPU time. Cancellation still wakes it.
    while(globalThis.document?.hidden)await pause(250);
  }
  function work(fn){check();const start=performance.now();try{return fn();}finally{stats.tasks++;stats.maxTaskMs=Math.max(stats.maxTaskMs,performance.now()-start);}}
  async function compile(objects,transmission=false){
    for(let i=0;i<objects.length;i+=6){
      await turn();
      const proxies=new THREE.Group(),sides=new Map(),target=renderer.getRenderTarget();
      for(const object of objects.slice(i,i+6)){
        proxies.add(object.isInstancedMesh?new THREE.InstancedMesh(object.geometry,object.material,1):object.isLineSegments?new THREE.LineSegments(object.geometry,object.material):new THREE.Mesh(object.geometry,object.material));
        if(transmission)for(const material of Array.isArray(object.material)?object.material:[object.material])if(material.transmission>0&&!sides.has(material)){sides.set(material,material.side);material.side=THREE.BackSide;material.needsUpdate=true;}
      }
      work(()=>{try{if(transmission)renderer.setRenderTarget(scratch);renderer.compile(proxies,camera,scene);}finally{renderer.setRenderTarget(target);for(const [material,side] of sides){material.side=side;material.needsUpdate=true;}}});
      // Same non-blocking completion check as the bundled compileAsync, but
      // owned here so context loss/retry can cancel polling before disposal.
      const programs=[...renderer.info.programs];
      while(true){
        check();if(globalThis.document?.hidden){await pause(250);continue;}
        if(programs.every(program=>program.isReady()))break;
        // Completion polling is cheap; an idle-budget wait here can starve
        // preparation during scrolling even after the GPU has finished.
        await pause(10);
      }
    }
  }
  const done=(async()=>{
    try{
      // Normal output and the linear, untone-mapped transmission pass require
      // different programs. In that pass only the liquid back faces are used.
      await compile(meshes);
      if(liquid.length)await compile([...opaque,...liquid],true);
      await turn();work(()=>{
        for(const texture of textures.filter(Boolean)){if(texture.version===0)texture.needsUpdate=true;renderer.initTexture(texture);}
      });
      // Prime uniform locations, attributes and buffers in small batches. The
      // one-pixel default-framebuffer scissor preserves the visible scene;
      // transmission itself still allocates its real full-size target.
      for(let i=0;i<meshes.length;i+=3){await turn();work(()=>renderWarmupPass(renderer,scene,camera,meshes.slice(i,i+3)));}
      await turn();work(()=>renderWarmupPass(renderer,scene,camera,meshes));
      stats.state='ready';stats.finishedAt=performance.now();cleanup();onReady();
    }catch(error){const aborted=cancelled||signal?.aborted||error.name==='AbortError';stats.state=aborted?'cancelled':'failed';stats.finishedAt=performance.now();cleanup();if(!aborted)onError(error);}
    finally{signal?.removeEventListener('abort',cancel);}
    return stats;
  })();
  async function refresh(){
    if(cancelled||stats.state!=='ready')return;
    stats.state='preparing';
    try{await turn();work(()=>renderWarmupPass(renderer,scene,camera,meshes));stats.state='ready';stats.refreshes=(stats.refreshes||0)+1;stats.refreshedAt=performance.now();onReady();}
    catch(error){const aborted=cancelled||signal?.aborted||error.name==='AbortError';stats.state=aborted?'cancelled':'failed';if(!aborted)onError(error);}
  }
  return {stats,done,cancel,refresh,get ready(){return stats.state==='ready'||stats.state==='failed';}};
}

export function renderWarmupPass(renderer,scene,camera,selected){
  const visibility=[],frusta=[],scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),target=renderer.getRenderTarget();
  scene.traverse(object=>{visibility.push([object,object.visible]);if(!object.isLight)object.visible=!(object.isMesh||object.isLine||object.isPoints||object.isSprite);});
  for(const object of selected){object.visible=true;frusta.push([object,object.frustumCulled]);object.frustumCulled=false;}
  try{
    renderer.setRenderTarget(null);renderer.setScissor(0,0,1,1);renderer.setScissorTest(true);
    renderer.render(scene,camera);
  }finally{
    for(const [object,visible] of visibility)object.visible=visible;
    for(const [object,culled] of frusta)object.frustumCulled=culled;
    renderer.setRenderTarget(target);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
  }
}
