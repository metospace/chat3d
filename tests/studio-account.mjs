import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','DocumentFragment','SVGElement'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.getComputedStyle=dom.window.getComputedStyle;
globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=clearTimeout;
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
HTMLElement.prototype.scrollIntoView=()=>{};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {ConfigProvider}=await import('antd');
const Theme=({children})=>React.createElement(ConfigProvider,{theme:{token:{motion:false}}},children);
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
const originalFetch=globalThis.fetch;const requests=[];let rejectLogin=false,failLogout=false,itemStatus=200,itemResponse,restoreResponse;
globalThis.fetch=async(url,options={})=>{
 requests.push(String(url));
 if(String(url).endsWith('/login'))return rejectLogin?Response.json({error:'账户无效'},{status:401}):Response.json({token:'test-session-only',user:{id:'member-1',name:'测试成员',role:'member'}});
 if(String(url).endsWith('/logout')){if(failLogout)throw Error('network');return Response.json({ok:true});}
 if(String(url).endsWith('/login/sso'))return restoreResponse?await restoreResponse:Response.json({token:'restored-fixture',user:{id:'member-1',name:'测试成员',role:'member'}});
 if(String(url).includes('/items?'))return itemResponse?await itemResponse:Response.json(itemStatus===200?[]:{error:'权限或会话测试'}, {status:itemStatus});
 throw Error('Unexpected request: '+url);
};
try{
 const {StudioShell}=await server.ssrLoadModule('/src/ui/studio/StudioShell.tsx');
 const api=await server.ssrLoadModule('/src/domain/teamLibrary.ts'),auth=await server.ssrLoadModule('/src/domain/platformAuthStorage.ts');
 const workspace=await server.ssrLoadModule('/src/workspace.ts');
 await workspace.initializeWorkspace();
 const before=workspace.useWorkspaceStore.getState().sessions.map(s=>s.id);
 const visited=[];
 const ui=render(React.createElement(Theme,null,React.createElement(StudioShell,{activePage:'home',disabled:false,taskQueueRequest:0,onNavigate:page=>visited.push(page),onTaskOpen:()=>{},onTaskHistory:()=>{}})));
 assert.ok(ui.getByRole('button',{name:'登录账户',exact:true}));
 fireEvent.click(ui.getByRole('button',{name:'资源库',exact:true}));
 ui.rerender(React.createElement(Theme,null,React.createElement(StudioShell,{activePage:'asset',disabled:false,taskQueueRequest:0,onNavigate:page=>visited.push(page),onTaskOpen:()=>{},onTaskHistory:()=>{}})));
 fireEvent.click(ui.getByRole('button',{name:'场景库',exact:true}));
 assert.deepEqual(visited,['asset','scene']);assert.equal(requests.length,0);
 fireEvent.click(ui.getByRole('button',{name:'团队库',exact:true}));
 assert.ok(ui.getByRole('dialog',{name:'登录，连接你的团队'}));assert.ok(ui.getByRole('button',{name:'登录授权'}));
 assert.deepEqual(visited,['asset','scene']);assert.equal(requests.length,0);
 fireEvent.click(ui.getByRole('button',{name:'继续使用本地资源'}));
 await waitFor(()=>assert.equal(ui.queryByRole('dialog'),null));
 console.log('PASS guests can navigate local libraries; team access opens login without requesting team resources');

 rejectLogin=true;
 await act(async()=>assert.rejects(api.loginTeamSession('https://team.example','fixture','fixture'),/账户无效/));
 assert.ok(ui.getByRole('button',{name:'登录账户',exact:true}));assert.equal(api.getTeamSession(),undefined);
 rejectLogin=false;
 fireEvent.click(ui.getByRole('button',{name:'登录账户',exact:true}));
 const originVisits=[...visited];
 await act(async()=>{await api.loginTeamSession('https://team.example','fixture','fixture');});
 assert.deepEqual(visited,originVisits,'footer login must preserve the current page');
 assert.ok(ui.getByRole('button',{name:'账户菜单：测试成员'}));assert.ok(ui.getByText('团队成员 · 已登录'));
 fireEvent.click(ui.getByRole('button',{name:'团队库',exact:true}));assert.equal(visited.at(-1),'team');
 assert.equal(ui.queryByRole('dialog'),null);assert.ok(!JSON.stringify(localStorage).includes('test-session-only'));
 console.log('PASS identity comes from a successful shared session; failed login remains local-only');

 ui.rerender(React.createElement(Theme,null,React.createElement(StudioShell,{activePage:'team',disabled:false,taskQueueRequest:0,onNavigate:page=>visited.push(page),onTaskOpen:()=>{},onTaskHistory:()=>{}})));

 fireEvent.keyDown(ui.getByRole('button',{name:'账户菜单：测试成员'}),{key:'Enter'});
 await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'退出登录'})));
 failLogout=true;fireEvent.click(ui.getByRole('menuitem',{name:'退出登录'}));
 await waitFor(()=>assert.ok(ui.getByRole('button',{name:'登录账户',exact:true})));
 assert.equal(api.getTeamSession(),undefined);assert.ok(ui.getByRole('alert').textContent.includes('已退出本机账户'));
 assert.equal(visited.at(-1),'home','logging out from team resources returns to local home');
 fireEvent.click(ui.getByRole('button',{name:'团队库',exact:true}));assert.ok(ui.getByRole('dialog'));
 await act(async()=>{await api.loginTeamSession('https://team.example','fixture','fixture');});
 assert.equal(visited.at(-1),'team','login requested from team navigation continues to the team library');
 assert.deepEqual(workspace.useWorkspaceStore.getState().sessions.map(s=>s.id),before);
 console.log('PASS logout immediately gates team access even on network failure and preserves local projects');

 const client=api.getTeamSession();itemStatus=403;
 await act(async()=>assert.rejects(client.list('asset'),e=>e.status===403));
 assert.equal(api.getTeamSession(),client);assert.equal(api.getTeamSessionStatus(),'authenticated');
 itemStatus=401;
 await act(async()=>assert.rejects(client.list('asset'),/登录已失效/));
 assert.equal(api.getTeamSession(),undefined);assert.equal(api.getTeamSessionStatus(),'expired');
 assert.ok(ui.getByRole('button',{name:'重新登录团队账户'}));
 fireEvent.click(ui.getByRole('button',{name:'重新登录团队账户'}));assert.ok(ui.getByText(/团队登录已过期，请重新授权/));
 assert.deepEqual(workspace.useWorkspaceStore.getState().sessions.map(s=>s.id),before);
 console.log('PASS 403 preserves the account; 401 clears team access and offers reauthorization without changing local projects');

 await act(async()=>{await api.loginTeamSession('https://team.example','fixture','fixture');});
 const oldClient=api.getTeamSession();let releaseItem;
 itemResponse=new Promise(resolve=>{releaseItem=resolve;});
 const oldRequest=oldClient.list('asset');
 failLogout=false;await act(async()=>{await api.logoutTeamSession();await api.loginTeamSession('https://team.example','fixture','fixture');});
 const newerClient=api.getTeamSession();
 await act(async()=>{releaseItem(new Response('expired',{status:401}));await assert.rejects(oldRequest);});
 assert.equal(api.getTeamSession(),newerClient);
 console.log('PASS a late 401 from an old account cannot clear a newer session');
 cleanup();await api.logoutTeamSession();

 const saved={base:'https://team.example',tenantId:'1',username:'fixture',accessToken:'remembered-fixture',refreshToken:'',expiresTime:Date.now()+60000,remember:true};
 auth.savePlatformAuth(saved);let releaseRestore;
 restoreResponse=new Promise(resolve=>{releaseRestore=resolve;});
 const restoreCount=requests.filter(url=>url.endsWith('/login/sso')).length;
 const firstRestore=api.resumeTeamFromPlatformAuth(saved.base),secondRestore=api.resumeTeamFromPlatformAuth(saved.base);
 assert.equal(api.getTeamSessionStatus(),'restoring');assert.equal(requests.filter(url=>url.endsWith('/login/sso')).length,restoreCount+1);
 await api.logoutTeamSession();releaseRestore(Response.json({token:'late-restore',user:{id:'member-1',name:'测试成员',role:'member'}}));
 await Promise.all([firstRestore,secondRestore]);
 assert.equal(api.getTeamSession(),undefined);assert.equal(api.getTeamSessionStatus(),'guest');assert.equal(auth.loadPlatformAuth(),null);
 console.log('PASS remembered-session restore is deduplicated and cannot reverse an explicit logout');

 auth.savePlatformAuth(saved);const requestCount=requests.length;
 await api.restoreRememberedTeamSession();
 assert.equal(requests.length,requestCount,'automatic restore must not send remembered credentials to a different configured service');
 restoreResponse=Response.json({token:'restored-session',user:{id:'member-1',name:'测试成员',role:'member'}});
 await api.resumeTeamFromPlatformAuth(saved.base);assert.equal(api.getTeamSessionStatus(),'authenticated');
 await api.logoutTeamSession();auth.savePlatformAuth(saved);
 restoreResponse=Response.json({error:'expired'},{status:401});
 await api.resumeTeamFromPlatformAuth(saved.base);assert.equal(api.getTeamSessionStatus(),'expired');assert.equal(auth.loadPlatformAuth(),null);
 await api.logoutTeamSession();
 console.log('PASS automatic restore respects service binding; successful restore and revoked credentials set the correct account state');
}finally{cleanup();globalThis.fetch=originalFetch;await server.close();dom.window.close();}
