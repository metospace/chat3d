import {encodeIdbRecords,decodeIdbValue,type IdbGraphRoot,type IdbGraphRecord} from './idbChunks';
import {isQuotaExceededError} from './workspacePersist';
import {makeId} from '../util/ids';
// Browser-local workspace data only. Credentials are intentionally never part of this payload.
const DB_NAME='chat3d.workspace.v1';
const STORE='workspace';
export interface WorkspaceEnvelope { version:1; revision:number; activeId:string; sessions:unknown[];recoverySessions?:{data:unknown;error:string}[] }
// Read-only signal: decoding isolated damaged records that must be made durable.
type WorkspaceReadResult=WorkspaceEnvelope & {needsRepair?:boolean};
interface SessionRecord {id:string;snapshot:Record<string,unknown>;[key:string]:unknown}
interface LegacyManifest {storageVersion:2;version:1;revision:number;activeId:string;sessions:{metadata:Record<string,unknown>;fields:string[]}[]}
interface Manifest {storageVersion:3;version:1;revision:number;activeId:string;commitId?:string;recoveryRoot?:IdbGraphRoot;sessions:{id:string;metadata:IdbGraphRoot;fields:{name:string;root:IdbGraphRoot}[]}[]}
// Identity is used only for objects previously committed/read at the exact revision.
// Editor snapshots are immutable; a failed transaction must never advance this cache.
let committedRevision=-1;
let committed=new Map<string,Record<string,unknown>>();
const fieldKey=(id:string,field:string)=>JSON.stringify(['session',id,field]);
const chunkKey=(id:string,field:string|null,index:number)=>JSON.stringify(['session',id,field,'chunk',index]);
const openDb=():Promise<IDBDatabase>=>{
 const {promise,resolve,reject}=Promise.withResolvers<IDBDatabase>();
 if(typeof indexedDB==='undefined'){reject(new Error('当前浏览器不支持会话存储'));return promise;}
 // Older app tabs cannot reopen/write this upgraded database with version 1.
 const request=indexedDB.open(DB_NAME,2);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
 request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};request.onerror=()=>reject(request.error);
 request.onblocked=()=>reject(new Error('会话数据库被其他页面占用，请关闭旧页面重试'));
 return promise;
};
export async function readWorkspace():Promise<WorkspaceReadResult|null>{
 const db=await openDb(),{promise,resolve,reject}=Promise.withResolvers<WorkspaceReadResult|null>();
  const tx=db.transaction(STORE,'readonly'),target=tx.objectStore(STORE);let result:WorkspaceReadResult|null=null;let invalid=false;
  const hydrate:(()=>void)[][]=[];
  const readGraph=(finish:(()=>void)[],id:string,field:string|null,root:IdbGraphRoot,assign:(value:unknown)=>void,onFailure?:(error:unknown,records:Map<number,IdbGraphRecord>)=>void)=>{
   const records=new Map<number,IdbGraphRecord>();
   if(!root||root.format!=='idb-graph'||root.version!==1||!Number.isSafeInteger(root.recordCount)||root.recordCount<0){if(onFailure){onFailure(Error('invalid root'),records);return;}throw Error('invalid root');}
   let missing=false;
   for(let index=0;index<root.recordCount;index++){
    const get=target.get(chunkKey(id,field,index));get.onsuccess=()=>{if(get.result===undefined){missing=true;return;}records.set(index,get.result as IdbGraphRecord);};
   }
   finish.push(()=>{try{if(missing)throw Error('missing chunk');assign(decodeIdbValue(root,records));}catch(error){if(onFailure)onFailure(error,records);else throw error;}finally{records.clear();}});
  };
  const r=target.get('current');r.onsuccess=()=>{try{
   const value=r.result as Manifest|LegacyManifest|WorkspaceEnvelope|undefined;if(!value)return;
   if(!('storageVersion' in value)){result=value;return;}
   if(value.storageVersion===2){
    const sessions=value.sessions.map(entry=>({...entry.metadata,snapshot:{}} as SessionRecord));
    result={version:value.version,revision:value.revision,activeId:value.activeId,sessions,recoverySessions:[]};
    value.sessions.forEach((entry,i)=>{const session=sessions[i];let failed=false;for(const field of entry.fields){const get=target.get(fieldKey(session.id,field));get.onsuccess=()=>{
     // A missing legacy wrapper isolates this session, not every other session.
     if(!get.result||!Object.prototype.hasOwnProperty.call(get.result,'value')){failed=true;return;}
     Object.defineProperty(session.snapshot,field,{value:get.result.value,enumerable:true,writable:true,configurable:true});
    };}hydrate.push([()=>{if(failed){sessions.splice(sessions.indexOf(session),1);result!.needsRepair=true;result!.recoverySessions!.push({data:{session,manifest:entry},error:'旧会话字段不完整，已保留可读取的原始数据'});}}]);});
   }else if(value.storageVersion===3){
    const sessions:SessionRecord[]=[];result={version:value.version,revision:value.revision,activeId:value.activeId,sessions,recoverySessions:[]};
    if(value.recoveryRoot){const finish:(()=>void)[]=[];hydrate.push(finish);readGraph(finish,'__workspace_recovery__',null,value.recoveryRoot,items=>{result!.recoverySessions!.push(...items as NonNullable<WorkspaceEnvelope['recoverySessions']>);});}
    for(const entry of value.sessions){
     const session={id:entry.id,snapshot:{}} as SessionRecord;sessions.push(session);
     const finish:(()=>void)[]=[];hydrate.push(finish);
     const fragments:{field:string|null;root:IdbGraphRoot;records:[number,IdbGraphRecord][]}[]=[];let failed=false;
     const graph=(field:string|null,root:IdbGraphRoot,assign:(value:unknown)=>void)=>readGraph(finish,entry.id,field,root,assign,(_error,records)=>{failed=true;fragments.push({field,root,records:[...records]});});
     graph(null,entry.metadata,metadata=>{
      if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||(metadata as Record<string,unknown>).id!==entry.id)throw Error('invalid metadata');
      for(const [key,item] of Object.entries(metadata))Object.defineProperty(session,key,{value:item,enumerable:true,writable:true,configurable:true});
     });
     for(const field of entry.fields)graph(field.name,field.root,item=>Object.defineProperty(session.snapshot,field.name,{value:item,enumerable:true,writable:true,configurable:true}));
     finish.push(()=>{if(failed){sessions.splice(sessions.indexOf(session),1);result!.needsRepair=true;result!.recoverySessions!.push({data:{session,manifest:entry,fragments},error:'会话分块不完整，已保留可读取的原始数据'});}});
    }
   }else throw Error('invalid storage version');
  }catch{invalid=true;tx.abort();}};
  tx.oncomplete=()=>{db.close();resolve(result);};
  tx.onabort=()=>{db.close();reject(new Error(invalid?'会话数据不完整，已有数据不会被覆盖，请从项目备份恢复。':'会话读取失败'));};
 const loaded=await promise;
 try{
  for(const finish of hydrate){
   const {promise:yielded,resolve:resume}=Promise.withResolvers<void>();setTimeout(resume,0);await yielded;
   for(const decode of finish)decode();
   finish.length=0;
  }
  if(loaded?.recoverySessions&&!loaded.recoverySessions.length)delete loaded.recoverySessions;
  if(loaded){committedRevision=loaded.revision;committed=new Map((loaded.sessions as SessionRecord[]).map(s=>[s.id,{...s.snapshot}]));}
  return loaded;
 }catch{throw new Error('会话数据不完整，已有数据不会被覆盖，请从项目备份恢复。');}
}
export class WorkspaceConflictError extends Error {
 constructor(){super('会话版本冲突，本页自动保存已暂停。');}
}
export class WorkspaceWriteError extends Error {
 constructor(readonly cause:Error|DOMException){
  const context=cause.name==='QuotaExceededError'?'浏览器本地存储空间已满；':cause.name==='DataCloneError'?'部分数据无法写入本地存储；':isQuotaExceededError(cause)?'可能是本地存储空间不足；':'';
  const detail=cause.message.trim()||(cause.name==='AbortError'?'IndexedDB 写入事务已中止，未提供更多错误信息':'浏览器未提供更多错误信息');
  super(`会话保存失败：${context}${cause.name}: ${detail}`);
 }
}
function storageFailure(error:unknown):Error{
 if(error instanceof WorkspaceConflictError)return error;
 return new WorkspaceWriteError(error instanceof Error||error instanceof DOMException?error:new Error(String(error)));
}
function isUnconfirmedCommit(error:unknown):error is WorkspaceWriteError{
 return error instanceof WorkspaceWriteError&&error.cause.name==='UnknownError'&&/^Internal error committing transaction\.?$/i.test(error.cause.message.trim());
}

