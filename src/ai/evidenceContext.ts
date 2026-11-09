import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {ImageContent,JsonValue,TextContent} from '@earendil-works/pi-ai';

type ResultMessage=Extract<AgentMessage,{role:'toolResult'}>;
type Content=TextContent|ImageContent;
const CAPTURE_TOOLS:Record<string,true|undefined>={capture_view:true,capture_multiview:true,capture_quality_review:true,capture_component_intrinsic:true,capture_detail_diagnostic:true,preview_animation:true};
const IMAGE_LIMIT=6,RECALL_LIMIT=3,CATALOG_LIMIT=12;

type ImageEvidence={index:number;revision:number|null;originalRevision?:number|null;scopes:string[];views:string[]};
export type ActiveEvidence={captureId:string;toolCallId:string;revision:number|null;originalRevision?:number|null;images:ImageEvidence[]};
export type EvidenceCatalogEntry={captureId:string;toolCallId:string;toolName:string;revision:number|null;scopes:string[];views:string[];imageCount:number;available:true};
type Packet={id:string;message:ResultMessage;images:ImageContent[];manifest:ImageEvidence[];entry:EvidenceCatalogEntry};
type Occurrence={position:number;packet:Packet;indices:number[];recall:boolean};
type RecallReference={captureId:string;imageIndices:number[];revision:number;originalRevision?:number};

