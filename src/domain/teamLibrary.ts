import {buildTeamCopyExport} from './teamCopyExport';
import {teamFetch} from './teamTransport';
import {compressTeamPublication,sendTeamPublication,type TeamPublicationPackage,type TeamUploadProgress} from './teamPublish';
import {localPublishedCategoryPath,publishedCategoryPath,acquirePublishedCategory} from './teamCategories';
import {parseModelAsset} from './modelAssets';
import {parseProject,MAX_TEAM_SCENE_BYTES} from './project';
import {saveModelAsset} from './modelAssetStorage';
import {createSession,flushWorkspace,useWorkspaceStore} from '../workspace';
import {assertLibraryReady} from './libraryNavigation';
import {listModelAssets,readModelAsset} from './modelAssetStorage';
import {listTeamResourceLinks,listLocalTeamResourceStates,reserveTeamResourceLink,saveTeamResourceLink,rememberTeamResourceHeads,teamLocalFingerprint,teamResourceKey,type TeamResourceLink,type LocalTeamResourceState} from './teamResourceLinks';
import {DEFAULT_PLATFORM_BASE,DEFAULT_PLATFORM_TENANT,loadPlatformAuth,savePlatformAuth,type PlatformAuth} from './platformAuthStorage';
import {buildPlatformAuthorizeUrl,clearPendingPlatformOAuth,clearPlatformOAuthCallbackFromUrl,configuredTeamServiceBase,consumePendingPlatformOAuth,openPlatformAuthorizationWindow,parsePlatformOAuthCallback,platformOAuthRedirectUri,platformTenantId,publishPlatformOAuthResult,watchPlatformOAuthResult,type PlatformOAuthCallback} from './platformOAuth';
import {scenePublication} from './teamPublicationSnapshot';
export {assetPublication,scenePublication} from './teamPublicationSnapshot';
import {prepareTeamPublicationSnapshot,yieldTeamPreparationPaint,type TeamPreparationProgress} from './teamPreparation';
import type {SceneDocument} from './types';
export type {TeamPreparationProgress} from './teamPreparation';
export interface TeamUser {id:string;name:string;role:'admin'|'member'|'viewer'}
export interface TeamItem {id:string;owner:string;kind:'asset'|'scene';version:number;name:string;description:string;created:string;categoryPath?:string[]}
export interface TeamVersion extends TeamItem {payload:unknown}
export interface TeamPublish {kind:'asset'|'scene';name:string;description:string;payload:unknown;key:string;itemId?:string;expectedVersion:number;categoryPath?:string[]}
export class TeamServiceError extends Error {
 constructor(readonly status:number,message:string){super(message);this.name='TeamServiceError';}
}
/** Truncated, redacted body preview for non-JSON team responses (empty / HTML 502 / CF pages). */
export function teamResponseBodyPreview(text:string,maxChars=200){
 const collapsed=String(text??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();
 const redacted=collapsed
  .replace(/Bearer\s+[A-Za-z0-9._\-+=\/]+/gi,'Bearer [已隐藏]')
  .replace(/"(access_?token|refresh_?token|token|password)"\s*:\s*"[^"]*"/gi,'"$1":"[已隐藏]"');
 if(!redacted)return '空响应';
 return redacted.length>maxChars?redacted.slice(0,maxChars)+'…':redacted;
}
const TEAM_ADDRESS_KEY='chat3d.team.address';
export function teamAddress(value:string){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('请输入 HTTPS 服务根地址（本机测试可用 HTTP localhost）');return url.origin;}
export function defaultTeamServiceBase(){return configuredTeamServiceBase();}
export function rememberTeamServiceBase(base:string){localStorage.setItem(TEAM_ADDRESS_KEY,teamAddress(base));}
export class TeamClient {
 readonly base:string;private token='';user?:TeamUser;
 constructor(base:string){this.base=teamAddress(base);}
 async raw(path:string,body?:unknown,signal?:AbortSignal):Promise<Response>{
  const response=await teamFetch(this.base+'/api/team/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{Authorization:'Bearer '+this.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:signal??AbortSignal.timeout(60000),redirect:'error',credentials:'omit'});
  if(!response.ok){let message='团队服务请求失败（HTTP '+response.status+'）';try{const data=await response.json();if(typeof data?.error==='string')message=data.error;}catch{/* Proxy errors need not be JSON. */}if(response.status===401&&this.token&&sharedClient===this){expireTeamSession(this);message='团队登录已失效，请重新登录。';}throw new TeamServiceError(response.status,message);}
  return response;
 }
 async request<T>(path:string,body?:unknown,onProgress?:(progress:TeamUploadProgress)=>void,publication?:TeamPublicationPackage):Promise<T>{
  const response=path==='publish'&&body!==undefined
   ?await sendTeamPublication(this.base,this.token,publication??await compressTeamPublication(JSON.stringify(body)),onProgress,(body as TeamPublish).key)
   :await teamFetch(this.base+'/api/team/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(this.token?{Authorization:'Bearer '+this.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:'error',credentials:'omit'});
  const authentication=path==='login'||path.startsWith('login/');
  const raw=await response.text();
  let data:unknown;
  try{if(!raw.length)throw new SyntaxError('empty');data=JSON.parse(raw);}catch{
   const preview=teamResponseBodyPreview(raw);
   if(authentication)throw new TeamServiceError(response.status,`团队授权服务未返回 JSON（HTTP ${response.status}，${preview}），请检查团队服务地址与 /api/team 路由；本地开发需配置 CHAT3D_TEAM_DEV_BASE。`);
   throw Error(`团队服务响应未完整返回（HTTP ${response.status}，${preview}），尚未确认操作结果；可重试同一项。`);
  }
  if(!response.ok){
   if(response.status===401&&this.token&&sharedClient===this){expireTeamSession(this);throw new TeamServiceError(401,'团队登录已失效，请重新登录。');}
   throw new TeamServiceError(response.status,data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:authentication&&response.status===404?'团队授权接口不存在（HTTP 404），请检查团队服务地址与 /api/team 路由；本地开发需配置 CHAT3D_TEAM_DEV_BASE。':'团队服务请求失败');
  }
  return data as T;
 }
async login(name:string,password:string){const result=await this.request<{token:string;user:TeamUser}>('login',{name,password});this.token=result.token;this.user=result.user;return result.user;}
async loginWithPlatform(auth:{accessToken:string;tenantId:string}){const result=await this.request<{token:string;user:TeamUser}>('login/sso',{accessToken:auth.accessToken,tenantId:auth.tenantId});this.token=result.token;this.user=result.user;return result.user;}
 acceptSession(token:string,user:TeamUser){this.token=token;this.user=user;}
 clearSession(){this.token='';this.user=undefined;}
 async logout(){const pending=this.request('logout',{});this.token='';this.user=undefined;await pending;}
 list(kind:'asset'|'scene',q=''){return this.request<TeamItem[]>('items?kind='+kind+'&q='+encodeURIComponent(q));}
 async read(item:TeamItem){const value=await this.request<TeamVersion>(`items/${encodeURIComponent(item.id)}/${item.version}`);if(value.id!==item.id||value.kind!==item.kind||value.version!==item.version)throw Error('团队服务返回的固定版本不匹配');return value;}
 publish(body:TeamPublish,onProgress?:(progress:TeamUploadProgress)=>void,publication?:TeamPublicationPackage){return this.request<{id:string;version:number}>('publish',body,onProgress,publication);}
}
const sessionListeners=new Set<()=>void>();
let sharedClient:TeamClient|undefined;
let sessionExpired=false,sessionRevision=0;
let resumeRequest:Promise<TeamClient|undefined>|undefined;
export function getTeamSession(){return sharedClient;}
export function getTeamSessionStatus(){return sharedClient?.user?'authenticated':resumeRequest?'restoring':sessionExpired?'expired':'guest';}
export function subscribeTeamSession(listener:()=>void){sessionListeners.add(listener);return ()=>{sessionListeners.delete(listener);};}
function notifyTeamSession(){for(const listener of sessionListeners)listener();}
function activateTeamSession(client:TeamClient){sharedClient=client;sessionExpired=false;sessionRevision++;notifyTeamSession();}
function expireTeamSession(client:TeamClient){
 if(sharedClient!==client)return;
 client.clearSession();sharedClient=undefined;sessionExpired=true;sessionRevision++;savePlatformAuth(null);notifyTeamSession();
}
export async function loginTeamSession(base:string,name:string,password:string){
 if(sharedClient?.user)throw Error('请先退出当前团队账号');
 const next=new TeamClient(base);await next.login(name,password);rememberTeamServiceBase(next.base);activateTeamSession(next);return next;
}
export async function loginTeamWithPlatform(base:string,username:string,password:string,remember:boolean,platformBase=DEFAULT_PLATFORM_BASE,tenantId=DEFAULT_PLATFORM_TENANT){
 if(sharedClient?.user)throw Error('请先退出当前团队账号');
 const root=platformBase.replace(/\/$/,'');
 const response=await teamFetch(root+'/admin-api/system/auth/login',{method:'POST',headers:{'Content-Type':'application/json','tenant-id':tenantId},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(15000),redirect:'error',credentials:'omit'});
 const data=await response.json().catch(()=>null) as {code?:number;msg?:string;data?:{accessToken?:string;refreshToken?:string;expiresTime?:number}}|null;
 if(response.status===401||data?.code===401)throw Error('协同账号或密码错误');
 if(!response.ok||data?.code!==0||typeof data.data?.accessToken!=='string')throw Error(data?.msg||'协同登录失败');
 const auth:PlatformAuth={base:root,tenantId,username,accessToken:data.data.accessToken,refreshToken:data.data.refreshToken??'',expiresTime:data.data.expiresTime??0,remember};
 const next=new TeamClient(base);await next.loginWithPlatform(auth);savePlatformAuth(auth);rememberTeamServiceBase(next.base);activateTeamSession(next);return next;
}
export async function loginTeamWithAccessToken(accessToken:string,options:{base?:string;tenantId?:string;refreshToken?:string;expiresTime?:number;username?:string;remember?:boolean}={}){
 if(sharedClient?.user)throw Error('请先退出当前团队账号');
 if(typeof accessToken!=='string'||!accessToken)throw Error('缺少协同登录令牌');
 const base=options.base||defaultTeamServiceBase();
 const tenantId=options.tenantId||platformTenantId();
 const next=new TeamClient(base);
 await next.loginWithPlatform({accessToken,tenantId});
 const auth:PlatformAuth={base:DEFAULT_PLATFORM_BASE,tenantId,username:options.username??next.user?.name??'',accessToken,refreshToken:options.refreshToken??'',expiresTime:options.expiresTime??0,remember:options.remember!==false};
 savePlatformAuth(auth);rememberTeamServiceBase(next.base);activateTeamSession(next);return next;
}
export async function exchangeTeamAuthorizationCode(code:string,options:{base?:string;redirectUri?:string;tenantId?:string;state?:string;remember?:boolean}={}){
 return (await exchangeTeamAuthorizationCodeResult(code,options)).client;
}
async function exchangeTeamAuthorizationCodeResult(code:string,options:{base?:string;redirectUri?:string;tenantId?:string;state?:string;remember?:boolean}){
 if(sharedClient?.user)throw Error('请先退出当前团队账号');
 const base=options.base||defaultTeamServiceBase();
 const next=new TeamClient(base);
 const result=await next.request<{token:string;user:TeamUser;platform?:{accessToken:string;refreshToken?:string;expiresTime?:number}}>('login/sso/code',{code,redirectUri:options.redirectUri||platformOAuthRedirectUri(base),tenantId:options.tenantId||platformTenantId(),...(options.state!==undefined?{state:options.state}:{})});
 next.acceptSession(result.token,result.user);
 if(result.platform?.accessToken){
  savePlatformAuth({base:DEFAULT_PLATFORM_BASE,tenantId:options.tenantId||platformTenantId(),username:result.user.name,accessToken:result.platform.accessToken,refreshToken:result.platform.refreshToken??'',expiresTime:result.platform.expiresTime??0,remember:options.remember!==false});
 }
 rememberTeamServiceBase(next.base);activateTeamSession(next);return {client:next,platform:result.platform};
}
/** The callback page consumes the one-time code; other windows receive only platform tokens. */
export async function completeTeamOAuthCallbackPage(callback:PlatformOAuthCallback,options:{base?:string;remember?:boolean}={}):Promise<TeamClient>{
 clearPlatformOAuthCallbackFromUrl();
 try{
  if(callback.error)throw Error(callback.error);
  if(callback.accessToken){
   const {accessToken,refreshToken,expiresTime,state}=callback;
   const client=await loginTeamWithAccessToken(accessToken,{...options,refreshToken,expiresTime});
   publishPlatformOAuthResult({accessToken,refreshToken,expiresTime,state});
   return client;
  }
  if(callback.code){
   const {client,platform}=await exchangeTeamAuthorizationCodeResult(callback.code,{...options,state:callback.state});
   if(!platform?.accessToken)throw Error('协同登录回调缺少令牌');
   const {accessToken,refreshToken,expiresTime}=platform;
   publishPlatformOAuthResult({accessToken,refreshToken,expiresTime,state:callback.state});
   return client;
  }
  throw Error('协同登录回调缺少令牌或授权码');
 }catch(error){
  publishPlatformOAuthResult({error:error instanceof Error?error.message:String(error),state:callback.state});
  throw error;
 }
}
async function applyOAuthCallback(callback:PlatformOAuthCallback,base:string,remember:boolean){
 if(callback.error)throw Error(callback.error);
 if(callback.accessToken)return loginTeamWithAccessToken(callback.accessToken,{base,refreshToken:callback.refreshToken,expiresTime:callback.expiresTime,remember});
 if(callback.code)return exchangeTeamAuthorizationCode(callback.code,{base,remember,state:callback.state});
 throw Error('协同登录回调缺少令牌或授权码');
}
/** Desktop opens the system browser; callback lives on the team portal origin, so BroadcastChannel/localStorage never reach Tauri. Poll the one-time claim by OAuth state instead. */
export async function claimPlatformOAuthByState(base:string,state:string):Promise<PlatformOAuthCallback|undefined>{
 const response=await teamFetch(teamAddress(base)+'/api/team/login/sso/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state}),signal:AbortSignal.timeout(15000),redirect:'error',credentials:'omit'});
 if(response.status===404)return undefined;
 const data=await response.json().catch(()=>null) as {error?:string;platform?:{accessToken?:string;refreshToken?:string;expiresTime?:number}}|null;
 if(!response.ok)throw Error(data?.error??'协同登录领取失败');
 if(typeof data?.platform?.accessToken!=='string'||!data.platform.accessToken)return undefined;
 return {accessToken:data.platform.accessToken,refreshToken:data.platform.refreshToken,expiresTime:data.platform.expiresTime,state};
}
/** Open 协同 login/authorize; resolve when callback delivers accessToken or code (same-origin) or desktop claim poll. */
export async function beginTeamAuthorization(options:{base?:string;remember?:boolean;timeoutMs?:number;pollMs?:number}={}){
 if(sharedClient?.user)throw Error('请先退出当前团队账号');
 const base=options.base||defaultTeamServiceBase();
 const remember=options.remember!==false;
 // A new user action starts a new state, never a cached or unrelated prior login.
 clearPendingPlatformOAuth();
 if(parsePlatformOAuthCallback())clearPlatformOAuthCallbackFromUrl();
 const state=crypto.randomUUID();
 const timeoutMs=options.timeoutMs??300000;
 const pollMs=options.pollMs??1500;
 return await new Promise<TeamClient>((resolve,reject)=>{
  let settled=false;
  let applying=false;
  const cleanup=()=>{stopWatch();window.removeEventListener('focus',onFocus);window.clearTimeout(timer);window.clearInterval(pollTimer);};
  const settle=(fn:()=>void)=>{if(settled)return;settled=true;cleanup();fn();};
  const handle=(callback:PlatformOAuthCallback)=>{
   if(settled||applying||callback.state!==state)return;
   applying=true;
   void applyOAuthCallback(callback,base,remember).then(
    client=>{settle(()=>resolve(client));},
    error=>{settle(()=>reject(error instanceof Error?error:Error(String(error))));}
   );
  };
  const stopWatch=watchPlatformOAuthResult(handle);
  const onFocus=()=>{
   const again=consumePendingPlatformOAuth()||parsePlatformOAuthCallback();
   if(again){clearPlatformOAuthCallbackFromUrl();handle(again);return;}
   void claimPlatformOAuthByState(base,state).then(result=>{if(result)handle(result);}).catch(()=>{/* keep waiting */});
  };
  window.addEventListener('focus',onFocus);
  const pollTimer=window.setInterval(()=>{
   void claimPlatformOAuthByState(base,state).then(result=>{if(result)handle(result);}).catch(()=>{/* transient network; keep polling */});
  },pollMs);
  const timer=window.setTimeout(()=>settle(()=>reject(Error('协同登录超时，请重试「登录授权」'))),timeoutMs);
  // Install listeners before opening: a fast callback must not beat the watcher.
  void openPlatformAuthorizationWindow(buildPlatformAuthorizeUrl(base,state)).catch(error=>settle(()=>reject(error)));
 });
}
export async function logoutTeamSession(){const previous=sharedClient;sharedClient=undefined;sessionExpired=false;resumeRequest=undefined;sessionRevision++;clearPendingPlatformOAuth();savePlatformAuth(null);notifyTeamSession();await previous?.logout();}
/** Restore automatically only for the service that originally accepted this remembered account. */
export async function restoreRememberedTeamSession(){
 const base=defaultTeamServiceBase();
 try{const remembered=localStorage.getItem(TEAM_ADDRESS_KEY);if(!remembered||teamAddress(remembered)!==teamAddress(base))return undefined;}catch{return undefined;}
 return resumeTeamFromPlatformAuth(base);
}
export async function resumeTeamFromPlatformAuth(base:string,tenantId?:string){
 if(sharedClient?.user)return sharedClient;
 if(resumeRequest)return resumeRequest;
 const saved=loadPlatformAuth();if(!saved?.accessToken)return undefined;
 if(saved.expiresTime>0&&saved.expiresTime<Date.now()){savePlatformAuth(null);sessionExpired=true;notifyTeamSession();return undefined;}
 const revision=sessionRevision;
 const pending=(async()=>{
  try{
   const next=new TeamClient(base||defaultTeamServiceBase()||saved.base);
   await next.loginWithPlatform({accessToken:saved.accessToken,tenantId:tenantId??saved.tenantId??DEFAULT_PLATFORM_TENANT});
   // A delayed restore cannot sign the user back in after logout or replace a newer login.
   if(revision!==sessionRevision)return sharedClient;
   rememberTeamServiceBase(next.base);activateTeamSession(next);return next;
  }catch(error){
   if(revision===sessionRevision&&error instanceof TeamServiceError&&error.status===401){savePlatformAuth(null);sessionExpired=true;}
   return undefined;
  }
 })();
 resumeRequest=pending;notifyTeamSession();
 try{return await pending;}finally{if(resumeRequest===pending){resumeRequest=undefined;notifyTeamSession();}}
}
export function teamItemFromLink(link:TeamResourceLink,version=link.latestVersion):TeamItem{return {id:link.teamItemId,kind:link.kind,version,name:link.teamName,owner:'',description:'',created:''};}
export async function refreshLinkedTeamResources(kind:'asset'|'scene'):Promise<LocalTeamResourceState[]>{const client=sharedClient;if(!client?.user)throw Error('请先登录团队服务');const heads=await client.list(kind);await rememberTeamResourceHeads(client.base,kind,heads);return listLocalTeamResourceStates(kind);}
export async function copyTeamVersion(item:TeamVersion){
 assertLibraryReady();
 if(item.kind==='asset'){
  const asset=parseModelAsset(buildTeamCopyExport({...item,kind:'asset'}));
  asset.category=await acquirePublishedCategory('asset',publishedCategoryPath(item))??'其他';
  await saveModelAsset(asset);return asset.id;
 }
 const doc=parseProject(buildTeamCopyExport({...item,kind:'scene'}),MAX_TEAM_SCENE_BYTES);
 if(!createSession(doc,{moduleKind:'scene',title:item.name+' 副本',sceneCategory:await acquirePublishedCategory('scene',publishedCategoryPath(item)),libraryDescription:item.description,librarySavedAt:Date.now(),savedRevision:doc.revision},MAX_TEAM_SCENE_BYTES))throw Error('无法创建本地副本');
 await flushWorkspace();if(useWorkspaceStore.getState().error)throw Error('副本已创建，但本地保存失败，请先修复存储再继续');return doc.projectId;
}

export interface TeamLocalSource {id:string;version?:number}
export interface TeamPublishSource extends TeamLocalSource {name:string;kind:'asset'|'scene';teamLinks:TeamResourceLink[]}
export interface TeamPublishTargetResolution {link?:TeamResourceLink;target?:TeamItem;issue?:string}
/** Match provenance, never names; the linked fixed version remains the publication baseline. */
export function resolveTeamPublishTarget(client:TeamClient,source:TeamPublishSource,heads:TeamItem[]):TeamPublishTargetResolution{
 const links=source.teamLinks.filter(link=>link.status==='ready'&&link.kind===source.kind&&link.localId===source.id),matching=links.filter(link=>link.serviceOrigin===client.base);
 if(!matching.length)return links.length?{issue:'该资源关联其他团队服务，请切换对应服务或明确另存为新原件'}:{};
 if(new Set(matching.map(link=>link.teamItemId)).size!==1)return {issue:'该资源关联多个团队原件，请明确选择发布位置'};
 const link=matching.reduce((latest,current)=>current.teamVersion>latest.teamVersion?current:latest),target=heads.find(item=>item.kind===source.kind&&item.id===link.teamItemId);
 if(!target)return {link,issue:'关联的团队原件不存在或当前账号不可见，请确认权限或明确另存为新原件'};
 if(!client.user||client.user.role==='viewer'||target.owner!==client.user.id&&client.user.role!=='admin')return {link,target,issue:'当前账号没有追加该关联团队原件版本的权限，可明确另存为新原件'};
 if(target.version!==link.teamVersion)return {link,target,issue:`关联原件已从 v${link.teamVersion} 更新至 v${target.version}，请获取新版后编辑，或明确另存为新原件`};
 return {link,target};
}
export interface PreparedTeamPublication {
 source:TeamLocalSource;request:TeamPublish;serviceOrigin:string;userId:string;baselineFingerprint:string;sceneRevision?:number;
 status:'ready'|'running'|'success'|'error';error?:string;serverResult?:{id:string;version:number};
 upload?:TeamUploadProgress;bytes?:number;publication?:TeamPublicationPackage;startedAt?:number;endedAt?:number;
}
export async function listTeamPublishSources(kind:'asset'|'scene'):Promise<TeamPublishSource[]>{
 assertLibraryReady();await flushWorkspace();if(useWorkspaceStore.getState().error)throw Error('请先修复本地保存错误');
 const links=(await listTeamResourceLinks()).filter(link=>link.kind===kind&&link.status==='ready'),linksFor=(localId:string)=>links.filter(link=>link.localId===localId);
 return kind==='asset'?(await listModelAssets()).map(a=>({id:a.id,name:a.name,kind,version:a.version,teamLinks:linksFor(a.id)})):useWorkspaceStore.getState().sessions.filter(s=>!s.deletedAt&&(s.moduleKind??'scene')==='scene'&&s.librarySavedAt&&s.savedRevision===s.snapshot.doc.revision&&!s.snapshot.pendingBatch&&!s.snapshot.wasRunning).map(s=>({id:s.id,name:s.title,kind,teamLinks:linksFor(s.id)}));
}
/** Freeze only explicitly selected, saved content; no network publication is performed here. */
export async function prepareTeamPublications(client:TeamClient,kind:'asset'|'scene',sources:TeamLocalSource[],targets:Record<string,TeamItem|undefined>={},onProgress?:(progress:TeamPreparationProgress)=>void):Promise<PreparedTeamPublication[]>{
 if(!client.user||client.user.role==='viewer')throw Error('当前账号只有浏览权限');
 const userId=client.user.id,entries:PreparedTeamPublication[]=[];
 onProgress?.({stage:'reading',completed:0,total:sources.length});await yieldTeamPreparationPaint();
 assertLibraryReady();await flushWorkspace();if(useWorkspaceStore.getState().error)throw Error('请先修复本地保存错误');
 if(!sources.length||new Set(sources.map(s=>s.id)).size!==sources.length)throw Error('请选择不重复的已保存资源');
 const heads=kind==='asset'?await listModelAssets():[],links=(await listTeamResourceLinks()).filter(link=>link.kind===kind&&link.status==='ready');
 for(let index=0;index<sources.length;index++){let source=sources[index];
  const target=targets[source.id];if(target&&(target.kind!==kind||(target.owner!==client.user!.id&&client.user!.role!=='admin')))throw Error('你没有追加该团队原件版本的权限');
  const sourceLinks=links.filter(link=>link.localId===source.id);
  if(sourceLinks.length&&!Object.prototype.hasOwnProperty.call(targets,source.id))throw Error('该资源已有团队关联，请选择关联原件或明确选择新增到团队库');
  const targetLinks=target?sourceLinks.filter(link=>link.serviceOrigin===client.base&&link.teamItemId===target.id):[];
  if(target&&targetLinks.length&&target.version!==Math.max(...targetLinks.map(link=>link.teamVersion)))throw Error('关联原件已有其他版本，请获取新版后编辑，或明确另存为新原件；不会覆盖或自动使用最新版本');
  let name:string,description:string,category:string|undefined,sceneRevision:number|undefined,scene:SceneDocument|undefined,asset:{id:string;version:number}|undefined;
  if(kind==='asset'){
   const head=heads.find(a=>a.id===source.id);if(!head)throw Error('待发布资产不存在');if(source.version!==undefined&&source.version!==head.version)throw Error('待发布资产版本已变化，请重新选择');
   source={id:head.id,version:head.version};asset={id:head.id,version:head.version};name=head.name;description=head.description??'';category=head.category;
  }else{
   const session=useWorkspaceStore.getState().sessions.find(s=>s.id===source.id&&!s.deletedAt&&(s.moduleKind??'scene')==='scene');
   if(!session?.librarySavedAt||session.savedRevision!==session.snapshot.doc.revision||session.snapshot.pendingBatch||session.snapshot.wasRunning)throw Error('场景包含未保存修改或预览，请先保存到本地库后再发布');
   name=session.title;description=session.libraryDescription??'';category=session.sceneCategory;sceneRevision=session.snapshot.doc.revision;scene=session.snapshot.doc;
  }
  onProgress?.({stage:'reading',completed:index,total:sources.length,name});await yieldTeamPreparationPaint();
  const result=await prepareTeamPublicationSnapshot({kind,name,description,category,categoryPath:await localPublishedCategoryPath(kind,category),key:crypto.randomUUID(),expectedVersion:target?.version??0,...(target?{itemId:target.id}:{}),asset,scene},stage=>onProgress?.({stage,completed:index,total:sources.length,name}));
  entries.push({...result,source,serviceOrigin:client.base,userId,sceneRevision,status:'ready'});
  onProgress?.({stage:'ready',completed:index+1,total:sources.length,name});
 }
 return entries;
}
/** Retrying never re-freezes local content or changes keys, and successful entries are skipped. */
export async function publishPreparedTeamBatch(client:TeamClient,entries:PreparedTeamPublication[],onChange?:()=>void){
 if(!client.user||client.user.role==='viewer')throw Error('当前账号没有发布权限');
 if(entries.some(e=>e.serviceOrigin!==client.base||e.userId!==client.user!.id))throw Error('团队登录已变化，请重新准备发布');
 for(const entry of entries){if(entry.status==='success')continue;entry.status='running';entry.error=undefined;entry.startedAt=Date.now();entry.endedAt=undefined;entry.upload={phase:'preparing',loaded:0,total:entry.bytes??0};onChange?.();
  try{
   entry.serverResult??=await client.publish(entry.request,progress=>{entry.upload=progress;entry.bytes=progress.total;onChange?.();},entry.publication);
   await saveTeamResourceLink({serviceOrigin:client.base,kind:entry.request.kind,teamItemId:entry.serverResult.id,teamVersion:entry.serverResult.version,teamName:entry.request.name,localId:entry.source.id,localVersion:entry.source.version,sceneRevision:entry.sceneRevision,baselineFingerprint:entry.baselineFingerprint,direction:'publish',active:true,status:'ready',createdAt:new Date().toISOString(),latestVersion:entry.serverResult.version});
   entry.status='success';
  }catch(error){entry.status='error';entry.error=error instanceof Error?error.message:'发布失败，可重试同一项';}entry.endedAt=Date.now();onChange?.();
 }
}
const acquisitionFlights=new Map<string,Promise<{link:TeamResourceLink;reused:boolean}>>();
/** Explicit fixed-version acquisition: new remote versions always create separate local identities. */
export function acquireLinkedTeamVersion(client:TeamClient,item:TeamVersion):Promise<{link:TeamResourceLink;reused:boolean}>{
 const key=teamResourceKey(client.base,item.kind,item.id,item.version),existing=acquisitionFlights.get(key);if(existing)return existing;
 const operation=(async()=>{
  if(!client.user)throw Error('请先登录团队服务');assertLibraryReady();
  const links=await listTeamResourceLinks(),known=links.find(x=>x.serviceOrigin===client.base&&x.kind===item.kind&&x.teamItemId===item.id&&x.teamVersion===item.version&&x.direction==='acquire');
  if(known?.status==='ready'){
   const state=(await listLocalTeamResourceStates(item.kind,[known.localId])).find(x=>x.link.id===known.id);if(state?.localMissing)throw Error('该团队版本的本地副本已移除，请恢复旧副本；不会静默创建重复项');
   return {link:known,reused:true};
  }
  const projectId=crypto.randomUUID();
  let link=known??await reserveTeamResourceLink({serviceOrigin:client.base,kind:item.kind,teamItemId:item.id,teamVersion:item.version,teamName:item.name,localId:projectId,localProjectId:item.kind==='scene'?projectId:undefined,localVersion:item.kind==='asset'?1:undefined,sceneRevision:item.kind==='scene'?0:undefined,baselineFingerprint:'',direction:'acquire',active:false,status:'pending',createdAt:new Date().toISOString(),latestVersion:item.version});
  let payload:unknown,name:string,description:string|undefined,category:string|undefined;
  if(item.kind==='asset'){
   let asset=(await listModelAssets()).find(x=>x.id===link.localId)?await readModelAsset(link.localId,1):undefined;
   if(!asset){asset=parseModelAsset(buildTeamCopyExport({...item,kind:'asset'}));asset.id=link.localId;asset.category=await acquirePublishedCategory('asset',publishedCategoryPath(item))??'其他';await saveModelAsset(asset);}
   payload=asset;name=asset.name;description=asset.description;category=asset.category;
  }else{
   let session=useWorkspaceStore.getState().sessions.find(x=>x.snapshot.doc.projectId===link.localProjectId);
   if(session?.deletedAt)throw Error('该版本已获取后移入回收站，请恢复旧副本');
   if(!session){const doc=parseProject(buildTeamCopyExport({...item,kind:'scene'}),MAX_TEAM_SCENE_BYTES);doc.projectId=link.localProjectId!;
    if(!createSession(doc,{moduleKind:'scene',title:item.name.slice(0,76)+' 副本',sceneCategory:await acquirePublishedCategory('scene',publishedCategoryPath(item)),libraryDescription:item.description,librarySavedAt:Date.now(),savedRevision:doc.revision},MAX_TEAM_SCENE_BYTES))throw Error('无法创建本地副本');session=useWorkspaceStore.getState().sessions.find(x=>x.snapshot.doc.projectId===doc.projectId)!;}
   await flushWorkspace();if(useWorkspaceStore.getState().error)throw Error('副本已创建，但本地保存失败；修复后重试同一项');
   link={...link,localId:session.id};payload=scenePublication(session.snapshot.doc);name=session.title;description=session.libraryDescription;category=session.sceneCategory;
  }
  const newer=links.some(x=>x.serviceOrigin===client.base&&x.kind===item.kind&&x.teamItemId===item.id&&x.active&&x.teamVersion>item.version);
  link=await saveTeamResourceLink({...link,active:!newer,baselineFingerprint:await teamLocalFingerprint({kind:item.kind,payload,name,description,category})},link.id);
  return {link,reused:false};
 })();acquisitionFlights.set(key,operation);void operation.finally(()=>acquisitionFlights.delete(key)).catch(()=>{});return operation;
}
