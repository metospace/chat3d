// Keep each structured-clone request bounded without serializing or cloning the source graph.
export const IDB_GRAPH_ARRAY_CHUNK=16384;
export const IDB_GRAPH_STRING_CHUNK=65536;
const RECORD_BYTES=512*1024;
const INLINE_STRING=1024;
type Atom=null|undefined|boolean|number|bigint|string|{ref:number};
type Part=
 |{type:'object';id:number;entries:[Atom,Atom][]}
 |{type:'array';id:number;length:number;start:number;values:Atom[]}
 |{type:'string';id:number;start:number;length:number;text:string};
export interface IdbGraphRecord {parts:Part[]}
export interface IdbGraphRoot {format:'idb-graph';version:1;value:Atom;recordCount:number}
const own=(value:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(value,key);
const invalid=()=>new Error('分块存储数据不完整或格式无效');

/** Emits sequential records synchronously. Only bounded fragments, never the whole graph, are copied. */
export function encodeIdbValue(value:unknown,onRecord:(id:number,record:IdbGraphRecord)=>void):IdbGraphRoot{
 const seen=new WeakMap<object,number>(),strings=new Map<string,number>();
 const pending:{id:number;value:object|string}[]=[];let nextId=0,recordCount=0,parts:Part[]=[],bytes=0,items=0;
 const flush=()=>{if(parts.length){onRecord(recordCount++,{parts});parts=[];bytes=0;items=0;}};
 const append=(part:Part,size:number,count:number)=>{
  if(bytes+size>RECORD_BYTES||items+count>IDB_GRAPH_ARRAY_CHUNK||parts.length>=1024)flush();
  parts.push(part);bytes+=size;items+=count;
 };
 const atom=(input:unknown):Atom=>{
  if(typeof input==='string'){
   if(input.length<=INLINE_STRING)return input;
   let id=strings.get(input);if(id===undefined){id=nextId++;strings.set(input,id);pending.push({id,value:input});}return {ref:id};
  }
  if(input===null||input===undefined||typeof input==='boolean'||typeof input==='number'||typeof input==='bigint')return input;
  if(typeof input!=='object')throw new DOMException('无法保存函数或符号','DataCloneError');
  const prototype=Object.getPrototypeOf(input);
  if(!Array.isArray(input)&&prototype!==Object.prototype&&prototype!==null)throw new DOMException('仅支持普通对象和数组','DataCloneError');
  let id=seen.get(input);if(id===undefined){id=nextId++;seen.set(input,id);pending.push({id,value:input});}return {ref:id};
 };
 const size=(input:Atom)=>typeof input==='string'?input.length*2+16:24;
 const rootValue=atom(value);
 for(let cursor=0;cursor<pending.length;cursor++){
  const {id,value:input}=pending[cursor];
  if(typeof input==='string'){
   for(let start=0;start<input.length;start+=IDB_GRAPH_STRING_CHUNK){const text=input.slice(start,start+IDB_GRAPH_STRING_CHUNK);append({type:'string',id,start,length:input.length,text},text.length*2+64,1);}
   continue;
  }
  if(Array.isArray(input)){
   if(!input.length)append({type:'array',id,length:0,start:0,values:[]},64,1);
   for(let start=0;start<input.length;){
    const values:Atom[]=[];let estimate=64,length=0;
    while(start+length<input.length&&length<IDB_GRAPH_ARRAY_CHUNK){
     const present=own(input,start+length),item=present?atom(input[start+length]):undefined,itemBytes=present?size(item):0;
     if(length&&estimate+itemBytes>RECORD_BYTES)break;
     if(present)values[length]=item;length++;values.length=length;estimate+=itemBytes;
    }
    append({type:'array',id,length:input.length,start,values},estimate,length);start+=length;
   }
  }
  let entries:[Atom,Atom][]=[],estimate=64;
  const emit=()=>{append({type:'object',id,entries},estimate,Math.max(1,entries.length));entries=[];estimate=64;};
  for(const key in input){
   if(!own(input,key))continue;
   // Array indices were emitted above; custom enumerable properties still round-trip.
   if(Array.isArray(input)&&String(Number(key))===key&&Number.isInteger(Number(key))&&Number(key)>=0&&Number(key)<input.length)continue;
   const name=atom(key),item=atom((input as Record<string,unknown>)[key]),entryBytes=size(name)+size(item);
   if(entries.length&&(estimate+entryBytes>RECORD_BYTES/2||entries.length>=256))emit();
   entries.push([name,item]);estimate+=entryBytes;
  }
  if(entries.length||!Array.isArray(input))emit();
 }
 flush();return {format:'idb-graph',version:1,value:rootValue,recordCount};
}

/** Lookup must contain every emitted record. References, cycles, holes and undefined are preserved. */
export function decodeIdbValue(root:IdbGraphRoot,lookup:ReadonlyMap<number,IdbGraphRecord>):unknown{
 if(!root||root.format!=='idb-graph'||root.version!==1||!Number.isSafeInteger(root.recordCount)||root.recordCount<0)throw invalid();
 const nodes=new Map<number,unknown>(),stringParts=new Map<number,{length:number;end:number;text:string[]}>();
 const visit=(run:(part:Part)=>void)=>{for(let i=0;i<root.recordCount;i++){const record=lookup.get(i);if(!record||!Array.isArray(record.parts))throw invalid();for(const part of record.parts){if(!Number.isSafeInteger(part.id)||part.id<0)throw invalid();run(part);}}};
 visit(part=>{
  if(part.type==='string'){
   let value=stringParts.get(part.id);if(!value){if(nodes.has(part.id))throw invalid();value={length:part.length,end:0,text:[]};stringParts.set(part.id,value);nodes.set(part.id,undefined);}
   if(part.start!==value.end||part.length!==value.length||typeof part.text!=='string')throw invalid();value.text.push(part.text);value.end+=part.text.length;
  }else if(part.type==='array'){
   if(!Number.isSafeInteger(part.length)||part.length<0||part.length>0xffffffff)throw invalid();
   if(!nodes.has(part.id))nodes.set(part.id,new Array(part.length));else if(!Array.isArray(nodes.get(part.id))||(nodes.get(part.id) as unknown[]).length!==part.length)throw invalid();
  }else if(part.type==='object'){
   if(!nodes.has(part.id))nodes.set(part.id,{});else if(stringParts.has(part.id))throw invalid();
  }else throw invalid();
 });
 for(const [id,value] of stringParts){if(value.end!==value.length)throw invalid();nodes.set(id,value.text.join(''));}
 const atom=(input:Atom):unknown=>{
  if(input!==null&&typeof input==='object'){
   if(!own(input,'ref')||!Number.isSafeInteger(input.ref)||!nodes.has(input.ref))throw invalid();return nodes.get(input.ref);
  }
  return input;
 };
 visit(part=>{
  if(part.type==='string')return;
  const target=nodes.get(part.id) as object;
  if(part.type==='array'){
   if(!Array.isArray(part.values)||!Number.isSafeInteger(part.start)||part.start<0||part.start+part.values.length>part.length)throw invalid();
   for(let i=0;i<part.values.length;i++)if(own(part.values,i))(target as unknown[])[part.start+i]=atom(part.values[i]);
  }else{
   if(!Array.isArray(part.entries))throw invalid();
   for(const [key,value] of part.entries){const name=atom(key);if(typeof name!=='string'||(Array.isArray(target)&&name==='length'))throw invalid();Object.defineProperty(target,name,{value:atom(value),enumerable:true,writable:true,configurable:true});}
  }
 });
 return atom(root.value);
}
