import {DEFAULT_PLATFORM_BASE,DEFAULT_PLATFORM_TENANT} from './platformAuthStorage';

/** Production team API/portal origin (docs: portal.jiezi-ai.com hosts /team and /api/team). */
export const DEFAULT_TEAM_SERVICE_BASE='https://portal.jiezi-ai.com';
/** OAuth public client id (secret stays server-only). */
export const DEFAULT_OAUTH_CLIENT_ID='scenivo';
/** Collaborative SSO UI domain; authorization uses its /#/sso hash route. */
export const DEFAULT_SSO_UI_BASE='http://pm.jiezi365.com:48001';
export const SSO_CALLBACK_PATH='/team/sso/callback';

type ViteEnv={
 VITE_CHAT3D_TEAM_DEFAULT_BASE?:string;
 VITE_CHAT3D_TEAM_SHOW_PASSWORD_LOGIN?:string;
 VITE_CHAT3D_PLATFORM_AUTH_BASE?:string;
 VITE_CHAT3D_PLATFORM_TENANT_ID?:string;
 VITE_CHAT3D_PLATFORM_OAUTH_CLIENT_ID?:string;
 VITE_CHAT3D_PLATFORM_OAUTH_REDIRECT_URI?:string;
 VITE_CHAT3D_PLATFORM_SSO_UI_BASE?:string;
 VITE_CHAT3D_PLATFORM_LOGIN_URL?:string;
};
function env():ViteEnv{
 try{return (import.meta as ImportMeta & {env?:ViteEnv}).env??{};}catch{return {};}
}
function globalFlag(name:string){
 return typeof globalThis!=='undefined'&&(globalThis as Record<string,unknown>)[name]===true;
}

export function configuredTeamServiceBase(){
 const fromEnv=env().VITE_CHAT3D_TEAM_DEFAULT_BASE?.trim();
 return (fromEnv||DEFAULT_TEAM_SERVICE_BASE).replace(/\/$/,'');
}

/** Local team password fields: off by default; Vite env or test global may enable. */
export function showTeamPasswordLogin(){
 return env().VITE_CHAT3D_TEAM_SHOW_PASSWORD_LOGIN==='1'||globalFlag('__CHAT3D_TEAM_SHOW_PASSWORD_LOGIN__');
}

export function platformAuthBase(){
 return (env().VITE_CHAT3D_PLATFORM_AUTH_BASE?.trim()||DEFAULT_PLATFORM_BASE).replace(/\/$/,'');
}
export function platformTenantId(){
 return env().VITE_CHAT3D_PLATFORM_TENANT_ID?.trim()||DEFAULT_PLATFORM_TENANT;
}
export function platformOAuthClientId(){
 return env().VITE_CHAT3D_PLATFORM_OAUTH_CLIENT_ID?.trim()||DEFAULT_OAUTH_CLIENT_ID;
}
export function platformSsoUiBase(){
 return (env().VITE_CHAT3D_PLATFORM_SSO_UI_BASE?.trim()||DEFAULT_SSO_UI_BASE).replace(/\/$/,'');
}
export function platformOAuthRedirectUri(teamBase:string){
 const configured=env().VITE_CHAT3D_PLATFORM_OAUTH_REDIRECT_URI?.trim();
 if(configured)return configured;
 // Local dev/desktop always callbacks to the running origin (e.g. http://127.0.0.1:1420/…).
 if(typeof window!=='undefined'){
  const origin=window.location?.origin??'';
  if(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin))return origin+SSO_CALLBACK_PATH;
 }
 return (teamBase||configuredTeamServiceBase()).replace(/\/$/,'')+SSO_CALLBACK_PATH;
}

/**
 * Build collaborative SSO authorize URL.
 * 协同 admin UI uses Vue hash history, so the route must be `/#/sso?…` (not path `/sso?…`).
 * Path `/sso` only hits SPA fallback HTML; the router then lands on `#/home` and never issues a code.
 * Omit scope: 协同 auto-approves when it is present, bypassing explicit consent.
 */
export function buildPlatformAuthorizeUrl(teamBase:string,state:string){
 const redirect=platformOAuthRedirectUri(teamBase);
 const clientId=platformOAuthClientId();
 const loginOverride=env().VITE_CHAT3D_PLATFORM_LOGIN_URL?.trim();
 if(loginOverride){
  const url=new URL(loginOverride);
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('redirect_uri',redirect);
  url.searchParams.set('response_type','code');
  url.searchParams.delete('scope');
  url.searchParams.set('state',state);
  return url.toString();
 }
 const q=new URLSearchParams({
  client_id:clientId,
  redirect_uri:redirect,
  response_type:'code',
  state,
 });
 return platformSsoUiBase()+'/#/sso?'+q.toString();
}

