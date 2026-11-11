import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encode} from 'fast-png';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dir=await mkdtemp(join(tmpdir(),'dashboard-screenshot-ui-')),dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','Element','Node','MutationObserver','Event','MouseEvent','localStorage','SVGElement','DocumentFragment'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});let team,http;
try{
 team=openTeam(join(dir,'team.sqlite'));team.provision('admin','strong-dashboard-password','admin');
 const login=team.login('admin','strong-dashboard-password'),user=login.user;
 const middleware=teamMiddleware(team,()=>{});http=httpServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+http.address().port;
 const upload=team.dashboards.createUpload(user,{name:'本地模板',description:'',system:'MES',entry:'index.html',sourceKind:'folder',fileName:'local',expectedVersion:0,key:crypto.randomUUID()});const html=Buffer.from('<h1>actual template</h1>'),file=await team.dashboards.registerFile(user,upload.uploadId,{path:'index.html',size:html.length});await team.dashboards.writeChunk(user,upload.uploadId,file.fileId,{offset:0,base64:html.toString('base64')});const published=await team.dashboards.completeUpload(user,upload.uploadId,login.token);const item=team.dashboards.list(user)[0];
 const {TeamClient}=await server.ssrLoadModule('/src/domain/teamLibrary.ts'),{DashboardScreenshotDialog}=await server.ssrLoadModule('/src/ui/DashboardScreenshotDialog.tsx');const client=new TeamClient(base);client.acceptSession(login.token,user);
 let saved=0,closed=0;const ui=render(React.createElement(DashboardScreenshotDialog,{client,item,onClose:()=>closed++,onSaved:()=>saved++}));await waitFor(()=>assert.ok(ui.getByText(new RegExp(item.packageHash))));
 const pixels=new Uint8Array(320*180*4);pixels.fill(150);const png=encode({width:320,height:180,data:pixels,channels:4,depth:8});
 function choose(file){fireEvent.change(ui.getByLabelText('实际渲染截图'),{target:{files:[file]}});fireEvent.change(ui.getByLabelText('渲染来源说明'),{target:{value:'受控桌面实际渲染 index.html <img src=https://evil.invalid>'}});fireEvent.change(ui.getByLabelText('拍摄时间'),{target:{value:'2026-11-10T12:30'}});fireEvent.click(ui.getByRole('checkbox'));}
 let release;const delayed=new File([png],'shot.png',{type:'image/png'});Object.defineProperty(delayed,'arrayBuffer',{value:()=>new Promise(resolve=>{release=resolve;})});choose(delayed);fireEvent.click(ui.getByRole('button',{name:'确认绑定截图'}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'取消上传'})));fireEvent.click(ui.getByRole('button',{name:'取消上传'}));await act(async()=>release(png.buffer));await waitFor(()=>assert.ok(ui.getByText(/已取消上传，未发送绑定请求/)));assert.equal(team.dashboards.list(user)[0].screenshot,undefined);assert.equal(saved,0);
 choose(new File(['<svg onload="alert(1)"/>'],'fake.png',{type:'image/png'}));fireEvent.click(ui.getByRole('button',{name:/确认绑定截图$/}));await waitFor(()=>assert.ok(ui.getByText(/只接受 PNG/)));assert.equal(team.dashboards.list(user)[0].screenshot,undefined);assert.equal(saved,0);
 choose(new File([png],'shot.png',{type:'image/png'}));fireEvent.click(ui.getByRole('button',{name:/确认绑定截图$/}));await waitFor(()=>assert.equal(saved,1));const bound=team.dashboards.list(user)[0].screenshot;assert.equal(bound.templateId,published.id);assert.equal(bound.version,1);assert.equal(bound.source,'受控桌面实际渲染 index.html <img src=https://evil.invalid>');assert.equal(bound.confirmedBy,user.id);assert.equal(closed,0);cleanup();
 const rebound=render(React.createElement(DashboardScreenshotDialog,{client,item:team.dashboards.list(user)[0],onClose:()=>closed++,onSaved:()=>saved++}));await waitFor(()=>assert.ok(rebound.getByText(/当前截图来源/)));assert.equal(rebound.container.querySelector('img'),null);assert.equal(rebound.container.querySelector('iframe'),null);fireEvent.click(rebound.getByRole('button',{name:'取消截图绑定'}));await waitFor(()=>assert.equal(saved,2));assert.equal(team.dashboards.list(user)[0].screenshot,undefined);
 console.log('PASS real local HTTP administrator dialog: pre-send cancellation, invalid-image failure, retry success, source escaping, version/hash/actor persistence and unbind');
}finally{cleanup();if(http)await new Promise(resolve=>http.close(resolve));team?.close();await server.close();dom.window.close();await rm(dir,{recursive:true,force:true});}
