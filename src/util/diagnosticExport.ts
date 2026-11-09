/// <reference lib="es2024.promise" />
import type {DiagnosticEntry} from '../ai/runTraceLog';
import type {EditorState} from '../store';

export type DiagnosticExportInput=Pick<EditorState,'aiStatus'|'lastRun'|'aiError'|'messages'|'doc'|'pendingBatch'|'pendingResult'|'past'|'future'> & {diagnosticApiKey?:string};
export interface DiagnosticExportOptions {signal?:AbortSignal;onProgress?:(message:string)=>void}
export interface DiagnosticExportResult {blob:Blob;summary:string;bytes:number}
type WireValue=undefined|null|boolean|number|string|{ref:number};
export type DiagnosticWireRecord=
 |{op:'container';id:number;array:boolean;length?:number}
 |{op:'set';id:number;key:string|number;value:WireValue}
 |{op:'string';id:number;part:string;last:boolean}
 |{op:'numbers';id:number;offset:number;values:number[]};
export type DiagnosticWorkerRequest={type:'chunk';records:DiagnosticWireRecord[]}|{type:'finish';root:WireValue};
type WorkerReply={type:'ack'}|{type:'progress';message:string}|{type:'error';message:string}|({type:'result'}&DiagnosticExportResult);
const abortError=()=>new DOMException('已取消诊断准备','AbortError');
const checkAbort=(signal?:AbortSignal)=>{if(signal?.aborted)throw abortError();};
async function nextTurn(){const {promise,resolve}=Promise.withResolvers<void>();setTimeout(resolve,0);await promise;}
// Resolve after a paint opportunity, not merely a microtask. Hidden tabs use the timer.
function afterPaint(){const {promise,resolve}=Promise.withResolvers<void>();let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);setTimeout(resolve,0);};let frame:number|undefined;const timer=setTimeout(finish,50);if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(finish);return promise;}
async function projectSnapshot(snapshot:DiagnosticExportInput,signal?:AbortSignal){
 let deadline=performance.now()+4;
 const yieldIfNeeded=async()=>{checkAbort(signal);if(performance.now()>=deadline){await nextTurn();checkAbort(signal);deadline=performance.now()+4;}};
 const diagnosticOmissions:Array<{path:string;reason:string;count?:number}>=[];
 const applied=async(entries:EditorState['past'][number]['applied'],path:string)=>{
  const operations=[];
  for(const entry of entries){
   operations.push({command:entry.command,beforeNodeCount:entry.before?.nodes?.length??0,beforeMaterialCount:entry.before?.materialIds?.length??0,afterNodeCount:entry.after?.nodes?.length??0,afterMaterialCount:entry.after?.materialIds?.length??0});
   await yieldIfNeeded();
  }
  diagnosticOmissions.push({path,reason:'逐步应用的场景/节点/材质快照重复；保留命令与变更数量，最终场景单独保留',count:entries.length});
  return {count:entries.length,operations};
 };
 const history=async(entries:EditorState['past'],path:string)=>{
  const result=[];
  for(let index=0;index<entries.length;index++){
   const entry=entries[index];
   result.push({id:entry.id,createdAt:entry.createdAt,source:entry.source,summary:entry.summary,bytes:entry.bytes,createdMaterialIds:entry.createdMaterialIds,applied:await applied(entry.applied,`${path}[${index}].applied`)});
   diagnosticOmissions.push({path:`${path}[${index}].docAfter`,reason:'撤销历史的中间场景快照不用于排障；保留该步命令与操作摘要'});
   await yieldIfNeeded();
  }
  return result;
 };
 const pendingResult=snapshot.pendingResult?{doc:snapshot.pendingResult.doc,errors:snapshot.pendingResult.errors,applied:await applied(snapshot.pendingResult.applied,'pendingResult.applied')}:null;
 return {aiStatus:snapshot.aiStatus,lastRun:snapshot.lastRun,aiError:snapshot.aiError,messages:snapshot.messages,doc:snapshot.doc,pendingBatch:snapshot.pendingBatch,pendingResult,past:await history(snapshot.past,'past'),future:await history(snapshot.future,'future'),diagnosticApiKey:snapshot.diagnosticApiKey,diagnosticOmissions};
}