export interface PlatformOAuthCallback {
 accessToken?:string;
 refreshToken?:string;
 expiresTime?:number;
 code?:string;
 state?:string;
 error?:string;
}

/** Parse OAuth callback from the current location (query or hash). */
export function parsePlatformOAuthCallback(locationLike:{search?:string;hash?:string}=typeof window!=='undefined'?window.location:{}):PlatformOAuthCallback|undefined{
 const params=new URLSearchParams(locationLike.search??'');
 const hash=locationLike.hash?.startsWith('#')?locationLike.hash.slice(1):locationLike.hash??'';
 const hashParams=new URLSearchParams(hash.includes('=')?hash:'');
 const get=(key:string)=>params.get(key)??hashParams.get(key)??undefined;
 const accessToken=get('accessToken')??get('access_token')??undefined;
 const refreshToken=get('refreshToken')??get('refresh_token')??undefined;
 const expiresRaw=get('expiresTime')??get('expires_in');
 const code=get('code')??undefined;
 const state=get('state')??undefined;
 const error=get('error')??get('error_description')??undefined;
 if(!accessToken&&!code&&!error)return undefined;
 const expiresTime=expiresRaw?Number(expiresRaw):undefined;
 return {accessToken,refreshToken,expiresTime:Number.isFinite(expiresTime)?(expiresTime! < 1e12?Date.now()+expiresTime!*1000:expiresTime):undefined,code,state,error};
}

export function clearPlatformOAuthCallbackFromUrl(){
 if(typeof window==='undefined'||!window.history?.replaceState)return;
 try{
  const url=new URL(window.location.href);
  for(const key of ['accessToken','access_token','refreshToken','refresh_token','expiresTime','expires_in','code','state','error','error_description'])url.searchParams.delete(key);
  url.hash='';
  window.history.replaceState({},document.title,url.pathname+url.search);
 }catch{/* ignore */}
}

const CHANNEL='chat3d-platform-oauth';
const PENDING_KEY='chat3d.platform.oauth.pending';

export function publishPlatformOAuthResult(result:PlatformOAuthCallback){
 try{localStorage.setItem(PENDING_KEY,JSON.stringify({...result,at:Date.now()}));}catch{/* ignore */}
 try{new BroadcastChannel(CHANNEL).postMessage(result);}catch{/* ignore */}
}

export function clearPendingPlatformOAuth(){
 try{localStorage.removeItem(PENDING_KEY);}catch{/* ignore */}
}
export function consumePendingPlatformOAuth():PlatformOAuthCallback|undefined{
 try{
  const raw=localStorage.getItem(PENDING_KEY);if(!raw)return undefined;
  localStorage.removeItem(PENDING_KEY);
  const parsed=JSON.parse(raw) as PlatformOAuthCallback & {at?:number};
  if(parsed.at&&Date.now()-parsed.at>600000)return undefined;
  // After clearing remember / failed attempts, ignore leftovers without a usable credential.
  if(parsed.error&&!parsed.code&&!parsed.accessToken)return undefined;
  if(!parsed.code&&!parsed.accessToken)return undefined;
  return parsed;
 }catch{return undefined;}
}

export function watchPlatformOAuthResult(onResult:(result:PlatformOAuthCallback)=>void):()=>void{
 const onStorage=(event:StorageEvent)=>{
  if(event.key!==PENDING_KEY||!event.newValue)return;
  const result=consumePendingPlatformOAuth();if(result)onResult(result);
 };
 window.addEventListener('storage',onStorage);
 let channel:BroadcastChannel|undefined;
 try{
  channel=new BroadcastChannel(CHANNEL);
  channel.onmessage=(event)=>{if(event.data&&typeof event.data==='object')onResult(event.data as PlatformOAuthCallback);};
 }catch{/* ignore */}
 return ()=>{window.removeEventListener('storage',onStorage);channel?.close();};
}

/** Open the platform authorize/login page in the system browser (desktop) or a new tab (web). */
export async function openPlatformAuthorizationWindow(url:string){
 const desktop=Boolean((globalThis as {__TAURI_INTERNALS__?:unknown}).__TAURI_INTERNALS__);
 if(desktop){
  const {openUrl}=await import('@tauri-apps/plugin-opener');
  await openUrl(url);
  return;
 }
 // Do not pass "noopener" in windowFeatures: modern browsers then return null from window.open,
 // which falsely triggers「无法打开协同登录窗口」. Null opener after open is enough.
 const popup=window.open(url,'_blank');
 if(!popup)throw Error('无法打开协同登录窗口，请允许弹窗后重试');
 try{popup.opener=null;}catch{/* ignore */}
}
