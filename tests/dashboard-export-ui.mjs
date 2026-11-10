import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','Element','Node','MutationObserver','Event','MouseEvent','localStorage','SVGElement','DocumentFragment'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.getComputedStyle=dom.window.getComputedStyle;
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
HTMLElement.prototype.scrollIntoView=()=>{};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
let finish,fail;
globalThis.dashboardExportGate=()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'dashboard-export-fixtures',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/util/exportFile.ts'))return 'export async function exportFile(contents){await contents();return globalThis.dashboardExportGate();}';
 if(id.endsWith('/src/scene/exportHtml.ts'))return 'export async function exportHtml(){return "<html>scene</html>";} export function withHtmlViewerView(html){return html;}';
 if(id.endsWith('/src/ui/DashboardPresentation.tsx'))return 'export function DashboardPresentation(){return null;}';
 if(id.endsWith('/src/scene/dashboardRuntime.ts'))return 'export function buildDashboardExport(){return "<html>combined</html>";} export function inspectDashboardPlacement(){}';
}}]});
const originalFetch=globalThis.fetch;
const item={id:'board',version:1,name:'MES',description:'',system:'MES',archived:false,fileName:'board.html',entry:'index.html',created:''};
globalThis.fetch=async url=>{
 if(String(url).endsWith('/login'))return Response.json({token:'test',user:{id:'member',name:'Member',role:'member'}});
 if(String(url).endsWith('/source'))return new Response('source',{headers:{'Content-Length':'6'}});
 if(String(url).includes('/files?'))return new Response('html');
 if(String(url).endsWith('/board/1'))return Response.json({...item,files:[{path:'index.html',bytes:4}]});
 if(String(url).endsWith('/dashboards'))return Response.json([item]);
 throw Error('Unexpected URL '+url);
};
try{
 const api=await server.ssrLoadModule('/src/domain/teamLibrary.ts');
 await api.loginTeamSession('http://localhost','member','password');
 const {DashboardPage,DashboardSceneView}=await server.ssrLoadModule('/src/ui/DashboardPage.tsx');
 const {useEditorStore}=await server.ssrLoadModule('/src/store.ts');
 const {dashboardBinding}=await server.ssrLoadModule('/src/domain/dashboard.ts');
 const binding=dashboardBinding('http://localhost',item,'dashboard');
 useEditorStore.setState(state=>({doc:{...state.doc,dashboard:binding}}));
 let ui=render(React.createElement(DashboardPage));
 await waitFor(()=>assert.ok(ui.getByRole('button',{name:'导出源码'})));
 assert.equal(ui.getByRole('heading',{level:1}).textContent,'看板库');
 assert.equal(ui.queryByLabelText('看板概览'),null);assert.equal(ui.container.querySelector('.dashboard-stats'),null);assert.equal(ui.queryByText('可用模板'),null);
 assert.ok(ui.getByRole('region',{name:'当前场景已接入'}));
 async function exercise(button){
  fireEvent.click(ui.getByRole('button',{name:new RegExp(button)}));
  await waitFor(()=>assert.ok(ui.getByText('正在导出「MES」…')));
  assert.ok(ui.getByRole('button',{name:new RegExp(button)}).disabled);
  await act(async()=>finish('已保存到 /tmp/MES.html'));
  await waitFor(()=>assert.ok(document.querySelector('.ant-alert-success')?.textContent.includes('/tmp/MES.html')));
  fireEvent.click(ui.getByRole('button',{name:new RegExp(button)}));
  await waitFor(()=>assert.ok(ui.getByText('正在导出「MES」…')));
  await act(async()=>fail(Error('磁盘写入失败')));
  await waitFor(()=>assert.ok(document.querySelector('.ant-alert-error')?.textContent.includes('磁盘写入失败')));
  fireEvent.click(ui.getByRole('button',{name:new RegExp(button)}));
  await waitFor(()=>assert.ok(ui.getByText('正在导出「MES」…')));
  await act(async()=>finish(null));
  await waitFor(()=>assert.ok(document.querySelector('.ant-alert-info')?.textContent.includes('已取消导出')));
 }
 await exercise('导出源码');cleanup();
 ui=render(React.createElement(DashboardSceneView,{onClose(){}}));
 await waitFor(()=>assert.equal(ui.getByRole('button',{name:'导出组合大屏 HTML'}).disabled,false));
 await exercise('导出组合大屏 HTML');cleanup();
 console.log('PASS library title/stats/binding and source + HTML running, success, failure, cancel states');
}finally{cleanup();globalThis.fetch=originalFetch;delete globalThis.dashboardExportGate;await server.close();dom.window.close();}