async function hasCommitReceipt(revision:number,commitId:string):Promise<boolean>{
 const db=await openDb();
 try{
  const {promise,resolve}=Promise.withResolvers<boolean>();
  const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get('current');
  tx.oncomplete=()=>resolve(request.result?.revision===revision&&request.result?.commitId===commitId);
  tx.onabort=()=>resolve(false);
  return await promise;
 }finally{db.close();}
}

export async function writeWorkspace(data:Omit<WorkspaceEnvelope,'revision'>,expectedRevision:number):Promise<number>{
 const sessions=data.sessions as SessionRecord[];
 if(sessions.some(s=>!s||typeof s.id!=='string'||!s.snapshot||typeof s.snapshot!=='object')||new Set(sessions.map(s=>s.id)).size!==sessions.length)throw Error('会话保存数据无效');
 const commitId=makeId(),nextRevision=expectedRevision+1;
 for(let attempt=0;;attempt++){
  try{return await writeWorkspaceTransaction(data,sessions,expectedRevision,commitId);}
  catch(error){
   if(!isUnconfirmedCommit(error))throw error;
   // A commit may be durable even if the browser could not confirm it to this tab.
   // Accept only a receipt from this write, never another writer at the same revision.
   if(await hasCommitReceipt(nextRevision,commitId).catch(()=>false)){
    committedRevision=nextRevision;committed=new Map(sessions.map(s=>[s.id,{...s.snapshot}]));
    return nextRevision;
   }
   if(attempt>0)throw error;
   // Reopen and recheck the original revision before the single lossless retry.
   await new Promise<void>(resolve=>setTimeout(resolve,150));
  }
 }
}