function record(value:unknown):Record<string,unknown>{
 if(typeof value==='string'){try{return record(JSON.parse(value));}catch{return {};}}
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function jsonDetails(value:unknown):{[key:string]:JsonValue}{
 const convert=(item:unknown):JsonValue|undefined=>{
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(typeof item==='number')return Number.isFinite(item)?item:undefined;
  if(Array.isArray(item))return item.map(child=>convert(child)??null);
  if(item&&typeof item==='object'){
   const result:{[key:string]:JsonValue}={};
   for(const [key,child] of Object.entries(item)){const converted=convert(child);if(converted!==undefined)result[key]=converted;}
   return result;
  }
  return undefined;
 };
 const result:{[key:string]:JsonValue}={};
 for(const [key,item] of Object.entries(record(value))){const converted=convert(item);if(converted!==undefined)result[key]=converted;}
 return result;
}
function revision(value:unknown):number|null{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
function unique(values:string[]):string[]{return [...new Set(values)];}
function tokens(text:string,key:string):string[]{
 // Real tool markers include Chinese punctuation (for example scope=whole；).
 return [...text.matchAll(new RegExp(`(?:^|[\\s,;；])${key}=([^\\s,;；。]+)`,'g'))].map(match=>match[1]);
}
function stringValues(value:unknown):string[]{return typeof value==='string'?[value]:Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];}
function frozenClone<T>(value:T):T{
 const copy=structuredClone(value);
 const freeze=(item:unknown):void=>{if(item&&typeof item==='object'){for(const child of Object.values(item))freeze(child);Object.freeze(item);}};
 freeze(copy);return copy;
}
function describe(message:ResultMessage,id:string):Packet{
 const details=record(message.details),images:ImageContent[]=[],manifest:ImageEvidence[]=[];
 const fallbackRevision=revision(details.revision),fallbackScopes=stringValues(details.scope),fallbackViews=stringValues(details.view);
 let markerRevision=fallbackRevision,scopes=fallbackScopes,views=fallbackViews;
 for(const part of message.content){
  if(part.type==='text'){
   const parsed=record(part.text),markedRevision=tokens(part.text,'revision')[0],markedScopes=tokens(part.text,'scope'),markedViews=tokens(part.text,'view');
   const nextRevision=markedRevision===undefined?revision(parsed.revision):revision(Number(markedRevision));
   if(nextRevision!==null)markerRevision=nextRevision;
   const aliases=[...tokens(part.text,'componentId'),...stringValues(parsed.componentId)];
   if(markedScopes.length||parsed.scope!==undefined)scopes=unique([...markedScopes,...stringValues(parsed.scope),...aliases]);
   else if(aliases.length)scopes=unique([...scopes,...aliases]);
   if(markedViews.length||parsed.view!==undefined)views=unique([...markedViews,...stringValues(parsed.view)]);
  }else if(part.type==='image'){
   manifest.push({index:images.length,revision:markerRevision,scopes:[...scopes],views:[...views]});images.push(part);
  }
 }
 const revisions=unique(manifest.map(image=>String(image.revision)));
 const packetRevision=revisions.length===1?manifest[0]?.revision??null:null;
 return {id,message,images,manifest,entry:{captureId:id,toolCallId:message.toolCallId,toolName:message.toolName,revision:packetRevision,scopes:unique(manifest.flatMap(image=>image.scopes)),views:unique(manifest.flatMap(image=>image.views)),imageCount:images.length,available:true}};
}
function pageNumber(value:number|undefined,fallback:number,name:string):number{
 const n=value??fallback;if(!Number.isSafeInteger(n)||n<0)throw new Error(`${name} must be a nonnegative integer`);return n;
}

/** Per-run immutable capture archive and bounded, non-authoritative model-context projection. */
export class EvidenceContext{
 private readonly packets:Packet[]=[];
 private readonly byCall=new Map<string,Packet>();
 private readonly byId=new Map<string,Packet>();
 private readonly revisionAliases=new Map<number,number>();
 private activeEvidence:ActiveEvidence[]=[];
 get activeImageCount():number{return this.activeEvidence.reduce((count,entry)=>count+entry.images.length,0);}
 active():ActiveEvidence[]{return structuredClone(this.activeEvidence);}

 /** Call only after confirming that both revisions have identical visual fingerprints. */
 carryForward(fromRevision:number,toRevision:number):void{
  if(revision(fromRevision)===null||revision(toRevision)===null)throw new Error('Evidence revisions must be nonnegative safe integers');
  const from=this.visualRevision(fromRevision),to=this.visualRevision(toRevision);
  if(from!==to)this.revisionAliases.set(from,to);
 }

 private visualRevision(value:number):number{
  let current=value;
  while(this.revisionAliases.has(current))current=this.revisionAliases.get(current)!;
  return current;
 }

 private usableRevision(source:number|null,current:number|null):boolean{
  return source!==null&&current!==null&&this.visualRevision(source)===this.visualRevision(current);
 }

 private ingest(messages:AgentMessage[]):void{
  for(const message of messages){
   if(message.role!=='toolResult'||message.isError||CAPTURE_TOOLS[message.toolName]!==true||this.byCall.has(message.toolCallId)||record(message.details).evidenceProjection||record(message.details).evidenceRecall||!message.content.some(part=>part.type==='image'))continue;
   const packet=describe(frozenClone(message),`capture-${this.packets.length+1}`);
   this.packets.push(packet);this.byCall.set(message.toolCallId,packet);this.byId.set(packet.id,packet);
  }
 }

 /** Use originals for ingestion; a separately compacted transcript may supply the message skeleton. */
 prepare(original:AgentMessage[],compacted:AgentMessage[]=original,currentRevision?:number):AgentMessage[]{
  this.ingest(original);return this.projectPrepared(compacted,currentRevision);
 }
 project(messages:AgentMessage[]):AgentMessage[]{return this.prepare(messages);}

 /** Stable archive pagination. Entries assert availability, never visual acceptance. */
 list(offset?:number,limit?:number):{captures:EvidenceCatalogEntry[];total:number;nextOffset:number|null}{
  const start=pageNumber(offset,0,'offset'),size=Math.min(CATALOG_LIMIT,pageNumber(limit,CATALOG_LIMIT,'limit'));
  if(!size)throw new Error('limit must be at least 1');
  const end=Math.min(this.packets.length,start+size);
  return {captures:this.packets.slice(start,end).map(packet=>structuredClone(packet.entry)),total:this.packets.length,nextOffset:end<this.packets.length?end:null};
 }

 /** Recall does not refresh capture turns, evidence keys, review state, or the active manifest. */
 recall(args:{captureId:string;startImage?:number;count?:number},currentRevision:number):{content:Content[];details:{[key:string]:JsonValue}&{evidenceRecall:RecallReference&{startImage:number;count:number;totalImages:number;nextImage:number|null;originalToolCallId:string;originalToolName:string}}}{
  const packet=this.byId.get(args.captureId);if(!packet)throw new Error(`Unknown captureId: ${args.captureId}; use list to find available captures`);
  if(!this.usableRevision(packet.entry.revision,currentRevision))throw new Error(`Capture ${args.captureId} revision ${packet.entry.revision??'unknown'} does not match current revision ${currentRevision}; stale screenshots cannot be recalled`);
  const start=pageNumber(args.startImage,0,'startImage'),count=Math.min(RECALL_LIMIT,pageNumber(args.count,RECALL_LIMIT,'count'));
  if(!count)throw new Error('count must be at least 1');
  if(start>=packet.images.length)throw new Error(`startImage must be below ${packet.images.length}`);
  const indices=Array.from({length:Math.min(count,packet.images.length-start)},(_,index)=>start+index),end=start+indices.length;
  const reference={captureId:packet.id,revision:currentRevision,...(packet.entry.revision!==currentRevision?{originalRevision:packet.entry.revision!}:{}),imageIndices:indices,startImage:start,count:indices.length,totalImages:packet.images.length,nextImage:end<packet.images.length?end:null,originalToolCallId:packet.message.toolCallId,originalToolName:packet.message.toolName};
  return {content:this.content(packet,new Set(indices),`Recalled original capture page: ${JSON.stringify(reference)}. Original provenance and limitations below; recall is not a new capture or acceptance.`),details:{...jsonDetails(packet.message.details),evidenceRecall:reference}};
 }

 private content(packet:Packet,selected:Set<number>,notice:string):Content[]{
  let index=0;
  return [{type:'text',text:notice},...packet.message.content.flatMap((part):Content[]=>{
   if(part.type==='text')return [{...part}];
   const imageIndex=index++;
   return selected.has(imageIndex)?[{...part}]:[{type:'text',text:`[Image ${imageIndex} archived: ${packet.id}; available via recall_evidence, startImage=${imageIndex}. No visual acceptance implied.]`}];
  })];
 }

 private projectPrepared(messages:AgentMessage[],requestedRevision?:number):AgentMessage[]{
  const knownRevisions=[...this.revisionAliases.keys(),...this.revisionAliases.values(),...this.packets.flatMap(packet=>packet.manifest.flatMap(image=>image.revision===null?[]:[image.revision])),...messages.flatMap(message=>message.role==='toolResult'?revision(record(message.details).revision)??[]:[])];
  const currentRevision=requestedRevision??knownRevisions.reduce<number|null>((latest,value)=>Math.max(latest??0,value),null);
  const occurrences:Occurrence[]=[];
  for(let position=0;position<messages.length;position++){
   const message=messages[position];if(message.role!=='toolResult'||message.isError)continue;
   const recall=record(record(message.details).evidenceRecall);
   if(typeof recall.captureId==='string'){
    const packet=this.byId.get(recall.captureId),indices=recall.imageIndices;
    if(packet&&this.usableRevision(packet.entry.revision,currentRevision)&&this.usableRevision(revision(recall.revision),currentRevision)&&Array.isArray(indices)&&indices.length<=RECALL_LIMIT&&indices.every(index=>Number.isSafeInteger(index)&&index>=0&&index<packet.images.length))occurrences.push({position,packet,indices:unique(indices.map(String)).map(Number),recall:true});
   }else{
    const packet=this.byCall.get(message.toolCallId);
    if(packet)occurrences.push({position,packet,indices:packet.manifest.filter(image=>this.usableRevision(image.revision,currentRevision)).map(image=>image.index),recall:false});
   }
  }
  const newest=[...occurrences].reverse(),chosen=new Map<number,Set<number>>(),seenImages=new Set<string>();
  let remaining=IMAGE_LIMIT;
  const add=(occurrence:Occurrence|undefined):void=>{
   if(!occurrence||!remaining)return;
   const selected=chosen.get(occurrence.position)??new Set<number>();
   if(occurrence.packet.message.toolName==='preview_animation'&&occurrence.indices.length<=IMAGE_LIMIT&&occurrence.indices.filter(index=>!seenImages.has(`${occurrence.packet.id}:${index}`)).length>remaining)return;
   for(const index of occurrence.indices){
    if(!remaining)break;
    if(selected.has(index))continue;
    const identity=`${occurrence.packet.id}:${index}`;
    if(seenImages.has(identity))continue;
    seenImages.add(identity);selected.add(index);remaining--;
   }
   if(selected.size)chosen.set(occurrence.position,selected);
  };
  const usable=newest.filter(occurrence=>occurrence.indices.length),latest=usable[0],latestRecall=usable.find(occurrence=>occurrence.recall);
  const whole=usable.find(occurrence=>occurrence.indices.some(index=>occurrence.packet.manifest[index].scopes.includes('whole')));
  const focused=usable.find(occurrence=>occurrence.indices.some(index=>occurrence.packet.manifest[index].scopes.some(scope=>scope!=='whole')));
  // Keep an explicit recalled page active even if a capture followed it in the same turn.
  // Animation packets stay together when <=6 and no recalled page competes for that request.
  if(latestRecall)add(latestRecall);
  if(latest?.packet.message.toolName==='preview_animation')add(latest);
  else if(whole&&focused&&(whole===focused?whole.indices.length:whole.indices.length+focused.indices.length)<=remaining){
   for(const occurrence of [whole,focused].sort((a,b)=>b.position-a.position))add(occurrence);
  }
  add(latest);add(whole);add(focused);for(const occurrence of usable)add(occurrence);
  this.activeEvidence=[];
  for(const occurrence of occurrences){
   const selected=chosen.get(occurrence.position);if(!selected)continue;
   this.activeEvidence.push({captureId:occurrence.packet.id,toolCallId:occurrence.packet.message.toolCallId,revision:currentRevision,...(occurrence.packet.entry.revision!==currentRevision?{originalRevision:occurrence.packet.entry.revision}:{}),images:[...selected].map(index=>{
    const image=occurrence.packet.manifest[index];
    return {...structuredClone(image),revision:currentRevision,...(image.revision!==currentRevision?{originalRevision:image.revision}:{})};
   })});
  }
  const occurrenceByPosition=new Map(occurrences.map(occurrence=>[occurrence.position,occurrence]));
  const catalog=this.packets.slice(-CATALOG_LIMIT).map(packet=>packet.entry);
  const catalogPosition=occurrences[occurrences.length-1]?.position;
  return messages.map((message,position):AgentMessage=>{
   if(message.role!=='toolResult'||message.isError)return message;
   const occurrence=occurrenceByPosition.get(position),recall=record(record(message.details).evidenceRecall);
   if(!occurrence){
    // A recalled page can become stale after a later edit; never reinstate its pixels.
    if(typeof recall.captureId==='string')return {...message,content:message.content.filter(part=>part.type!=='image').concat({type:'text',text:'Recalled screenshots are no longer active at the current revision; original capture remains archived.'})};
    return message;
   }
   const {packet}=occurrence,selected=chosen.get(position)??new Set<number>();
   const catalogText=position===catalogPosition?` Archive catalog (latest ${catalog.length}/${this.packets.length}, availability only): ${JSON.stringify(catalog)}. All captures remain reachable with recall_evidence list pagination offset=0, limit<=12.`:'';
   const effectiveRecall=occurrence.recall?{...recall,revision:currentRevision,...(packet.entry.revision!==currentRevision?{originalRevision:packet.entry.revision}:{})}:undefined;
   const recallText=effectiveRecall?` Recalled page cursor: ${JSON.stringify(effectiveRecall)}.`:'';
   const notice=`Evidence ${packet.id}: revision=${selected.size?currentRevision:packet.entry.revision??'unknown'}${selected.size&&packet.entry.revision!==currentRevision?`, originalRevision=${packet.entry.revision??'unknown'}`:''}, scopes=${JSON.stringify(packet.entry.scopes)}, views=${JSON.stringify(packet.entry.views)}, available=true, active image indices=${JSON.stringify([...selected])}, totalImages=${packet.images.length}. Original capture retained; archived images are not visible and are not acceptance evidence.${recallText}${catalogText}`;
   // Archived packets need a compact pointer, not the original potentially large review plan.
   const content=selected.size?this.content(packet,selected,notice):[{type:'text' as const,text:notice}];
   return {...message,content,details:{...jsonDetails(packet.message.details),...(effectiveRecall?{evidenceRecall:jsonDetails(effectiveRecall)}:{}),evidenceProjection:{captureId:packet.id,revision:currentRevision,originalRevision:packet.entry.revision,imageIndices:[...selected],archived:selected.size===0}}};
  });
 }
}
