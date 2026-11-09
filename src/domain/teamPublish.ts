import {Channel,invoke,isTauri} from '@tauri-apps/api/core';
import {Type} from 'typebox';
import {Check} from 'typebox/value';

export interface TeamUploadProgress {phase:'preparing'|'uploading'|'processing';loaded:number;total:number;computable?:boolean}
const progressSchema=Type.Object({phase:Type.Union([Type.Literal('uploading'),Type.Literal('processing')]),loaded:Type.Integer({minimum:0}),total:Type.Integer({minimum:0})},{additionalProperties:false});
const responseSchema=Type.Object({status:Type.Integer({minimum:100,maximum:599}),body:Type.String()},{additionalProperties:false});
export const TEAM_PUBLISH_TIMEOUT_MS=300000;
export const TEAM_PUBLISH_TIMEOUT_MESSAGE='上传等待超过 5 分钟，尚未确认是否发布成功。请保留此窗口并重试同一项，不要重新准备发布。';
const interrupted='上传连接已中断，尚未确认服务器是否保存。请保留此窗口并重试同一项。';

/** Fixed publication endpoint; no automatic retry or browser fallback from native failure. */
export async function sendTeamPublication(origin:string,token:string,body:string,onProgress?:(progress:TeamUploadProgress)=>void):Promise<Response>{
 const bytes=new TextEncoder().encode(body),total=bytes.byteLength;
 if(total>500*1024*1024)throw Error('上传内容超过 500 MiB，请精简模型后重新准备发布。');
 onProgress?.({phase:'preparing',loaded:0,total});
 if(isTauri()){
  let active=true,lastLoaded=0;
  const channel=new Channel<unknown>(value=>{
   if(active&&Check(progressSchema,value)&&value.total===total&&value.loaded<=total&&value.loaded>=lastLoaded){lastLoaded=value.loaded;onProgress?.(value);}
  });
  try{
   const response:unknown=await invoke('desktop_team_publish',bytes,{headers:{'x-team-origin':origin,'x-team-token':token,'x-team-progress':channel.toJSON()}});
   if(!Check(responseSchema,response))throw Error('团队服务返回的上传响应无效，请重试同一项。');
   return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});
  }catch(error){const message=error instanceof Error?error.message:String(error);throw Error(message==='Request canceled'?interrupted:message);}
  finally{active=false;}
 }
 // Fetch preserves the existing no-redirect boundary; browsers cannot report bytes sent.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TEAM_PUBLISH_TIMEOUT_MS);
 onProgress?.({phase:'uploading',loaded:0,total,computable:false});
 try{
  const response=await fetch(origin+'/api/team/publish',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body,signal:controller.signal,redirect:'error',credentials:'omit'});
  onProgress?.({phase:'processing',loaded:total,total});
  const text=await response.text();return new Response(text,{status:response.status,headers:response.headers});
 }catch(error){if(controller.signal.aborted)throw Error(TEAM_PUBLISH_TIMEOUT_MESSAGE);throw error;}
 finally{clearTimeout(timer);}
}
