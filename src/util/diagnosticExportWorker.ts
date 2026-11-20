import {fullRunDiagnostics,type DiagnosticExportSnapshot} from '../domain/runDiagnostics';
import type {DiagnosticEntry} from '../ai/runTraceLog';
import type {DiagnosticWorkerRequest,DiagnosticWireRecord} from './diagnosticExport';

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<DiagnosticWorkerRequest>)=>void)|null;postMessage:(value:unknown)=>void};
const values=new Map<number,unknown>();
const stringParts=new Map<number,string[]>();
const FILE_CHUNK = 64 * 1024;
class FileLimitError extends Error {}

// The bundle contains only plain JSON values. Encode bounded pieces so a
// second, contiguous copy of a large request or mesh is never needed.
function bundleBlob(bundle:unknown, maxBytes:number):Blob {
 const chunks:Blob[]=[];
 let pending='', bytes=0;
 const flush=()=>{
  if(!pending.length)return;
  const chunk=new Blob([pending]);
  pending='';
  bytes+=chunk.size;
  if(bytes>maxBytes)throw new FileLimitError();
  chunks.push(chunk);
 };
 const write=(text:string)=>{
  pending+=text;
  if(pending.length>=FILE_CHUNK)flush();
 };
 const writeValue=(value:unknown):void=>{
  if(typeof value==='string'&&value.length>FILE_CHUNK){
   write('"');
   for(let start=0;start<value.length;){
    let end=Math.min(start+FILE_CHUNK,value.length);
    // Keep a UTF-16 surrogate pair together across string fragments.
    const last=value.charCodeAt(end-1);
    if(end<value.length&&last>=0xd800&&last<=0xdbff)end--;
    write(JSON.stringify(value.slice(start,end)).slice(1,-1));
    start=end;
   }
   write('"');
  }else if(!value||typeof value!=='object'){
   write(JSON.stringify(value)??'null');
  }else if(Array.isArray(value)){
   write('[');
   if(value.length>4096&&value.every(item=>typeof item==='number')){
    for(let start=0;start<value.length;start+=4096){
     if(start)write(',');
     write(JSON.stringify(value.slice(start,start+4096)).slice(1,-1));
    }
   }else{
    for(let index=0;index<value.length;index++){
     if(index)write(',');
     writeValue(value[index]);
    }
   }
   write(']');
  }else{
   write('{');
   let first=true;
   for(const [key,child] of Object.entries(value)){
    if(child===undefined)continue;
    if(!first)write(',');
    first=false;
    writeValue(key);
    write(':');
    writeValue(child);
   }
   write('}');
  }
 };
 writeValue(bundle);
 flush();
 return new Blob(chunks,{type:'application/json'});
}
function accept(record:DiagnosticWireRecord){
 if(record.op==='container'){values.set(record.id,record.array?new Array(record.length??0):{});return;}
 if(record.op==='string'){
  const parts=stringParts.get(record.id)??[];parts.push(record.part);
  if(record.last){values.set(record.id,parts.join(''));stringParts.delete(record.id);}else stringParts.set(record.id,parts);
  return;
 }
 if(record.op==='numbers'){
  const target=values.get(record.id) as number[];
  if(!Array.isArray(target))throw new Error('诊断数字数组缺少父节点');
  for(let index=0;index<record.values.length;index++)target[record.offset+index]=record.values[index];
  return;
 }
 const target=values.get(record.id) as Record<string|number,unknown>;
 if(!target)throw new Error('诊断传输缺少父节点');
 const value=record.value&&typeof record.value==='object'?values.get(record.value.ref):record.value;
 // Define rather than assign so a diagnostic object's __proto__ is just data.
 Object.defineProperty(target,record.key,{value,writable:true,enumerable:true,configurable:true});
}
scope.onmessage=event=>{
 try{
  if(event.data.type==='chunk'){
   for(const record of event.data.records)accept(record);
   scope.postMessage({type:'ack'});return;
  }
  const root=event.data.root;
  const input=(root&&typeof root==='object'?values.get(root.ref):root) as {snapshot:DiagnosticExportSnapshot;liveDiagnostics?:DiagnosticEntry[]};
  scope.postMessage({type:'progress',message:'正在后台全量巡检、排除凭据并去重…'});
  const bundle=fullRunDiagnostics(input.snapshot,input.liveDiagnostics);
  values.clear();stringParts.clear();
  scope.postMessage({type:'progress',message:'正在后台生成 JSON 文件…'});
  const blob=bundleBlob(bundle,event.data.maxFileBytes);
  const artifacts=Object.keys(bundle.artifacts).length;
  const summary=`已准备去重诊断记录（${(blob.size/1024/1024).toFixed(2)} MB）。共享资料 ${artifacts} 项，省略说明 ${bundle.omissions.length} 项。保留消息、请求复盘、命令、错误和最终场景；连接凭据已排除，内容仍可能包含敏感信息。`;
  scope.postMessage({type:'result',blob,bytes:blob.size,summary});
 }catch(error){
  values.clear();stringParts.clear();
  scope.postMessage(error instanceof FileLimitError?{type:'limit'}:{type:'error',message:error instanceof Error?error.message:String(error)});
 }
};
