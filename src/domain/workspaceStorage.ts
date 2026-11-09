import {encodeIdbValue,decodeIdbValue,type IdbGraphRoot,type IdbGraphRecord} from './idbChunks';
// Browser-local workspace data only. Credentials are intentionally never part of this payload.
const DB_NAME='chat3d.workspace.v1';
const STORE='workspace';
export interface WorkspaceEnvelope { version:1; revision:number; activeId:string; sessions:unknown[] }
interface SessionRecord {id:string;snapshot:Record<string,unknown>;[key:string]:unknown}
interface LegacyManifest {storageVersion:2;version:1;revision:number;activeId:string;sessions:{metadata:Record<string,unknown>;fields:string[]}[]}
interface Manifest {storageVersion:3;version:1;revision:number;activeId:string;sessions:{id:string;metadata:IdbGraphRoot;fields:{name:string;root:IdbGraphRoot}[]}[]}
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
export async function readWorkspace():Promise<WorkspaceEnvelope|null>{
 const db=await openDb(),{promise,resolve,reject}=Promise.withResolvers<WorkspaceEnvelope|null>();
  const tx=db.transaction(STORE,'readonly'),target=tx.objectStore(STORE);let result:WorkspaceEnvelope|null=null;let invalid=false;
  const hydrate:(()=>void)[]=[];
  const readGraph=(id:string,field:string|null,root:IdbGraphRoot,assign:(value:unknown)=>void)=>{
   if(!root||root.format!=='idb-graph'||root.version!==1||!Number.isSafeInteger(root.recordCount)||root.recordCount<0)throw Error('invalid root');
   const records=new Map<number,IdbGraphRecord>();
   for(let index=0;index<root.recordCount;index++){
    const get=target.get(chunkKey(id,field,index));get.onsuccess=()=>{if(!get.result){invalid=true;tx.abort();return;}records.set(index,get.result as IdbGraphRecord);};
   }
   hydrate.push(()=>assign(decodeIdbValue(root,records)));
  };
  const r=target.get('current');r.onsuccess=()=>{try{
   const value=r.result as Manifest|LegacyManifest|WorkspaceEnvelope|undefined;if(!value)return;
   if(!('storageVersion' in value)){result=value;return;}
   if(value.storageVersion===2){
    const sessions=value.sessions.map(entry=>({...entry.metadata,snapshot:{}} as SessionRecord));
    result={version:value.version,revision:value.revision,activeId:value.activeId,sessions};
    value.sessions.forEach((entry,i)=>{for(const field of entry.fields){const get=target.get(fieldKey(sessions[i].id,field));get.onsuccess=()=>{
     // Undefined fields are stored inside a wrapper, so missing records are detectable.
     if(!get.result||!Object.prototype.hasOwnProperty.call(get.result,'value')){invalid=true;tx.abort();return;}
     Object.defineProperty(sessions[i].snapshot,field,{value:get.result.value,enumerable:true,writable:true,configurable:true});
    };}});
   }else if(value.storageVersion===3){
    const sessions:SessionRecord[]=[];result={version:value.version,revision:value.revision,activeId:value.activeId,sessions};
    for(const entry of value.sessions){
     const session={id:entry.id,snapshot:{}} as SessionRecord;sessions.push(session);
     readGraph(entry.id,null,entry.metadata,metadata=>{
      if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||(metadata as Record<string,unknown>).id!==entry.id)throw Error('invalid metadata');
      for(const [key,item] of Object.entries(metadata))Object.defineProperty(session,key,{value:item,enumerable:true,writable:true,configurable:true});
     });
     for(const field of entry.fields)readGraph(entry.id,field.name,field.root,item=>Object.defineProperty(session.snapshot,field.name,{value:item,enumerable:true,writable:true,configurable:true}));
    }
   }else throw Error('invalid storage version');
  }catch{invalid=true;tx.abort();}};
  tx.oncomplete=()=>{db.close();try{
   for(const finish of hydrate)finish();
   if(result){committedRevision=result.revision;committed=new Map((result.sessions as SessionRecord[]).map(s=>[s.id,{...s.snapshot}]));}resolve(result);
  }catch{reject(new Error('会话数据不完整，已有数据不会被覆盖，请从项目备份恢复。'));}};
  tx.onabort=()=>{db.close();reject(new Error(invalid?'会话数据不完整，已有数据不会被覆盖，请从项目备份恢复。':'会话读取失败'));};
 return promise;
}
function storageFailureMessage(error:DOMException|Error|null,conflict:boolean):string{
 if(conflict)return '另一个标签页已更新会话。请先下载本页项目备份，再刷新；本页不会覆盖其他标签页的数据。';
 if(error?.name==='QuotaExceededError')return '会话保存失败：浏览器本地存储空间已满。请下载项目备份，并清理回收站或其他浏览器数据后重试。';
 if(error?.name==='DataCloneError')return '会话保存失败：部分数据无法写入本地存储。请下载项目备份后刷新页面。';
 if(error?.message)return `会话保存失败：${error.message}。请下载项目备份。`;
 return '会话保存失败，可能存储空间不足或浏览器禁止写入。请下载项目备份。';
}
export async function writeWorkspace(data:Omit<WorkspaceEnvelope,'revision'>,expectedRevision:number):Promise<number>{
 const sessions=data.sessions as SessionRecord[];
 if(sessions.some(s=>!s||typeof s.id!=='string'||!s.snapshot||typeof s.snapshot!=='object')||new Set(sessions.map(s=>s.id)).size!==sessions.length)throw Error('会话保存数据无效');
 const db=await openDb(),{promise,resolve,reject}=Promise.withResolvers<number>();
  const tx=db.transaction(STORE,'readwrite'),target=tx.objectStore(STORE),get=target.get('current');let conflict=false;let failure:DOMException|Error|null=null;
  const nextCache=new Map<string,Record<string,unknown>>();
  get.onsuccess=()=>{
   if((get.result?.revision??0)!==expectedRevision){conflict=true;tx.abort();return;}
   try{
    const current=get.result as Manifest|undefined,reuse=current?.storageVersion===3&&committedRevision===expectedRevision;
    const previousSessions=new Map(reuse?current.sessions.map(session=>[session.id,session] as const):[]);
    const manifest:Manifest={storageVersion:3,version:1,revision:expectedRevision+1,activeId:data.activeId,sessions:[]};
    const referenced=new Set<string>();
    const encode=(id:string,field:string|null,value:unknown)=>encodeIdbValue(value,(index,record)=>{const key=chunkKey(id,field,index);referenced.add(key);target.put(record,key);});
    for(const session of sessions){
     const {snapshot,...metadata}=session,previous=reuse?committed.get(session.id):undefined;
     const fields:{name:string;root:IdbGraphRoot}[]=[],previousRoots=new Map(previousSessions.get(session.id)?.fields.map(field=>[field.name,field.root] as const));
     manifest.sessions.push({id:session.id,metadata:encode(session.id,null,metadata),fields});
     for(const [field,value] of Object.entries(snapshot)){
      const key=fieldKey(session.id,field);referenced.add(key);
      let root=previousRoots.get(field);
      if(!root||!previous||!Object.prototype.hasOwnProperty.call(previous,field)||previous[field]!==value){root=encode(session.id,field,value);target.put({root},key);}
      else for(let index=0;index<root.recordCount;index++)referenced.add(chunkKey(session.id,field,index));
      fields.push({name:field,root});
     }
     nextCache.set(session.id,{...snapshot});
    }
    // All fragments, roots, metadata and reclamation commit together; unchanged geometry is never cloned.
    target.put(manifest,'current');
    // Scan keys, not geometry values, including orphans left by earlier versions.
    const keys=target.openKeyCursor();keys.onsuccess=()=>{
     const cursor=keys.result;if(!cursor)return;
     const key=cursor.key;if(typeof key==='string'&&key.startsWith('["session",')&&!referenced.has(key))target.delete(key);
     cursor.continue();
    };
   }catch(e){failure=e instanceof Error?e:new Error(String(e));tx.abort();}
  };
  tx.oncomplete=()=>{db.close();committedRevision=expectedRevision+1;committed=nextCache;resolve(expectedRevision+1);};
  tx.onabort=()=>{db.close();reject(new Error(storageFailureMessage(failure,conflict)));};
  tx.onerror=()=>{failure=tx.error??failure;};
 return promise;
}