async function writeWorkspaceTransaction(data:Omit<WorkspaceEnvelope,'revision'>,sessions:SessionRecord[],expectedRevision:number,commitId:string):Promise<number>{
 const db=await openDb().catch((error:unknown)=>{throw storageFailure(error);});
 const {promise,resolve,reject}=Promise.withResolvers<number>();
 try{
  const tx=db.transaction(STORE,'readwrite'),target=tx.objectStore(STORE);
  let conflict=false,syncFailure:unknown,requestFailure:DOMException|null=null;
  const watch=<T>(request:IDBRequest<T>)=>{
   request.onerror=()=>{
    const error=request.error;
    // Other pending requests can receive AbortError after the original failure.
    if(error&&(!requestFailure||requestFailure.name==='AbortError'))requestFailure=error;
   };
   return request;
  };
  const get=watch(target.get('current'));
  const nextCache=new Map<string,Record<string,unknown>>();
  get.onsuccess=()=>{
   if((get.result?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}
   const current=get.result as Manifest|undefined,reuse=current?.storageVersion===3&&committedRevision===expectedRevision;
   const previousSnapshots=reuse?committed:undefined;
   const referenced=new Set<string>();
   function* writes():Generator<{key:string;value:unknown},void>{
    const previousSessions=new Map(reuse?current.sessions.map(session=>[session.id,session] as const):[]);
    const manifest:Manifest={storageVersion:3,version:1,revision:expectedRevision+1,commitId,activeId:data.activeId,sessions:[]};
    function* encode(id:string,field:string|null,value:unknown):Generator<{key:string;value:unknown},IdbGraphRoot>{
     const records=encodeIdbRecords(value);
     let index=0;
     for(let next=records.next();;next=records.next()){
      if(next.done)return next.value;
      const key=chunkKey(id,field,index++);
      referenced.add(key);
      yield {key,value:next.value};
     }
    }
    if(data.recoverySessions?.length)manifest.recoveryRoot=yield* encode('__workspace_recovery__',null,data.recoverySessions);
    for(const session of sessions){
     const {snapshot,...metadata}=session,previous=previousSnapshots?.get(session.id);
     const fields:{name:string;root:IdbGraphRoot}[]=[],previousRoots=new Map(previousSessions.get(session.id)?.fields.map(field=>[field.name,field.root] as const));
     manifest.sessions.push({id:session.id,metadata:yield* encode(session.id,null,metadata),fields});
     for(const [field,value] of Object.entries(snapshot)){
      const key=fieldKey(session.id,field);referenced.add(key);
      let root=previousRoots.get(field);
      if(!root||!previous||!Object.prototype.hasOwnProperty.call(previous,field)||previous[field]!==value){
       root=yield* encode(session.id,field,value);
       yield {key,value:{root}};
      }
      else for(let index=0;index<root.recordCount;index++)referenced.add(chunkKey(session.id,field,index));
      fields.push({name:field,root});
     }
     nextCache.set(session.id,{...snapshot});
    }
    // All fragments, roots, metadata and reclamation commit together; unchanged geometry is never cloned.
    yield {key:'current',value:manifest};
   }
   const queue=writes();
   const writeNext=()=>{
    try{
     const next=queue.next();
     if(!next.done){
      // Continue inside the request callback to keep this single transaction
      // active while letting the browser drain each fragment before the next.
      watch(target.put(next.value.value,next.value.key)).onsuccess=writeNext;
      return;
     }
     // Scan keys, not geometry values, including orphans left by earlier versions.
     const keys=watch(target.openKeyCursor());keys.onsuccess=()=>{try{
      const cursor=keys.result;if(!cursor)return;
      const key=cursor.key;if(typeof key==='string'&&key.startsWith('["session",')&&!referenced.has(key))watch(target.delete(key));
      cursor.continue();
     }catch(error){syncFailure=error;tx.abort();}};
    }catch(error){syncFailure=error;tx.abort();}
   };
   writeNext();
  };
  tx.oncomplete=()=>{db.close();committedRevision=expectedRevision+1;committed=nextCache;resolve(expectedRevision+1);};
  tx.onabort=()=>{
   db.close();
   const cause=syncFailure??(requestFailure?.name!=='AbortError'?requestFailure:null)??tx.error??requestFailure??new DOMException('','AbortError');
   reject(conflict?new WorkspaceConflictError():storageFailure(cause));
  };
 }catch(error){db.close();throw storageFailure(error);}
 return promise;
}
