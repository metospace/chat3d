import {Channel,invoke,isTauri} from '@tauri-apps/api/core';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import {teamFetch} from './teamTransport';

export interface TeamUploadProgress {phase:'preparing'|'uploading'|'processing';loaded:number;total:number;computable?:boolean}
const progressSchema=Type.Object({phase:Type.Union([Type.Literal('uploading'),Type.Literal('processing')]),loaded:Type.Integer({minimum:0}),total:Type.Integer({minimum:0})},{additionalProperties:false});
const responseSchema=Type.Object({status:Type.Integer({minimum:100,maximum:599}),body:Type.String()},{additionalProperties:false});
export const TEAM_PUBLISH_TIMEOUT_MS=900000;
export const TEAM_PUBLISH_TIMEOUT_MESSAGE='上传等待超过 15 分钟，尚未确认是否发布成功。请保留此窗口并重试同一项，不要重新准备发布。';
export const TEAM_PUBLISH_CHUNK_BYTES=1024*1024;
const SMALL_PUBLICATION_BYTES=8*1024*1024,MAX_PUBLICATION_BYTES=416*1024*1024;
const interrupted='上传连接已中断，尚未确认服务器是否保存。请保留此窗口并重试同一项。';
const encoder=new TextEncoder();
const safeOrigin=(origin:string)=>{try{return new URL(origin).origin;}catch{return '团队服务';}};
const networkMessage=(origin:string)=>`${interrupted} 服务：${safeOrigin(origin)}；请检查团队服务是否运行，以及代理、网关或网络是否中断上传。`;

/** Encode bounded slices, preserving UTF-16 surrogate pairs and exact UTF-8 chunk boundaries. */
function* publicationChunks(body:string):Generator<Uint8Array>{
 let chunk=new Uint8Array(TEAM_PUBLISH_CHUNK_BYTES),used=0;
 for(let offset=0;offset<body.length;){
  let end=Math.min(offset+256*1024,body.length);
  if(end<body.length&&body.charCodeAt(end-1)>=0xd800&&body.charCodeAt(end-1)<=0xdbff)end--;
  const bytes=encoder.encode(body.slice(offset,end));offset=end;
  for(let cursor=0;cursor<bytes.length;){const length=Math.min(chunk.length-used,bytes.length-cursor);chunk.set(bytes.subarray(cursor,cursor+length),used);used+=length;cursor+=length;if(used===chunk.length){yield chunk;chunk=new Uint8Array(TEAM_PUBLISH_CHUNK_BYTES);used=0;}}
 }
 if(used)yield chunk.subarray(0,used);
}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));
function base64(bytes:Uint8Array){let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);}

// Compatibility for direct four-argument callers: locate only the top-level key,
// without parsing/copying a potentially hundreds-of-MiB payload object.
function publicationKey(body:string){
 let depth=0;
 for(let index=0;index<body.length;index++){
  const char=body[index];if(char==='{'||char==='['){depth++;continue;}if(char==='}'||char===']'){depth--;continue;}if(char!=='"')continue;
  const start=index++;for(;index<body.length;index++){if(body[index]==='\\'){index++;continue;}if(body[index]==='"')break;}
  if(depth!==1||index-start!==4||body.slice(start,index+1)!=='"key"')continue;
  let value=index+1;while(/\s/.test(body[value]??'')&&value<body.length)value++;if(body[value++]!==':')continue;
  while(/\s/.test(body[value]??'')&&value<body.length)value++;
  const match=/^"([a-zA-Z0-9-]{16,80})"/.exec(body.slice(value,value+83));if(match)return match[1];
 }
 throw Error('发布重试标识无效，请重新准备发布。');
}

