// A product supplies assets and an adapter; the scroll/render loop stays shared.
export function resolveProfile(data,url){
  if(data.schemaVersion!==1||!data.id||!data.name)throw Error('Unsupported product profile');
  if((data.cutaway!==undefined&&typeof data.cutaway!=='boolean')||(data.cutaway&&!data.installation))throw Error('Invalid cutaway profile');
  if((data.water!==undefined&&typeof data.water!=='boolean')||(data.water&&!data.cutaway))throw Error('Invalid water profile');
  if((data.opening!==undefined&&typeof data.opening!=='boolean')||(data.opening&&!data.water))throw Error('Invalid valve-opening profile');
  if(!Array.isArray(data.chapters)||data.chapters.length!==(data.opening?9:data.water?8:data.cutaway?7:data.installation?6:5)||!data.chapters.every(s=>typeof s==='string'&&s.length))throw Error('Invalid product chapter labels');
  if(data.installation&&(!Array.isArray(data.installation.direction)||data.installation.direction.length!==3||!data.installation.direction.every(Number.isFinite)||!(data.installation.direction[2]>0)||!Number.isFinite(data.installation.frameMargin)||!(data.installation.frameMargin>=1)||(data.installation.pipeLength!==undefined&&(!Number.isFinite(data.installation.pipeLength)||data.installation.pipeLength<=0))))throw Error('Invalid installation settings');
  if(data.installation?.elbow){const {radius,straight}=data.installation.elbow;if(!(radius>.426&&Number.isFinite(straight)&&straight>=0&&(data.installation.pipeLength??4.2)>straight+radius*Math.PI/2))throw Error('Invalid elbow settings');}
  const camera=data.camera;
  if(!camera||!(camera.fov>0&&camera.fov<120)||!(camera.near>0&&camera.far>camera.near)||!Array.isArray(camera.automaticDirection)||camera.automaticDirection.length!==3||!camera.automaticDirection.every(Number.isFinite)||!(camera.automaticDirection[2]>0)||!['desktop','mobile'].every(k=>Number.isFinite(camera.margin?.[k])&&camera.margin[k]>=1)||!Number.isFinite(camera.mobileExplodedRotation))throw Error('Invalid product camera');
  if(!(data.wireOpacity>0&&data.wireOpacity<=1))throw Error('Invalid wire opacity');
  const local=path=>{if(typeof path!=='string'||!path)throw Error('Missing product resource');const result=new URL(path,url);if(result.origin!==new URL(url).origin)throw Error('Product resources must be same-origin');return result.href;};
  if(data.assets?.prepared&&!/^[a-f0-9]{64}$/.test(data.preparedSHA256||''))throw Error('Missing prepared revision');
  const assets=Object.fromEntries(['model','drawing','fallback'].map(key=>[key,local(data.assets?.[key])]));
  if(data.assets?.prepared)assets.prepared=local(data.assets.prepared)+'?v='+data.preparedSHA256;
  return {...data,url:String(url),adapterURL:local(data.adapter),assetURLs:assets};
}
export async function loadProfile(url){
  const response=await fetch(url);if(!response.ok)throw Error('Product profile '+response.status);
  return resolveProfile(await response.json(),url);
}
