import {Gzip,gunzipSync} from 'fflate';
import {teamFetch} from './teamTransport';

export interface TeamUploadProgress {phase:'preparing'|'uploading'|'processing';loaded:number;total:number;computable?:boolean}
export interface TeamPublicationPackage {encoding:'gzip';data:Uint8Array;digest:string}
export const TEAM_PUBLISH_TIMEOUT_MS=900000;
export const TEAM_PUBLISH_TIMEOUT_MESSAGE='上传等待超过 15 分钟，尚未确认是否发布成功。请保留此窗口并重试同一项，不要重新准备发布。';
export const TEAM_PUBLISH_CHUNK_BYTES=1024*1024;
export const TEAM_PUBLISH_MAX_BYTES=500*1024*1024;
const interrupted='上传连接已中断，尚未确认服务器是否保存。请保留此窗口并重试同一项。';
const encoder=new TextEncoder();
const safeOrigin=(origin:string)=>{try{return new URL(origin).origin;}catch{return '团队服务';}};
const networkMessage=(origin:string)=>`${interrupted} 服务：${safeOrigin(origin)}；请检查团队服务是否运行，以及代理、网关或网络是否中断上传。`;
const limitMessage='上传内容或压缩包超过 500 MiB，请精简模型后重新准备发布。';
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));
function base64(bytes:Uint8Array){let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);}

/** Deterministic, lossless gzip without allocating the entire expanded UTF-8 body. */
export async function compressTeamPublication(body:string):Promise<TeamPublicationPackage>{
 if(body.length>TEAM_PUBLISH_MAX_BYTES)throw Error(limitMessage);
 const chunks:Uint8Array[]=[];let expanded=0,compressed=0;
 const gzip=new Gzip({level:6,mtime:0},chunk=>{compressed+=chunk.length;if(compressed>TEAM_PUBLISH_MAX_BYTES)throw Error(limitMessage);chunks.push(chunk);});
 for(let offset=0;offset<body.length;){
  let end=Math.min(offset+256*1024,body.length);
  if(end<body.length&&body.charCodeAt(end-1)>=0xd800&&body.charCodeAt(end-1)<=0xdbff)end--;
  const bytes=encoder.encode(body.slice(offset,end));expanded+=bytes.length;if(expanded>TEAM_PUBLISH_MAX_BYTES)throw Error(limitMessage);
  gzip.push(bytes,end===body.length);offset=end;
 }
 if(!body.length)gzip.push(new Uint8Array(),true);
 const data=new Uint8Array(compressed);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 const hashes:string[]=[];for(let cursor=0;cursor<data.length;cursor+=TEAM_PUBLISH_CHUNK_BYTES)hashes.push(await digest(data.subarray(cursor,cursor+TEAM_PUBLISH_CHUNK_BYTES)));
 return {encoding:'gzip',data,digest:await digest(encoder.encode(hashes.join('')))};
}

/** Explicit inspection only: normal uploads never expand or parse their cached package. */
export function readTeamPublication<T=unknown>(publication:TeamPublicationPackage):T{
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(gunzipSync(publication.data))) as T;
}

/** Every size uses the same bounded resumable route; no raw/native fallback or automatic retry. */
export async function sendTeamPublication(origin:string,token:string,publication:TeamPublicationPackage,onProgress:((progress:TeamUploadProgress)=>void)|undefined,key:string):Promise<Response>{
 const {data,digest:fingerprint}=publication,total=data.byteLength;
 if(publication.encoding!=='gzip'||!total||total>TEAM_PUBLISH_MAX_BYTES)throw Error(limitMessage);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TEAM_PUBLISH_TIMEOUT_MS);
 const checkDeadline=()=>{if(controller.signal.aborted)throw Error(TEAM_PUBLISH_TIMEOUT_MESSAGE+` 服务：${safeOrigin(origin)}；请检查服务或代理的超时设置。`);};
 const request=async(path:string,value:unknown)=>{
  checkDeadline();let response:Response;
  try{response=await teamFetch(origin+'/api/team/publish-uploads/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value),signal:controller.signal,redirect:'error',credentials:'omit'});
   const text=await response.text();return new Response(text,{status:response.status,headers:response.headers});
  }catch{checkDeadline();throw Error(networkMessage(origin));}
 };
 try{
  onProgress?.({phase:'preparing',loaded:0,total});
  let response=await request('start',{key,total,digest:fingerprint,encoding:'gzip'});
  if(response.status===404)throw Error(`团队服务 ${safeOrigin(origin)} 尚未部署压缩分块上传接口，请升级团队服务及代理 /api/team/publish-uploads 路由后重试同一项；不会退回超大请求。`);
  if(!response.ok)return response;
  let state:unknown;try{state=await response.clone().json();}catch{return response;}
  if(!state||typeof state!=='object'||!('encoding' in state)||state.encoding!=='gzip'||!('uploadId' in state)||typeof state.uploadId!=='string'||!/^[a-zA-Z0-9-]+$/.test(state.uploadId)||!('offset' in state)||typeof state.offset!=='number'||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>total||!('total' in state)||state.total!==total||state.offset!==total&&state.offset%TEAM_PUBLISH_CHUNK_BYTES!==0)throw Error('团队服务返回的分块上传状态无效，请重试同一项。');
  if('result' in state){const result=state.result;if(state.offset!==total||!result||typeof result!=='object'||!('id' in result)||typeof result.id!=='string'||!('version' in result)||typeof result.version!=='number'||!Number.isSafeInteger(result.version)||result.version<1)throw Error('团队服务返回的发布结果无效。');onProgress?.({phase:'processing',loaded:total,total});return Response.json(result);}
  onProgress?.({phase:'uploading',loaded:state.offset,total,computable:true});
  for(let offset=state.offset;offset<total;){
   const chunk=data.subarray(offset,offset+TEAM_PUBLISH_CHUNK_BYTES);
   response=await request(state.uploadId+'/chunk',{offset,data:base64(chunk)});if(!response.ok)return response;
   const confirmation:unknown=await response.json();offset+=chunk.length;
   if(!confirmation||typeof confirmation!=='object'||!('encoding' in confirmation)||confirmation.encoding!=='gzip'||!('uploadId' in confirmation)||confirmation.uploadId!==state.uploadId||!('offset' in confirmation)||confirmation.offset!==offset||!('total' in confirmation)||confirmation.total!==total)throw Error('团队服务未确认上传分块，请重试同一项。');
   onProgress?.({phase:'uploading',loaded:offset,total,computable:true});
  }
  onProgress?.({phase:'processing',loaded:total,total});return await request(state.uploadId+'/complete',{});
 }finally{clearTimeout(timer);}
}
