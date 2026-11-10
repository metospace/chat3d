import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';

const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});
installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','Node','MutationObserver','Event','MouseEvent','localStorage'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const observers=new Set();
globalThis.IntersectionObserver=class{
 constructor(callback){this.callback=callback;observers.add(this);}
 observe(target){this.target=target;}
 disconnect(){observers.delete(this);}
};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const originalFetch=globalThis.fetch,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
const calls=[],revoked=[],blobs=[];let status=200,networkFailure=false,opened=0;
URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:dashboard-'+blobs.length;};
URL.revokeObjectURL=url=>revoked.push(url);
try{
 const {DashboardCardPreview}=await server.ssrLoadModule('/src/ui/DashboardCardPreview.tsx');
 const {TeamClient}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');
 const client=new TeamClient('http://localhost');client.acceptSession('card-test-token',{id:'member',name:'member',role:'member'});
 globalThis.fetch=async(url,init)=>{
  calls.push(String(url));assert.equal(init.headers.Authorization,'Bearer card-test-token');
  assert.match(String(url),/\/api\/team\/dashboards\/board\/\d+\/thumbnail$/);
  if(networkFailure)throw new TypeError('Failed to fetch');
  return status===200?new Response('image-bytes',{headers:{'Content-Type':'image/png'}}):Response.json({error:'看板缩略图不存在'},{status});
 };
 const item={id:'board',version:1,name:'MES'};
 const card=version=>React.createElement(DashboardCardPreview,{client,item:{...item,version},disabled:false,onOpen:()=>opened++});
 const ui=render(card(1));assert.deepEqual(calls,[]);
 const reveal=()=>act(async()=>{for(const observer of [...observers])observer.callback([{isIntersecting:true}]);});
 await reveal();await waitFor(()=>assert.ok(ui.getByRole('img',{name:'MES 缩略图'})));
 assert.deepEqual(calls,['http://localhost/api/team/dashboards/board/1/thumbnail']);
 assert.equal(await blobs[0].text(),'image-bytes');assert.equal(blobs[0].type,'image/png');assert.equal(ui.container.querySelector('iframe'),null);
 fireEvent.click(ui.getByRole('button',{name:'预览 MES v1'}));assert.equal(opened,1);assert.equal(calls.length,1);
 status=404;ui.rerender(card(2));await waitFor(()=>assert.ok(ui.getByText('暂无缩略图')));assert.deepEqual(revoked,['blob:dashboard-1']);assert.equal(ui.queryByRole('alert'),null);
 networkFailure=true;ui.rerender(card(3));await waitFor(()=>assert.ok(ui.getByText('暂无缩略图')));assert.equal(ui.container.textContent.includes('Failed to fetch'),false);
 networkFailure=false;status=200;ui.rerender(card(4));await waitFor(()=>assert.ok(ui.getByRole('img')));fireEvent.error(ui.getByRole('img'));assert.ok(ui.getByText('暂无缩略图'));
 ui.unmount();assert.deepEqual(revoked,['blob:dashboard-1','blob:dashboard-2']);
 assert.deepEqual(calls.map(url=>url.split('/').slice(-2).join('/')),['1/thumbnail','2/thumbnail','3/thumbnail','4/thumbnail']);
 console.log('PASS visible cards fetch only authenticated thumbnails; missing, failed and invalid images stay calm; opening delegates and object URLs are revoked');
}finally{
 cleanup();globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;await server.close();dom.window.close();
}
