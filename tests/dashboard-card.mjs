import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','Node','MutationObserver','Event','MouseEvent','localStorage'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const observers=new Set();globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.add(this);}observe(){}disconnect(){observers.delete(this);}};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const originalFetch=globalThis.fetch,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
const calls=[],revoked=[],blobs=[],signals=[];let status=200,networkFailure=false,opened=0,gate;
URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:dashboard-'+blobs.length;};URL.revokeObjectURL=url=>revoked.push(url);
try{
 const {DashboardCardPreview,DashboardScreenshot}=await server.ssrLoadModule('/src/ui/DashboardCardPreview.tsx');
 const {TeamClient}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');const client=new TeamClient('http://localhost');client.acceptSession('card-test-token',{id:'member',name:'member',role:'member'});
 globalThis.fetch=async(url,init)=>{calls.push(String(url));signals.push(init.signal);assert.equal(init.headers.Authorization,'Bearer card-test-token');assert.match(String(url),/\/board\/\d+\/screenshot\/shot-\d+$/);if(gate)return gate;if(networkFailure)throw new TypeError('Failed to fetch');return status===200?new Response('image-bytes',{headers:{'Content-Type':'image/png'}}):Response.json({error:'暂无截图'},{status});};
 const item={id:'board',version:1,name:'MES',packageHash:'a'.repeat(64)};
 const value=version=>({...item,version,screenshot:{id:'shot-'+version,templateId:'board',version,packageHash:item.packageHash,bytes:11,provenance:'admin-confirmed-local-render'}});
 const card=item=>React.createElement(DashboardCardPreview,{client,item,disabled:false,onOpen:()=>opened++});
 const ui=render(card(value(1)));assert.deepEqual(calls,[]);await act(async()=>{for(const observer of [...observers])observer.callback([{isIntersecting:true}]);});await waitFor(()=>assert.ok(ui.getByRole('img')));
 assert.equal(await blobs[0].text(),'image-bytes');assert.equal(ui.container.querySelector('iframe'),null);fireEvent.click(ui.getByRole('button',{name:'预览 MES v1'}));assert.equal(opened,1);assert.equal(calls.length,1);
 status=404;ui.rerender(card(value(2)));await waitFor(()=>assert.ok(ui.getByText('暂无截图')));assert.deepEqual(revoked,['blob:dashboard-1']);
 networkFailure=true;ui.rerender(card(value(3)));await waitFor(()=>assert.ok(ui.getByText('暂无截图')));assert.equal(ui.container.textContent.includes('Failed to fetch'),false);
 networkFailure=false;status=200;ui.rerender(card(value(4)));await waitFor(()=>assert.ok(ui.getByRole('img')));fireEvent.error(ui.getByRole('img'));assert.ok(ui.getByText('暂无截图'));
 const count=calls.length;
 for(const invalid of [item,{...value(4),version:5},{...value(4),id:'different'},{...value(4),packageHash:'b'.repeat(64)},{...value(4),screenshot:{...value(4).screenshot,id:'https://evil.invalid'}}]){ui.rerender(card(invalid));assert.ok(ui.getByText('暂无截图'));assert.equal(calls.length,count);}
 let finish;gate=new Promise(resolve=>{finish=resolve;});ui.rerender(card(value(6)));await waitFor(()=>assert.equal(calls.length,count+1));const pendingSignal=signals.at(-1);ui.rerender(card(item));assert.equal(pendingSignal.aborted,true);await act(async()=>finish(new Response('image-bytes',{headers:{'Content-Type':'image/png'}})));assert.equal(ui.queryByRole('img'),null);assert.equal(blobs.length,2);
 gate=undefined;ui.unmount();assert.deepEqual(revoked,['blob:dashboard-1','blob:dashboard-2']);
 const detail=render(React.createElement(DashboardScreenshot,{client,item:value(7)}));await waitFor(()=>assert.ok(detail.getByRole('img')));assert.equal(detail.container.querySelector('iframe'),null);assert.ok(calls.every(url=>url.includes('/screenshot/')));
 console.log('PASS card/detail only fetch authenticated version-bound screenshots; legacy/mismatched/external metadata, failures, decode errors, abort races and URL cleanup');
}finally{cleanup();globalThis.fetch=originalFetch;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;await server.close();dom.window.close();}