// Stream bounded pieces instead of synchronously structured-cloning a 200 MB graph.
// Identity and equal strings are sent once. All semantic compaction stays in the worker.
function* graphRecords(value:unknown,root:(value:WireValue)=>void):Generator<DiagnosticWireRecord>{
 const objects=new WeakMap<object,number>(),strings=new Map<string,number>();let nextId=0;
 function* visit(input:unknown):Generator<DiagnosticWireRecord,WireValue>{
  if(typeof input==='string'){
   if(input.length<1024)return input;
   const existing=strings.get(input);if(existing!==undefined)return {ref:existing};
   const id=nextId++;strings.set(input,id);
   for(let offset=0;offset<input.length;offset+=65536)yield {op:'string',id,part:input.slice(offset,offset+65536),last:offset+65536>=input.length};
   return {ref:id};
  }
  if(input===null||input===undefined||typeof input==='number'||typeof input==='boolean')return input;
  if(typeof input!=='object')throw new Error('诊断快照包含不可导出的值：'+typeof input);
  const existing=objects.get(input);if(existing!==undefined)return {ref:existing};
  const id=nextId++;objects.set(input,id);
  const array=Array.isArray(input),length=array?input.length:0;yield {op:'container',id,array,...(array?{length}:{})};
  if(array){
   for(let index=0;index<length;){
    if(typeof input[index]==='number'){
     const offset=index,numbers:number[]=[];
     while(index<length&&numbers.length<8192&&typeof input[index]==='number')numbers.push(input[index++]);
     yield {op:'numbers',id,offset,values:numbers};
    }else {yield {op:'set',id,key:index,value:yield* visit(input[index])};index++;}
   }
  }
  else {
   // Error.message and stack are non-enumerable and must survive transport.
   if(input instanceof Error){for(const key of ['name','message','stack'] as const)yield {op:'set',id,key,value:yield* visit(input[key])};}
   for(const key in input)if(Object.prototype.hasOwnProperty.call(input,key))yield {op:'set',id,key,value:yield* visit((input as Record<string,unknown>)[key])};
  }
  return {ref:id};
 }
 root(yield* visit(value));
}

export async function prepareDiagnosticExport(snapshot:DiagnosticExportInput,liveDiagnostics?:readonly DiagnosticEntry[],{signal,onProgress}:DiagnosticExportOptions={}):Promise<DiagnosticExportResult>{
 checkAbort(signal);onProgress?.('正在准备排障记录…');await afterPaint();checkAbort(signal);
 let worker:Worker|undefined;
 try{
  const projected=await projectSnapshot(snapshot,signal);
  checkAbort(signal);
  worker=new Worker(new URL('./diagnosticExportWorker.ts',import.meta.url),{type:'module',name:'diagnostic-export'});
  const activeWorker=worker;
  const progress=(event:MessageEvent<WorkerReply>)=>{if(event.data.type==='progress')onProgress?.(event.data.message);};
  worker.addEventListener('message',progress);
  let workerFailure:Error|undefined;
  worker.addEventListener('error',event=>{event.preventDefault();workerFailure=new Error(event.message||'诊断后台准备失败');});
  worker.addEventListener('messageerror',()=>{workerFailure=new Error('无法接收诊断后台结果');});
  const exchange=(request:DiagnosticWorkerRequest,expected:'ack'|'result')=>{
   const {promise,resolve,reject}=Promise.withResolvers<WorkerReply>();
   if(workerFailure){reject(workerFailure);return promise;}
   const cleanup=()=>{activeWorker.removeEventListener('message',message);activeWorker.removeEventListener('error',error);activeWorker.removeEventListener('messageerror',messageError);signal?.removeEventListener('abort',abort);};
   const fail=(reason:unknown)=>{cleanup();reject(reason);};
   const message=(event:MessageEvent<WorkerReply>)=>{if(event.data.type==='error')fail(new Error(event.data.message));else if(event.data.type===expected){cleanup();resolve(event.data);}};
   const error=(event:ErrorEvent)=>{event.preventDefault();fail(new Error(event.message||'诊断后台准备失败'));};
   const messageError=()=>fail(new Error('无法接收诊断后台结果'));
   const abort=()=>fail(abortError());
   activeWorker.addEventListener('message',message);activeWorker.addEventListener('error',error);activeWorker.addEventListener('messageerror',messageError);signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return promise;}
   try{activeWorker.postMessage(request);}catch(error){fail(error);}
   return promise;
  };
  onProgress?.('正在分批传送必要记录…');
  let root:WireValue=undefined,records:DiagnosticWireRecord[]=[],characters=0,deadline=performance.now()+4;
  const flush=async()=>{if(records.length){const batch=records;records=[];characters=0;await exchange({type:'chunk',records:batch},'ack');}await nextTurn();checkAbort(signal);deadline=performance.now()+4;};
  for(const record of graphRecords({snapshot:projected,liveDiagnostics},value=>{root=value;})){
   checkAbort(signal);records.push(record);characters+=record.op==='string'?record.part.length:record.op==='numbers'?record.values.length*8:record.op==='set'&&typeof record.value==='string'?record.value.length:32;
   if(characters>=131072||records.length>=1024||performance.now()>=deadline)await flush();
  }
  await flush();checkAbort(signal);onProgress?.('正在后台去重并生成文件…');
  const result=await exchange({type:'finish',root},'result');
  if(result.type!=='result')throw new Error('诊断后台没有返回文件');
  return {blob:result.blob,summary:result.summary,bytes:result.bytes};
 }finally{worker?.terminate();}
}
