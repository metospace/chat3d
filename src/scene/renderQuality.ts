export type RenderQuality='auto'|'high'|'balanced'|'fast';
export type RenderTier=Exclude<RenderQuality,'auto'>;
export const RENDER_QUALITY_KEY='chat3d.renderQuality.v1';
export const RENDER_TIERS={high:{pixelRatio:2,shadowSize:2048,contactShadows:true},balanced:{pixelRatio:1.5,shadowSize:2048,contactShadows:false},fast:{pixelRatio:1,shadowSize:1024,contactShadows:false}} as const;
export const normalizeRenderQuality=(value:unknown):RenderQuality=>value==='high'||value==='balanced'||value==='fast'?value:'auto';
let sessionQuality:RenderQuality='auto';
export function loadRenderQuality():RenderQuality{try{return sessionQuality=normalizeRenderQuality(localStorage.getItem(RENDER_QUALITY_KEY));}catch{return sessionQuality;}}
export function saveRenderQuality(value:RenderQuality){sessionQuality=value;try{localStorage.setItem(RENDER_QUALITY_KEY,value);}catch{/* Session preference still works. */}}

/** Only observe successive real draws. Idle time, initial shader compilation,
 * captures and tab switches must not downgrade an on-demand viewport. */
export class AdaptiveRenderQuality{
 tier:RenderTier;private elapsed=0;private count=0;private warmup=8;
 constructor(public mode:RenderQuality,private smallDevice=false){this.tier=this.initialTier();}
 private initialTier():RenderTier{return this.mode==='auto'?(this.smallDevice?'balanced':'high'):this.mode;}
 setMode(mode:RenderQuality){this.mode=mode;this.tier=this.initialTier();this.warmup=8;this.resetSamples();}
 resetSamples(){this.elapsed=0;this.count=0;}
 sample(intervalMs:number):boolean{
  if(this.mode!=='auto'||!Number.isFinite(intervalMs)||intervalMs<1||intervalMs>250){this.resetSamples();return false;}
  if(this.warmup>0){this.warmup--;return false;}
  this.elapsed+=intervalMs;this.count++;
  if(this.elapsed<3000||this.count<30)return false;
  const slow=this.elapsed/this.count>25;this.resetSamples();
  if(!slow||this.tier==='fast')return false;
  this.tier=this.tier==='high'?'balanced':'fast';this.warmup=8;return true;
 }
}
