import {sanitizeDiagnostic,type DiagnosticEntry} from '../ai/runTraceLog';

export interface DiagnosticOmission {path:string;reason:string;count?:number}
/** Plain export input, also accepting the worker's snapshot-free history projection. */
export interface DiagnosticExportSnapshot {
 aiStatus?:unknown;lastRun?:unknown;aiError?:unknown;messages?:unknown;doc?:unknown;
 pendingBatch?:unknown;pendingResult?:unknown;past?:unknown;future?:unknown;runs?:unknown;
 task?:unknown;taskMetadata?:unknown;selection?:unknown;composerText?:unknown;composerImages?:unknown;liveDiagnostics?:unknown;
 aiConfig?:{apiKey?:string}|null;diagnosticApiKey?:string;diagnosticOmissions?:DiagnosticOmission[];
}
export interface DiagnosticBundle {
 format:'chat3d-diagnostics-v2';createdAt:string;data:unknown;artifacts:Record<string,unknown>;
 omissions:DiagnosticOmission[];
 /** Navigation excerpts only; full task/error text is retained in data/artifacts. */
 index:{tasks:{messageIndex:number;path:string;role:string;requestExcerpt:string;outcome?:string}[];toolErrors:{path:string;errorExcerpt?:string}[];lastRunPath:string|null};
 stats:{artifacts:number;references:number;deduplicatedValues:number;retainedTasks:number;toolRecords:number;errors:number;uniqueImages:number;modelRequests:number;providerEventsSummarized:number};
}
type Ref={$diagnosticRef:string};
type Encoded={$diagnosticEncoding:'json';value:unknown};
const secretField=/^(?:api[_-]?key|authorization|proxy-authorization|access[_-]?token|refresh[_-]?token|password|secret|token|x-chat3d-python)$/i;
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const ref=(value:unknown):value is Ref=>record(value)&&Object.keys(value).length===1&&typeof value.$diagnosticRef==='string';
// Non-recursive JSON encoding is also used when restoring JSON embedded in tool text.
// It does not invoke untrusted toJSON methods and accepts arbitrarily deep data.
function jsonText(value:unknown):string {
 const parts:string[]=[],stack:{value?:unknown;text?:string}[]=[{value}];
 while(stack.length){const job=stack.pop()!;if(job.text!==undefined){parts.push(job.text);continue;}
  const input=job.value;
  if(input===null||typeof input!=='object'){parts.push(JSON.stringify(input)??'null');continue;}
  const array=Array.isArray(input),entries=array?input.map((child,index)=>[String(index),child] as const):Object.entries(input);
  parts.push(array?'[':'{');stack.push({text:array?']':'}'});
  for(let i=entries.length-1;i>=0;i--){const [key,child]=entries[i];stack.push({value:child});if(!array)stack.push({text:JSON.stringify(key)+':'});if(i)stack.push({text:','});}
 }
 return parts.join('');
}
function operationSummary(value:unknown):unknown {
 if(!Array.isArray(value))return value;
 return {count:value.length,operations:value.map(item=>{
  if(!record(item))return item;
  const result:Record<string,unknown>={};
  for(const [key,child] of Object.entries(item)){
   if(['before','after','doc','docBefore','docAfter','inverse'].includes(key)){
    if(record(child)){if(Array.isArray(child.nodes))result[key+'NodeCount']=child.nodes.length;const materials=child.materials??child.materialIds;if(Array.isArray(materials))result[key+'MaterialCount']=materials.length;}
   }else result[key]=child;
  }
  return result;
 })};
}
function project(snapshot:DiagnosticExportSnapshot,liveDiagnostics:readonly DiagnosticEntry[]|undefined,omissions:DiagnosticOmission[]){
 const data:Record<string,unknown>={};
 for(const key of ['aiStatus','lastRun','aiError','messages','doc','pendingBatch','runs','task','taskMetadata','selection','composerText','composerImages','liveDiagnostics'] as const)if(own(snapshot,key))data[key]=snapshot[key];
 if(liveDiagnostics!==undefined)data.liveDiagnostics=liveDiagnostics;
 if(own(snapshot,'pendingResult')){
  const pending=snapshot.pendingResult;
  data.pendingResult=record(pending)?{...pending,applied:operationSummary(pending.applied)}:pending;
  if(record(pending)&&Array.isArray(pending.applied))omissions.push({path:'$.pendingResult.applied',reason:'Per-command document/inverse snapshots omitted; operation and affected-node/material counts retained. Final pending document retained.',count:pending.applied.length});
 }
 for(const key of ['past','future'] as const)if(own(snapshot,key)){
  const history=snapshot[key];data[key]=Array.isArray(history)?history.map((entry,index)=>{
   if(!record(entry))return entry;
   const {docAfter,docBefore,doc,before,after,...metadata}=entry;
   if(['docAfter','docBefore','doc','before','after'].some(field=>own(entry,field)))omissions.push({path:`$.${key}[${index}]`,reason:'Undo/redo document snapshots omitted; history metadata and commands retained.'});
   return {...metadata,...(own(entry,'applied')?{applied:operationSummary(entry.applied)}:{})};
  }):history;
 }
 if(snapshot.aiConfig)omissions.push({path:'$.aiConfig',reason:'Connection configuration is not part of task diagnostics; credentials excluded.'});
 return data;
}
function completeMessage(value:unknown){
 if(!record(value)||value.role!=='assistant'||value.error)return false;
 const stop=value.stopReason??value.finish_reason;
 return ['stop','toolUse','tool_calls','end_turn'].includes(String(stop))&&(typeof value.content==='string'||Array.isArray(value.content));
}
function providerSummary(value:unknown):Record<string,unknown>|null {
 const events=Array.isArray(value)?value:[value],usage:unknown[]=[],finish:unknown[]=[];let failed=false;
 const stack:unknown[]=[...events],seen=new WeakSet<object>();
 while(stack.length){const item=stack.pop();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
  if(record(item)){
   if(item.error||item.type==='error'||['length','content_filter','error','cancelled','max_tokens'].includes(String(item.finish_reason??item.stop_reason)))failed=true;
   if(item.usage!==undefined)usage.push(item.usage);
   if(item.finish_reason!=null)finish.push(item.finish_reason);if(item.stop_reason!=null)finish.push(item.stop_reason);
  }
  for(const child of Object.values(item))if(child&&typeof child==='object')stack.push(child);
 }
 return failed?null:{eventCount:events.length,usage,finishReasons:finish};
}
function summarizeTrace(entries:unknown[],path:string,omissions:DiagnosticOmission[],stats:DiagnosticBundle['stats']):unknown[]{
 const output=[...entries];let start=0;
 const segment=(end:number)=>{
  const messages:number[]=[];for(let i=start;i<end;i++)if(record(entries[i])&&(entries[i] as Record<string,unknown>).kind==='message'&&completeMessage((entries[i] as Record<string,unknown>).data))messages.push(i);
  // A final assistant diagnostic must follow the stream, not merely exist elsewhere in the run.
  if(messages.length)for(let i=start;i<end;i++){
   const entry=entries[i];if(!record(entry)||entry.kind!=='provider_event')continue;
   const messageIndex=messages.find(index=>index>i);if(messageIndex===undefined)continue;
   const summary=providerSummary(entry.data);if(!summary)continue;
   output[i]={...entry,data:{...summary,completeMessage:{path:`${path}[${messageIndex}].data`}}};
   omissions.push({path:`${path}[${i}].data`,reason:'Successful provider deltas duplicated by the linked complete assistant message; usage, finish reasons and event count retained.',count:summary.eventCount as number});
   stats.providerEventsSummarized+=summary.eventCount as number;
  }
 };
 for(let i=0;i<entries.length;i++)if(record(entries[i])&&(entries[i] as Record<string,unknown>).kind==='model_request'){segment(i);start=i;}
 segment(entries.length);return output;
}
interface Node {value:unknown;hash:string;size:number}
interface Frame {input:unknown;path:string;set:(node:Node)=>void;finish?:()=>void}
/** Exact structural interning: fingerprints select a bucket; shallow canonical equality
 * verifies collisions. Children are canonicalized first, so no subtree is re-encoded. */
