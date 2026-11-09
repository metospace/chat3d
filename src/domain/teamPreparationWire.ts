export type PreparationWireValue=undefined|null|boolean|number|string|{ref:number};
export type PreparationWireRecord=
 |{op:'container';id:number;array:boolean;length:number}
 |{op:'set';id:number;key:string|number;value:PreparationWireValue}
 |{op:'numbers';id:number;offset:number;values:number[]}
 |{op:'string';id:number;part:string;last:boolean};
// Bound structured-clone work per message; never clone a whole mesh on the UI thread.
export function* preparationRecords(value:unknown,root:(value:PreparationWireValue)=>void):Generator<PreparationWireRecord>{
 const seen=new WeakMap<object,number>();let nextId=0;
 function* visit(input:unknown):Generator<PreparationWireRecord,PreparationWireValue>{
  if(typeof input==='string'){if(input.length<65536)return input;const id=nextId++;for(let offset=0;offset<input.length;offset+=65536)yield {op:'string',id,part:input.slice(offset,offset+65536),last:offset+65536>=input.length};return {ref:id};}
  if(input===null||input===undefined||typeof input==='number'||typeof input==='boolean')return input;
  if(typeof input!=='object')throw Error('发布快照包含不支持的数据');
  const prior=seen.get(input);if(prior!==undefined)return {ref:prior};
  const id=nextId++;seen.set(input,id);const array=Array.isArray(input);yield {op:'container',id,array,length:array?input.length:0};
  if(array){for(let i=0;i<input.length;){if(typeof input[i]==='number'){const offset=i,values:number[]=[];while(i<input.length&&values.length<8192&&typeof input[i]==='number')values.push(input[i++]);yield {op:'numbers',id,offset,values};}else{yield {op:'set',id,key:i,value:yield* visit(input[i])};i++;}}}
  else for(const key of Object.keys(input))yield {op:'set',id,key,value:yield* visit((input as Record<string,unknown>)[key])};
  return {ref:id};
 }
 root(yield* visit(value));
}
export function preparationReceiver(){
 const values=new Map<number,unknown>(),strings=new Map<number,string[]>();
 const get=(value:PreparationWireValue):unknown=>value&&typeof value==='object'?values.get(value.ref):value;
 return {get,accept(records:PreparationWireRecord[]){for(const record of records){
  if(record.op==='container')values.set(record.id,record.array?new Array(record.length):{});
  else if(record.op==='string'){const parts=strings.get(record.id)??[];parts.push(record.part);if(record.last){values.set(record.id,parts.join(''));strings.delete(record.id);}else strings.set(record.id,parts);}
  else if(record.op==='numbers'){const target=values.get(record.id) as number[];for(let i=0;i<record.values.length;i++)target[record.offset+i]=record.values[i];}
  else Object.defineProperty(values.get(record.id),record.key,{value:get(record.value),enumerable:true,configurable:true,writable:true});
 }},clear(){values.clear();strings.clear();}};
}
