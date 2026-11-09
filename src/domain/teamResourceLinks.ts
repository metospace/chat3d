/// <reference lib="es2024.promise" />
import {listModelAssets} from './modelAssetStorage';
import {useWorkspaceStore} from '../workspace';
import {asyncTeamLocalFingerprint,fingerprintSavedTeamResource} from './teamPreparation';

export type TeamResourceKind='asset'|'scene';
export interface TeamResourceLink {
 id:string;serviceOrigin:string;kind:TeamResourceKind;teamItemId:string;teamVersion:number;teamName:string;
 localId:string;localVersion?:number;sceneRevision?:number;localProjectId?:string;
 baselineFingerprint:string;direction:'publish'|'acquire';active:boolean;status:'pending'|'ready';createdAt:string;latestVersion:number;
}
export interface LocalTeamResourceState {link:TeamResourceLink;localModified:boolean;localMissing:boolean;latestVersion:number;updateAvailable:boolean}
const DATABASE='chat3d.team-resource-links.v1';
const listeners=new Set<()=>void>();
export function subscribeTeamResourceLinks(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
function notify(){for(const listener of listeners)listener();}
function exactOrigin(value:string){const url=new URL(value);if(url.origin!==value||url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('团队关联必须使用精确服务源');return url.origin;}
export function teamResourceKey(origin:string,kind:TeamResourceKind,itemId:string,version:number){return JSON.stringify([exactOrigin(origin),kind,itemId,version]);}
function linkId(link:Pick<TeamResourceLink,'serviceOrigin'|'kind'|'teamItemId'|'teamVersion'|'direction'|'localId'>){return JSON.stringify([link.serviceOrigin,link.kind,link.teamItemId,link.teamVersion,link.direction,link.localId]);}
function openLinks():Promise<IDBDatabase>{const {promise,resolve,reject}=Promise.withResolvers<IDBDatabase>();if(typeof indexedDB==='undefined'){reject(Error('浏览器不支持团队关联存储'));return promise;}const request=indexedDB.open(DATABASE,1);let blocked=false;request.onupgradeneeded=()=>{request.result.createObjectStore('links',{keyPath:'id'});};request.onerror=()=>reject(Error('团队关联存储打开失败'));request.onblocked=()=>{blocked=true;reject(Error('团队关联存储被其他页面占用，请关闭旧页面'));};request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};return promise;}
export async function listTeamResourceLinks():Promise<TeamResourceLink[]>{const db=await openLinks(),{promise,resolve,reject}=Promise.withResolvers<TeamResourceLink[]>();const tx=db.transaction('links'),r=tx.objectStore('links').getAll();tx.oncomplete=()=>{db.close();resolve(r.result);};tx.onabort=()=>{db.close();reject(Error('团队关联读取失败'));};return promise;}
/** Reserve a remote fixed version before creating a copy, so storage retries reuse its identity. */
export async function reserveTeamResourceLink(input:Omit<TeamResourceLink,'id'>):Promise<TeamResourceLink>{
 exactOrigin(input.serviceOrigin);const db=await openLinks(),{promise,resolve,reject}=Promise.withResolvers<TeamResourceLink>();const tx=db.transaction('links','readwrite'),store=tx.objectStore('links'),r=store.getAll();let result:TeamResourceLink;
 r.onsuccess=()=>{const existing=(r.result as TeamResourceLink[]).find(x=>x.serviceOrigin===input.serviceOrigin&&x.kind===input.kind&&x.teamItemId===input.teamItemId&&x.teamVersion===input.teamVersion&&x.direction==='acquire');result=existing??{...input,id:linkId(input)};if(!existing)store.add(result);};
 tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(Error('无法保留团队获取记录，尚未创建副本'));};tx.onerror=()=>{};return promise;
}
/** Only the current association moves; old local copies and historical links are never removed. */
export async function saveTeamResourceLink(input:Omit<TeamResourceLink,'id'>,reservedId?:string):Promise<TeamResourceLink>{
 exactOrigin(input.serviceOrigin);if(!input.baselineFingerprint)throw Error('团队关联缺少基线指纹');
 const result={...input,status:'ready' as const,id:reservedId??linkId(input)},db=await openLinks(),{promise,resolve,reject}=Promise.withResolvers<TeamResourceLink>();const tx=db.transaction('links','readwrite'),store=tx.objectStore('links'),r=store.getAll();
 r.onsuccess=()=>{const related=(r.result as TeamResourceLink[]).filter(old=>old.serviceOrigin===result.serviceOrigin&&old.kind===result.kind&&old.teamItemId===result.teamItemId);if(related.some(old=>old.active&&old.teamVersion>result.teamVersion))result.active=false;result.latestVersion=Math.max(result.latestVersion,...related.map(old=>old.latestVersion));for(const old of related){if(result.active&&old.id!==result.id&&old.active)store.put({...old,active:false,latestVersion:Math.max(old.latestVersion,result.teamVersion)});}store.put(result);};
 tx.oncomplete=()=>{db.close();notify();resolve(result);};tx.onabort=()=>{db.close();reject(Error('团队版本已处理，但关联保存失败；请重试同一项完成关联'));};tx.onerror=()=>{};return promise;
}
export async function rememberTeamResourceHeads(serviceOrigin:string,kind:TeamResourceKind,heads:Array<{id:string;version:number}>):Promise<void>{
 exactOrigin(serviceOrigin);const versions=new Map(heads.map(x=>[x.id,x.version])),db=await openLinks(),{promise,resolve,reject}=Promise.withResolvers<void>();const tx=db.transaction('links','readwrite'),store=tx.objectStore('links'),r=store.getAll();r.onsuccess=()=>{for(const old of r.result as TeamResourceLink[])if(old.serviceOrigin===serviceOrigin&&old.kind===kind&&versions.has(old.teamItemId))store.put({...old,latestVersion:Math.max(old.latestVersion,versions.get(old.teamItemId)!)});};tx.oncomplete=()=>{db.close();notify();resolve();};tx.onabort=()=>{db.close();reject(Error('新版提示保存失败，本地副本未修改'));};return promise;
}
/** Content and library metadata only: never chat, account credentials or model configuration. */
export const teamLocalFingerprint=asyncTeamLocalFingerprint;
export async function listLocalTeamResourceStates(kind:TeamResourceKind,localIds?:string[]):Promise<LocalTeamResourceState[]>{
 const ids=localIds?new Set(localIds):undefined,links=(await listTeamResourceLinks()).filter(x=>x.kind===kind&&x.status==='ready'&&(!ids||ids.has(x.localId))),assets=kind==='asset'?await listModelAssets():[],sessions=useWorkspaceStore.getState().sessions;
 const states:LocalTeamResourceState[]=[];
 for(const link of links){let localMissing=false,localModified=false;
  if(kind==='asset'){
   const head=assets.find(x=>x.id===link.localId);localMissing=!head;
   if(head){const fingerprint=await fingerprintSavedTeamResource({kind,asset:{id:head.id,version:head.version},name:head.name,description:head.description??'',category:head.category});localModified=head.version!==link.localVersion||fingerprint!==link.baselineFingerprint||sessions.some(s=>!s.deletedAt&&s.moduleKind==='asset'&&s.assetSource?.id===head.id&&(!!s.snapshot.pendingBatch||s.snapshot.wasRunning||s.snapshot.doc.revision!==s.savedRevision));}
  }else{
   const session=sessions.find(x=>x.id===link.localId&&!x.deletedAt);localMissing=!session;
   if(session){const fingerprint=await fingerprintSavedTeamResource({kind,scene:session.snapshot.doc,name:session.title,description:session.libraryDescription??'',category:session.sceneCategory});localModified=fingerprint!==link.baselineFingerprint||session.snapshot.doc.revision!==link.sceneRevision||!!session.snapshot.pendingBatch||session.snapshot.wasRunning;}
  }
  const latestVersion=Math.max(link.latestVersion,link.teamVersion);states.push({link,localMissing,localModified,latestVersion,updateAvailable:link.active&&latestVersion>link.teamVersion});
 }
 return states;
}
