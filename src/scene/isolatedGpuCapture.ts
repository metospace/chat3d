import {loadRenderPreset} from './renderPreset';
import {loadRenderQuality} from './renderQuality';
import type {SceneDocument} from '../domain/types';
import type {CaptureView} from './capture';
import type {Viewport} from './Viewport';
type Capture=(doc:SceneDocument,view:CaptureView,targetIds?:string[],time?:number,signal?:AbortSignal)=>Promise<string>;

/** Serializes only renderer access. Model/tool streams remain independent. */
export function serializeCapture(capture:Capture):Capture {
 let tail:Promise<unknown>=Promise.resolve();
 return (doc,view,ids,time,signal)=>{
  const pending=tail.then(async()=>{
   if(signal?.aborted)throw new DOMException('已停止','AbortError');
   const result=await capture(doc,view,ids,time,signal);
   if(signal?.aborted)throw new DOMException('已停止','AbortError');
   return result;
  });
  tail=pending.catch(()=>{});return pending;
 };
}
let viewport:Viewport|null=null,host:HTMLDivElement|null=null,failed=false,recoveryRequested=false;
export const isIsolatedGpuCaptureAvailable=()=>!failed&&typeof document!=='undefined'&&!!document.body&&typeof WebGL2RenderingContext!=='undefined';
// A user-requested renderer retry resets failure only at the next serialized lease.
export function resetIsolatedGpuCapture(){failed=false;recoveryRequested=true;}
function dispose(){viewport?.dispose();viewport=null;host?.remove();host=null;}
/** Dedicated scene/camera/WebGL context. Never registers as the active UI viewport. */
export const captureIsolatedGpu=serializeCapture(async(doc,view,ids,time,signal)=>{
 if(recoveryRequested){dispose();recoveryRequested=false;}
 if(!isIsolatedGpuCaptureAvailable())throw Error('独立 WebGL 检查器不可用');
 try{
  if(!viewport){
   const {Viewport:Renderer}=await import('./Viewport');
   if(signal?.aborted)throw new DOMException('已停止','AbortError');
   host=document.createElement('div');host.setAttribute('aria-hidden','true');
   Object.assign(host.style,{position:'fixed',left:'-12000px',top:'0',width:'1024px',height:'768px',pointerEvents:'none',overflow:'hidden'});
   document.body.appendChild(host);
   viewport=new Renderer(host,()=>{});viewport.setGridVisible(false);
  }
  // captureDocument draws synchronously after its texture readiness barrier.
  // The serial lease covers that barrier, rendering, copy, and state restoration.
  viewport.setRenderPreset(loadRenderPreset());
  viewport.setRenderQuality(loadRenderQuality());
  return await viewport.captureDocument(doc,view,ids,time);
 }catch(error){
  if(!signal?.aborted){dispose();failed=true;}
  throw error;
 }
});
