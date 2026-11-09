import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createVite} from 'vite';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/team/sso/callback?code=one-time&state=original-state'});
for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const messages=[];
const channels=new Set();
class Channel {
 constructor(){channels.add(this);}
 postMessage(value){messages.push(value);for(const channel of channels)if(channel!==this)channel.onmessage?.({data:value});}
 close(){channels.delete(this);}
}
Object.defineProperty(globalThis,'BroadcastChannel',{value:Channel,configurable:true});
let exchanges=0,tokenLogins=0,claims=0,expectedState;
const pendingByState=new Map();
const requests=[];
const service=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const value=body?JSON.parse(body):undefined;requests.push({url:req.url,value});
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/team/login/sso/code'){
  exchanges++;
  assert.equal(new URL(window.location.href).searchParams.has('code'),false);
  if(exchanges>1){res.statusCode=400;res.end(JSON.stringify({error:'code 不存在'}));return;}
  assert.equal(value.state,expectedState);
  assert.equal(value.redirectUri,base+'/team/sso/callback');
  pendingByState.set(value.state,{accessToken:'platform-access',refreshToken:'platform-refresh',expiresTime:1999999999999});
  res.end(JSON.stringify({token:'callback-session',user:{name:'Alice',role:'member'},platform:{accessToken:'platform-access',refreshToken:'platform-refresh',expiresTime:1999999999999}}));
 }else if(req.url==='/api/team/login/sso/claim'){
  claims++;
  const entry=pendingByState.get(value?.state);
  if(!entry){res.statusCode=404;res.end(JSON.stringify({error:'授权尚未完成或已过期'}));return;}
  pendingByState.delete(value.state);
  res.end(JSON.stringify({platform:entry}));
 }else if(req.url==='/api/team/login/sso'){
  tokenLogins++;assert.equal(value.accessToken,'platform-access');
  // Keep login in flight while both transports deliver the result.
  await new Promise(resolve=>setTimeout(resolve,20));
  res.end(JSON.stringify({token:'opener-session',user:{name:'Alice',role:'member'}}));
 }else res.end('{}');
});
await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${service.address().port}`;
const callbackVite=await createVite({server:{middlewareMode:true,ws:false},appType:'custom'});
const openerVite=await createVite({server:{middlewareMode:true,ws:false},appType:'custom'});
try{
 const callback=await callbackVite.ssrLoadModule('/src/domain/teamLibrary.ts');
 const oauth=await callbackVite.ssrLoadModule('/src/domain/platformOAuth.ts');
 const opener=await openerVite.ssrLoadModule('/src/domain/teamLibrary.ts');
 window.open=(url)=>{window.__lastOpenUrl=url;return {opener:null};};
 Object.defineProperty(globalThis,'__TAURI_INTERNALS__',{value:undefined,configurable:true});
 const authorizeState=()=>new URL(window.__lastOpenUrl.split('#')[1],'http://local.invalid').searchParams.get('state');
 // Stale URL/storage results must not authenticate a newly requested login.
 localStorage.setItem('chat3d.platform.oauth.pending',JSON.stringify({accessToken:'stale-token',state:'stale-state',at:Date.now()}));
 const waiting=opener.beginTeamAuthorization({base,timeoutMs:2000});
 expectedState=authorizeState();assert.ok(expectedState);
 assert.equal(oauth.parsePlatformOAuthCallback(),undefined);
 assert.equal(localStorage.getItem('chat3d.platform.oauth.pending'),null);
 oauth.publishPlatformOAuthResult({accessToken:'wrong-token',state:'another-attempt'});
 oauth.publishPlatformOAuthResult({accessToken:'missing-state-token'});
 window.dispatchEvent(new window.Event('focus'));
 assert.equal(tokenLogins,0);assert.equal(exchanges,0);
 window.history.replaceState({},'',`/team/sso/callback?code=one-time&state=${expectedState}`);
 const rawCallback=oauth.parsePlatformOAuthCallback();
 const client=await callback.completeTeamOAuthCallbackPage(rawCallback,{base});
 assert.equal(client.user.name,'Alice');
 assert.equal(oauth.parsePlatformOAuthCallback(),undefined);
 assert.deepEqual(messages.slice(-1),[{accessToken:'platform-access',refreshToken:'platform-refresh',expiresTime:1999999999999,state:expectedState}]);
 window.dispatchEvent(new window.StorageEvent('storage',{key:'chat3d.platform.oauth.pending',newValue:localStorage.getItem('chat3d.platform.oauth.pending')}));
 window.dispatchEvent(new window.Event('focus'));
 assert.equal((await waiting).user.name,'Alice');
 assert.equal(exchanges,1);assert.equal(tokenLogins,1);
 assert.deepEqual(requests.filter(r=>r.url!=='/api/team/login/sso/claim').map(r=>r.url),['/api/team/login/sso/code','/api/team/login/sso']);
 assert.equal(exchanges,1);assert.equal(tokenLogins,1);
 console.log('PASS callback exchanges once with state; opener accepts token delivery across BroadcastChannel/storage/focus without exchanging code');
 await callback.logoutTeamSession();await opener.logoutTeamSession();
 messages.length=0;claims=0;exchanges=0;tokenLogins=0;pendingByState.clear();requests.length=0;
 // Cross-origin desktop path: no BroadcastChannel/storage delivery; opener polls claim by state.
 window.history.replaceState({},'','/team/');
 const desktopWaiting=opener.beginTeamAuthorization({base,timeoutMs:4000,pollMs:50});
 // Claim-only delivery also covers a remote service callback on another origin.
 const opened=window.__lastOpenUrl;assert.ok(opened);
 const openedState=new URL(opened.slice(opened.indexOf('?')),'http://local.invalid').searchParams.get('state');
 assert.ok(openedState);
 window.history.replaceState({},'',`/team/sso/callback?code=one-time&state=${openedState}`);
 const desktopCallback=oauth.parsePlatformOAuthCallback();
 window.history.replaceState({},'','/team/');
 // Simulate portal callback exchange that stashes by state (no BC/localStorage to desktop)
 pendingByState.set(openedState,{accessToken:'platform-access',refreshToken:'platform-refresh',expiresTime:1999999999999});
 // Also exercise completeTeamOAuthCallbackPage publish path is optional for desktop; claim alone is enough
 assert.equal((await desktopWaiting).user.name,'Alice');
 assert.ok(claims>=1);assert.equal(tokenLogins,1);assert.equal(exchanges,0);
 assert.ok(requests.some(r=>r.url==='/api/team/login/sso/claim'));
 console.log('PASS desktop opener claims platform tokens by OAuth state without BroadcastChannel or code re-exchange');
 await opener.logoutTeamSession();
 messages.length=0;claims=0;exchanges=0;tokenLogins=0;pendingByState.clear();requests.length=0;
 await callback.completeTeamOAuthCallbackPage({accessToken:'platform-access',code:'spent-code',state:'stale-state',refreshToken:'platform-refresh'},{base});
 assert.equal(exchanges,0);assert.equal(tokenLogins,1);
 assert.deepEqual(messages,[{accessToken:'platform-access',refreshToken:'platform-refresh',expiresTime:undefined,state:'stale-state'}]);
 console.log('PASS access token takes precedence over stale code and publication retains state without code');
 await callback.logoutTeamSession();
 await assert.rejects(callback.completeTeamOAuthCallbackPage({error:'denied'},{base}),/denied/);
 await assert.rejects(callback.completeTeamOAuthCallbackPage({},{base}),/缺少令牌或授权码/);
 assert.equal(exchanges,0);
 assert.deepEqual(messages.slice(-1),[{error:'协同登录回调缺少令牌或授权码',state:undefined}]);
 // The watcher must be installed even if the popup delivers before open returns.
 messages.length=0;tokenLogins=0;
 window.open=url=>{
  window.__lastOpenUrl=url;
  oauth.publishPlatformOAuthResult({accessToken:'platform-access',state:authorizeState()});
  return {opener:window};
 };
 assert.equal((await opener.beginTeamAuthorization({base,timeoutMs:2000})).user.name,'Alice');
 assert.equal(tokenLogins,1);
 assert.equal(channels.size,0,'publisher and completed watcher channels are closed');
 await opener.logoutTeamSession();
 // A same-origin denial must reject immediately, not wait for the login timeout.
 window.open=url=>{window.__lastOpenUrl=url;return {opener:null};};
 const denied=opener.beginTeamAuthorization({base,timeoutMs:2000});
 const deniedState=authorizeState();
 await assert.rejects(callback.completeTeamOAuthCallbackPage({error:'access_denied',state:deniedState},{base}),/access_denied/);
 await assert.rejects(denied,/access_denied/);
 assert.equal(channels.size,0);
 // Errors and timestamps are preserved for a focus handoff; expired/undated records are ignored.
 assert.equal(oauth.consumePendingPlatformOAuth().error,'access_denied');
 for(const at of [undefined,Date.now()-600001,Date.now()+60000]){
  localStorage.setItem('chat3d.platform.oauth.pending',JSON.stringify({accessToken:'old',state:'old',at}));
  assert.equal(oauth.consumePendingPlatformOAuth(),undefined);
 }
 // Storage event payload survives another tab consuming/removing the persisted record.
 tokenLogins=0;
 const storageWaiting=opener.beginTeamAuthorization({base,timeoutMs:2000});
 const storageResult={accessToken:'platform-access',state:authorizeState(),at:Date.now()};
 localStorage.removeItem('chat3d.platform.oauth.pending');
 window.dispatchEvent(new window.StorageEvent('storage',{key:'chat3d.platform.oauth.pending',newValue:JSON.stringify(storageResult)}));
 assert.equal((await storageWaiting).user.name,'Alice');assert.equal(tokenLogins,1);
 await opener.logoutTeamSession();
 tokenLogins=0;
 const focusWaiting=opener.beginTeamAuthorization({base,timeoutMs:2000});
 localStorage.setItem('chat3d.platform.oauth.pending',JSON.stringify({accessToken:'platform-access',state:authorizeState(),at:Date.now()}));
 window.dispatchEvent(new window.Event('focus'));
 assert.equal((await focusWaiting).user.name,'Alice');assert.equal(tokenLogins,1);
 assert.equal(localStorage.getItem('chat3d.platform.oauth.pending'),null);
 await opener.logoutTeamSession();
 window.open=()=>null;
 await assert.rejects(opener.beginTeamAuthorization({base,timeoutMs:2000}),/允许弹窗/);
 assert.equal(channels.size,0,'blocked popups also dispose listeners');
 const originalFetch=globalThis.fetch;
 try{
  const unconfigured=new opener.TeamClient('http://localhost:1420');
  for(const status of [200,404]){
   globalThis.fetch=async()=>new Response('<html>Vite fallback</html>',{status,headers:{'Content-Type':'text/html'}});
   await assert.rejects(unconfigured.loginWithPlatform({accessToken:'isolated-test',tenantId:'1'}),error=>error.status===status&&/团队授权服务未返回 JSON.*CHAT3D_TEAM_DEV_BASE/.test(error.message));
  }
  globalThis.fetch=async()=>Response.json({}, {status:404});
  await assert.rejects(unconfigured.loginWithPlatform({accessToken:'isolated-test',tenantId:'1'}),/团队授权接口不存在.*CHAT3D_TEAM_DEV_BASE/);
  globalThis.fetch=async()=>Response.json({error:'明确的认证失败'}, {status:401});
  await assert.rejects(unconfigured.loginWithPlatform({accessToken:'isolated-test',tenantId:'1'}),/明确的认证失败/);
 }finally{globalThis.fetch=originalFetch;}
 console.log('PASS HTML/missing auth endpoints report backend configuration while JSON auth failures keep server details');
 console.log('PASS stale/missing/mismatched state is ignored; synchronous handoff, denial, timestamps and channel cleanup are covered');
}finally{
 await callbackVite.close();await openerVite.close();
 await new Promise(resolve=>service.close(resolve));dom.window.close();
}