export function createDiagnosticBundle(snapshot:DiagnosticExportSnapshot,liveDiagnostics?:readonly DiagnosticEntry[]):DiagnosticBundle {
 const omissions:DiagnosticOmission[]=[...(snapshot.diagnosticOmissions??[])];
 const apiKey=snapshot.diagnosticApiKey??snapshot.aiConfig?.apiKey;
 const index:DiagnosticBundle['index']={tasks:Array.isArray(snapshot.messages)?snapshot.messages.flatMap((message,messageIndex)=>{
  if(!record(message)||message.role!=='user')return [];
  const task:DiagnosticBundle['index']['tasks'][number]={messageIndex,path:`$.messages[${messageIndex}]`,role:'user',requestExcerpt:typeof message.text==='string'?sanitizeDiagnostic(message.text,apiKey).slice(0,160):''};
  if(typeof message.outcome==='string')task.outcome=sanitizeDiagnostic(message.outcome,apiKey).slice(0,80);
  else if(record(message.run)&&typeof message.run.status==='string')task.outcome=sanitizeDiagnostic(message.run.status,apiKey).slice(0,80);
  return [task];
 }):[],toolErrors:[],lastRunPath:snapshot.lastRun?'$.lastRun':null};
 const stats:DiagnosticBundle['stats']={artifacts:0,references:0,deduplicatedValues:0,retainedTasks:Array.isArray(snapshot.messages)?snapshot.messages.filter(message=>record(message)&&message.role==='user').length:0,toolRecords:0,errors:0,uniqueImages:0,modelRequests:0,providerEventsSummarized:0};
 const artifacts:Record<string,unknown>=Object.create(null),memo=new WeakMap<object,Node>(),active=new WeakSet<object>(),images=new Set<string>(),strings=new Map<string,Node>();
 const hash=(text:string)=>{let a=2166136261,b=5381;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}return (a>>>0).toString(36)+(b>>>0).toString(36);};
 const same=(a:unknown,b:unknown)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>value===b[index]);const ak=Object.keys(a),bk=Object.keys(b);return ak.length===bk.length&&ak.every((key,index)=>key===bk[index]&&(a as Record<string,unknown>)[key]===(b as Record<string,unknown>)[key]);};
 const canonical=new Map<string,{raw:unknown;node:Node}[]>();
 const store=(value:unknown,key:string,size:number):Node=>{
  const bucket=canonical.get(key)??[];for(const entry of bucket)if(same(entry.raw,value)){stats.deduplicatedValues++;if(ref(entry.node.value))stats.references++;return entry.node;}
  let node:Node;
  if(size>=256){const id=`a${stats.artifacts++}-${key}`,reference:Ref={$diagnosticRef:id};artifacts[id]=value;node={value:reference,hash:key,size};stats.references++;}
  else node={value,hash:key,size};
  bucket.push({raw:value,node});canonical.set(key,bucket);return node;
 };
 let root:unknown;
 const stack:Frame[]=[{input:project(snapshot,liveDiagnostics,omissions),path:'$',set:node=>{root=node.value;}}];
 while(stack.length){const frame=stack.pop()!;if(frame.finish){frame.finish();continue;}
  let input=frame.input;const {path}=frame;let generatedEncoding=false;
  const originalString=typeof input==='string'?input:undefined;
  const set=(node:Node)=>{if(originalString!==undefined)strings.set(originalString,node);frame.set(node);};
  if(typeof input==='string'){
   const cached=strings.get(input);if(cached){stats.deduplicatedValues++;if(ref(cached.value))stats.references++;set(cached);continue;}
   const trimmed=input.trim();if((trimmed.startsWith('{')&&trimmed.endsWith('}'))||(trimmed.startsWith('[')&&trimmed.endsWith(']'))){
    try{const parsed:unknown=JSON.parse(input);if(parsed&&typeof parsed==='object'){
     omissions.push({path,reason:'Embedded JSON text decoded for deduplication; original JSON-string encoding retained, insignificant whitespace/escaping normalized on expansion.'});
     input={$diagnosticEncoding:'json',value:parsed} satisfies Encoded;generatedEncoding=true;
    }}catch{/* Not JSON: retain the complete original text. */}
   }
   if(typeof input==='string'){
    const safe=sanitizeDiagnostic(input,apiKey);if(safe!==input)omissions.push({path,reason:'Credential text redacted.'});
    if(/^data:image\//i.test(safe)||(/(?:images?|image_url|screenshot|reference)/i.test(path)&&/^https?:\/\//i.test(safe)))images.add(safe);
    set(store(safe,'s'+hash(safe),safe.length+2));continue;
   }
  }
  if(input===null||typeof input!=='object'){
   if(typeof input==='function'||typeof input==='symbol'||typeof input==='undefined'){if(typeof input!=='undefined')omissions.push({path,reason:'Non-JSON runtime value omitted.'});set({value:null,hash:'null',size:4});}
   else if(typeof input==='bigint'){omissions.push({path,reason:'BigInt retained as decimal string for JSON compatibility.'});set(store(input.toString(),'s'+hash(input.toString()),input.toString().length+2));}
   else {const value=typeof input==='number'&&!Number.isFinite(input)?null:input;const text=JSON.stringify(value);set({value,hash:hash(text),size:text.length});}continue;
  }
  if(active.has(input)){omissions.push({path,reason:'Circular runtime edge replaced with a cycle marker.'});set({value:{$diagnosticCycle:true},hash:'cycle',size:25});continue;}
  const cached=memo.get(input);if(cached){stats.deduplicatedValues++;if(ref(cached.value))stats.references++;set(cached);continue;}
  if(Array.isArray(input)&&input.length>0&&input.every(value=>typeof value==='number'&&Number.isFinite(value))){
   // Mesh positions/normals/UVs dominate exports. Hash scalars incrementally,
   // avoiding one work frame/string/descriptor per coordinate and a huge join.
   let a=2166136261,b=5381,size=2;for(const value of input){const text=JSON.stringify(value)+',';size+=text.length;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b,33)^c;}}
   const node=store(input.slice(),'n'+(a>>>0).toString(36)+(b>>>0).toString(36),size);memo.set(input,node);set(node);continue;
  }
  active.add(input);const source=input;
  if(input instanceof Error){stats.errors++;index.toolErrors.push({path,errorExcerpt:sanitizeDiagnostic(input.message,apiKey).slice(0,200)});input=Object.assign({},input,{name:input.name,message:input.message,stack:input.stack,...('cause' in input?{cause:input.cause}:{})});}
  if(Array.isArray(input)&&input.some(entry=>record(entry)&&typeof entry.kind==='string'&&typeof entry.at==='number'))input=summarizeTrace(input,path,omissions,stats);
  if(record(input)&&typeof input.kind==='string'){
   if(input.kind==='model_request')stats.modelRequests++;
   if(/^tool(?:_|$)/.test(input.kind))stats.toolRecords++;
  }
  if(record(input)&&(input.error||input.failed===true||input.isError===true)){stats.errors++;const error=typeof input.error==='string'?input.error:typeof input.message==='string'?input.message:typeof input.detail==='string'?input.detail:undefined;index.toolErrors.push({path,...(error?{errorExcerpt:sanitizeDiagnostic(error,apiKey).slice(0,200)}:{})});}
  // Error/trace projections above remain objects; re-establish narrowing after
  // assigning the unknown-typed transformation result.
  if(input===null||typeof input!=='object')throw new Error('Invalid diagnostic object projection');
  const array=Array.isArray(input),output:Record<string,unknown>|unknown[]=array?[]:Object.create(null),keys=Object.keys(input),children:Node[]=[];
  if(!array)keys.sort();
  const escapeLiteral=!array&&!generatedEncoding&&keys.some(key=>/^\$diagnostic(?:Ref|Encoding|Literal|Cycle)$/.test(key));
  const kept:string[]=[];
  for(const key of keys){if(secretField.test(key)){omissions.push({path:path+'.'+key,reason:'Credential field excluded.'});continue;}if((input as Record<string,unknown>)[key]===undefined)continue;kept.push(key);}
  stack.push({input:null,path,set,finish:()=>{
   const signature=(array?'[':'{')+kept.map((key,index)=>hash(key)+':'+children[index].hash).join('|');
   const size=2+kept.reduce((total,key,index)=>total+children[index].size+(array?1:key.length+4),0);
   let value:unknown=output;
   if(escapeLiteral)value={$diagnosticLiteral:output};
   const node=store(value,hash((escapeLiteral?'literal:':'')+signature),size);memo.set(source,node);active.delete(source);set(node);
  }});
  for(let i=kept.length-1;i>=0;i--){const key=kept[i],index=i;stack.push({input:(input as Record<string,unknown>)[key],path:array?`${path}[${key}]`:`${path}.${key}`,set:node=>{children[index]=node;(output as Record<string,unknown>)[key]=node.value;}});}
 }
 stats.uniqueImages=images.size;
 return {format:'chat3d-diagnostics-v2',createdAt:new Date().toISOString(),data:root,artifacts,omissions,stats,index};
}
/** Expand only retained data. Omitted snapshots/credentials cannot be reconstructed. */
export function expandDiagnosticBundle(bundle:DiagnosticBundle):Record<string,unknown> {
 if(bundle.format!=='chat3d-diagnostics-v2')throw new Error('Unsupported diagnostics format');
 let result:unknown;
 const active=new Set<string>(),cache=new Map<string,unknown>();
 type Job={input:unknown;set:(value:unknown)=>void;finish?:()=>void;literal?:boolean};
 const stack:Job[]=[{input:bundle.data,set:value=>{result=value;}}];
 while(stack.length){const job=stack.pop()!;if(job.finish){job.finish();continue;}const {input,set}=job;
  if(!input||typeof input!=='object'){set(input);continue;}
  if(!job.literal&&ref(input)){
   const id=input.$diagnosticRef;if(cache.has(id)){set(cache.get(id));continue;}if(!own(bundle.artifacts,id))throw new Error(`Missing diagnostic artifact: ${id}`);if(active.has(id))throw new Error(`Cyclic diagnostic artifact: ${id}`);active.add(id);
   let expanded:unknown;stack.push({input:null,set,finish:()=>{active.delete(id);cache.set(id,expanded);set(expanded);}});stack.push({input:bundle.artifacts[id],set:value=>{expanded=value;}});continue;
  }
  if(!job.literal&&record(input)&&Object.keys(input).length===1&&own(input,'$diagnosticLiteral')){stack.push({input:input.$diagnosticLiteral,set,literal:true});continue;}
  if(!job.literal&&record(input)&&input.$diagnosticEncoding==='json'&&Object.keys(input).length===2&&own(input,'value')){stack.push({input:input.value,set:value=>set(jsonText(value))});continue;}
  const output:Record<string,unknown>|unknown[]=Array.isArray(input)?[]:{};stack.push({input:null,set,finish:()=>set(output)});
  const entries=Object.entries(input);for(let i=entries.length-1;i>=0;i--){const [key,child]=entries[i];stack.push({input:child,set:value=>{Object.defineProperty(output,key,{value,writable:true,enumerable:true,configurable:true});}});}
 }
 return result as Record<string,unknown>;
}
