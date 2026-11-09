import {Channel,invoke} from '@tauri-apps/api/core';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {BlenderExecutionProgress} from '../ai/blenderProgress';
const progressSchema=Type.Object({stage:Type.Union(['starting','executing','saving','exporting','rendering','reading','completed'].map(value=>Type.Literal(value))),message:Type.String({maxLength:200})},{additionalProperties:false});

const statusSchema=Type.Object({available:Type.Boolean(),reason:Type.Optional(Type.String())},{additionalProperties:false});
export type DesktopBlenderStatus=Static<typeof statusSchema>;
export async function desktopBlenderStatus(connect=false):Promise<DesktopBlenderStatus>{
 const status:unknown=await invoke(connect?'desktop_blender_connect':'desktop_blender_status');
 if(!Check(statusSchema,status))throw Error('桌面 Blender 状态响应无效，请安装完整的最新客户端。');
 return status;
}

/** Native response is length-framed raw bytes; no base64/JSON artifact expansion. */
export function desktopBlenderArtifacts(payload:unknown):{blend:Blob;glb:Blob;render:Blob}{
 if(!(payload instanceof ArrayBuffer)||payload.byteLength<12)throw Error('桌面 Blender 未返回完整原始文件。');
 const view=new DataView(payload),lengths=[view.getUint32(0,true),view.getUint32(4,true),view.getUint32(8,true)];
 const caps=[32,20,8].map(m=>m*1024*1024);
 if(lengths.some((n,i)=>n<12||n>caps[i])||lengths.reduce((sum,n)=>sum+n,12)!==payload.byteLength)throw Error('桌面 Blender 文件长度无效。');
 const blend=new Uint8Array(payload,12,lengths[0]),glb=new Uint8Array(payload,12+lengths[0],lengths[1]),render=new Uint8Array(payload,12+lengths[0]+lengths[1],lengths[2]);
 const prefix=(bytes:Uint8Array,text:string)=>[...text].every((c,i)=>bytes[i]===c.charCodeAt(0));
 const glbHeader=new DataView(glb.buffer,glb.byteOffset,glb.byteLength),pngHeader=new DataView(render.buffer,render.byteOffset,render.byteLength);
 if(!prefix(blend,'BLENDER')||glb.length<20||!prefix(glb,'glTF')||glbHeader.getUint32(4,true)!==2||glbHeader.getUint32(8,true)!==glb.length||render.length<33||![137,80,78,71,13,10,26,10].every((n,i)=>render[i]===n)||!prefix(render.subarray(12),'IHDR')||[16,20].some(offset=>pngHeader.getUint32(offset,false)<1||pngHeader.getUint32(offset,false)>768))throw Error('桌面 Blender 原始文件格式无效。');
 return {blend:new Blob([blend],{type:'application/octet-stream'}),glb:new Blob([glb],{type:'model/gltf-binary'}),render:new Blob([render],{type:'image/png'})};
}
export async function runDesktopBlender(script:string,signal?:AbortSignal,onProgress?:(progress:BlenderExecutionProgress)=>void):Promise<{blend:Blob;glb:Blob;render:Blob}>{
 signal?.throwIfAborted();
 const requestId=crypto.randomUUID();
 let active=true;
 const onEvent=new Channel<unknown>(event=>{if(active&&!signal?.aborted&&Check(progressSchema,event))onProgress?.(event);});
 const cancel=()=>{void invoke('desktop_blender_cancel',{requestId}).catch(()=>{});};
 // Native cancellation remembers request IDs even if dispatch overtakes reservation.
 const pending=invoke<unknown>('desktop_blender_run',{requestId,script,onProgress:onEvent});
 signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)cancel();
 try{
  const payload=await pending;
  signal?.throwIfAborted();
  return desktopBlenderArtifacts(payload);
 }finally{active=false;signal?.removeEventListener('abort',cancel);}
}