async function sendChunked(origin:string,token:string,body:string,onProgress:((progress:TeamUploadProgress)=>void)|undefined,key:string):Promise<Response>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TEAM_PUBLISH_TIMEOUT_MS);
 const checkDeadline=()=>{if(controller.signal.aborted)throw Error(TEAM_PUBLISH_TIMEOUT_MESSAGE+` 服务：${safeOrigin(origin)}；请检查服务或代理的超时设置。`);};
 const request=async(path:string,value:unknown)=>{
  checkDeadline();let response:Response;
  try{response=await teamFetch(origin+'/api/team/publish-uploads/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value),signal:controller.signal,redirect:'error',credentials:'omit'});
   const text=await response.text();return new Response(text,{status:response.status,headers:response.headers});
  }catch{checkDeadline();throw Error(networkMessage(origin));}
 };
 try{
  let total=0;const hashes:string[]=[];
  onProgress?.({phase:'preparing',loaded:0,total:0});
  for(const chunk of publicationChunks(body)){checkDeadline();total+=chunk.length;if(total>MAX_PUBLICATION_BYTES)throw Error('上传内容超过 416 MiB，请精简模型后重新准备发布。');hashes.push(await digest(chunk));}
  const fingerprint=await digest(encoder.encode(hashes.join('')));checkDeadline();
  let response=await request('start',{key,total,digest:fingerprint});
  if(response.status===404)throw Error(`团队服务 ${safeOrigin(origin)} 尚未部署大模型分块上传接口，请升级团队服务及代理 /api/team/publish-uploads 路由后重试同一项；不会退回超大请求。`);
  if(!response.ok)return response;
  const state:unknown=await response.json();
  if(!state||typeof state!=='object'||!('uploadId' in state)||typeof state.uploadId!=='string'||!/^[a-zA-Z0-9-]+$/.test(state.uploadId)||!('offset' in state)||typeof state.offset!=='number'||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>total||!('total' in state)||state.total!==total||state.offset!==total&&state.offset%TEAM_PUBLISH_CHUNK_BYTES!==0)throw Error('团队服务返回的分块上传状态无效，请重试同一项。');
  if('result' in state){const result=state.result;if(state.offset!==total||!result||typeof result!=='object'||!('id' in result)||typeof result.id!=='string'||!('version' in result)||typeof result.version!=='number'||!Number.isSafeInteger(result.version)||result.version<1)throw Error('团队服务返回的发布结果无效。');onProgress?.({phase:'processing',loaded:total,total});return Response.json(result);}
  const resume=state.offset;let offset=0;
  onProgress?.({phase:'uploading',loaded:resume,total,computable:true});
  for(const chunk of publicationChunks(body)){
   if(offset<resume){offset+=chunk.length;continue;}
   response=await request(state.uploadId+'/chunk',{offset,data:base64(chunk)});if(!response.ok)return response;
   const confirmation:unknown=await response.json();offset+=chunk.length;
   if(!confirmation||typeof confirmation!=='object'||!('uploadId' in confirmation)||confirmation.uploadId!==state.uploadId||!('offset' in confirmation)||confirmation.offset!==offset||!('total' in confirmation)||confirmation.total!==total)throw Error('团队服务未确认上传分块，请重试同一项。');
   onProgress?.({phase:'uploading',loaded:offset,total,computable:true});
  }
  onProgress?.({phase:'processing',loaded:total,total});return await request(state.uploadId+'/complete',{});
 }finally{clearTimeout(timer);}
}

/** No automatic retry, redirect, or enormous-request fallback from chunk/native failure. */
export async function sendTeamPublication(origin:string,token:string,body:string,onProgress?:(progress:TeamUploadProgress)=>void,key?:string):Promise<Response>{
 if(body.length>MAX_PUBLICATION_BYTES)throw Error('上传内容超过 416 MiB，请精简模型后重新准备发布。');
 // ASCII size is a lower bound: never allocate the entire large UTF-8 body.
 const bytes=body.length<=SMALL_PUBLICATION_BYTES?encoder.encode(body):undefined;
 if(!bytes||bytes.byteLength>SMALL_PUBLICATION_BYTES)return sendChunked(origin,token,body,onProgress,key??publicationKey(body));
 const total=bytes.byteLength;onProgress?.({phase:'preparing',loaded:0,total});
 if(isTauri()){
  let active=true,lastLoaded=0;
  const channel=new Channel<unknown>(value=>{if(active&&Check(progressSchema,value)&&value.total===total&&value.loaded<=total&&value.loaded>=lastLoaded){lastLoaded=value.loaded;onProgress?.(value);}});
  try{const response:unknown=await invoke('desktop_team_publish',bytes,{headers:{'x-team-origin':origin,'x-team-token':token,'x-team-progress':channel.toJSON()}});if(!Check(responseSchema,response))throw Error('团队服务返回的上传响应无效，请重试同一项。');return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});}
  catch(error){const message=error instanceof Error?error.message:String(error);throw Error(message==='Request canceled'?networkMessage(origin):message);}
  finally{active=false;}
 }
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TEAM_PUBLISH_TIMEOUT_MS);
 onProgress?.({phase:'uploading',loaded:0,total,computable:false});
 try{const response=await fetch(origin+'/api/team/publish',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body,signal:controller.signal,redirect:'error',credentials:'omit'});onProgress?.({phase:'processing',loaded:total,total});const text=await response.text();return new Response(text,{status:response.status,headers:response.headers});}
 catch{if(controller.signal.aborted)throw Error(TEAM_PUBLISH_TIMEOUT_MESSAGE+` 服务：${safeOrigin(origin)}；请检查服务或代理的超时设置。`);throw Error(networkMessage(origin));}
 finally{clearTimeout(timer);}
}
