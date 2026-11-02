import type {SceneDocument} from '../domain/types';
import {captureIsolatedGpu,isIsolatedGpuCaptureAvailable} from './isolatedGpuCapture';
import {captureSoftwareEvidence} from './softwareCapture';

// Browsing previews are local and transient: never borrow the live viewport or call a server.
const cache=new WeakMap<SceneDocument,string>();
let tail:Promise<unknown>=Promise.resolve();
export function projectThumbnail(doc:SceneDocument,signal:AbortSignal):Promise<string>{
 const request=tail.then(async()=>{
  if(signal.aborted)throw new DOMException('已停止','AbortError');
  const cached=cache.get(doc);if(cached)return cached;
  let image:string|undefined;
  if(isIsolatedGpuCaptureAvailable())try{image=await captureIsolatedGpu(doc,'perspective',undefined,undefined,signal);}catch(error){if(signal.aborted)throw error;}
  if(!image)image=(await captureSoftwareEvidence(doc,'perspective',undefined,signal)).image;
  if(signal.aborted)throw new DOMException('已停止','AbortError');
  cache.set(doc,image);return image;
 });
 tail=request.catch(()=>{});return request;
}
