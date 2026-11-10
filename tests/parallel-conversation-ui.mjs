import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
import React from 'react';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});
for(const key of ['window','document','HTMLElement','HTMLInputElement','Node','Element','DocumentFragment','NodeFilter','MutationObserver','Event','MouseEvent','CustomEvent','localStorage','location'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
installBrowserGlobals(dom);
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.indexedDB=indexedDB;globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=clearTimeout;
const {render,fireEvent,waitFor,act,cleanup}=await import('@testing-library/react');
const {Theme}=await import('@radix-ui/themes');
let requests=[],handler;
globalThis.fetch=async(...args)=>{const item={args};requests.push(item);const response=await handler(item);response.headers.set('x-chat3d-proxy','1');return response;};
// Optional deterministic cold-bootstrap probe; does not change any UI wait timeout.
const importDelay=Number(process.env.CHAT3D_TEST_AGENT_IMPORT_DELAY_MS??0);let delayedAgentImport=false;
const server=await createServer({plugins:[{name:'parallel-test-cold-bootstrap',enforce:'pre',async load(id,options){if(options?.ssr&&id.endsWith('/src/ai/modelingAgent.ts')&&importDelay>0){delayedAgentImport=true;await new Promise(resolve=>setTimeout(resolve,importDelay));}}}],server:{middlewareMode:true},appType:'custom'});
const response=text=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
try{
 const {useEditorStore:editor}=await server.ssrLoadModule('/src/store.ts');
 const {ChatPanel}=await server.ssrLoadModule('/src/ui/ChatPanel.tsx');
 const w=await server.ssrLoadModule('/src/workspace.ts');const {useConversationRuns}=await server.ssrLoadModule('/src/runtime/conversationController.ts');
 // Production lazy-loads this large module on the first send. Await the actual SSR
 // compilation here so the default 1-second UI wait measures the mocked request,
 // not cold transform/dependency startup. Import errors now fail setup directly.
 const agentModule=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 assert.equal(typeof agentModule.runModelingAgent,'function');
 if(importDelay>0)assert.equal(delayedAgentImport,true,'cold-bootstrap probe must delay the real SSR module load');
 const config={baseURL:'https://example.test/v1',apiKey:'only-A-secret',model:'A-model',agentMode:'pi',stream:true,taskBudget:{maxMinutes:10,maxRounds:12,maxReportedTokens:12345}};
 editor.setState({aiConfig:config});await w.initializeWorkspace();const a=w.useWorkspaceStore.getState().activeId;
 function Harness(){const activeId=w.useWorkspaceStore(s=>s.activeId);return React.createElement(Theme,null,React.createElement(ChatPanel,{key:activeId}));}
 let ui=render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
 const send=text=>{fireEvent.change(ui.getByLabelText('建模描述'),{target:{value:text}});fireEvent.click(ui.getByRole('button',{name:'发送',exact:true}));};
 handler=item=>new Promise(resolve=>item.resolve=resolve);
 send('讨论 A 货架');await waitFor(()=>assert.equal(requests.length,1));
 fireEvent.change(ui.getByLabelText('建模描述'),{target:{value:'A 要蓝色'}});fireEvent.click(ui.getByRole('button',{name:'暂存补充要求'}));assert.ok(ui.getByRole('region',{name:'排队消息'}));
 await act(async()=>{w.createSession();editor.setState({aiConfig:{...config,apiKey:'only-B-secret',model:'B-model'}});});const b=w.useWorkspaceStore.getState().activeId;
 assert.equal(requests[0].args[1].signal.aborted,false);send('讨论 B 托盘');await waitFor(()=>assert.equal(requests.length,2));assert.equal(useConversationRuns.getState().activeCount,2);
 console.log('PASS keyed ChatPanel unmount/navigation preserves A while B begins its own mocked stream');
 fireEvent.change(ui.getByLabelText('建模描述'),{target:{value:'B 材质问题'}});fireEvent.click(ui.getByRole('button',{name:'暂存补充要求'}));fireEvent.keyDown(ui.getByRole('button',{name:'消息选项 B 材质问题'}),{key:'Enter'});fireEvent.click(ui.getByRole('menuitem',{name:'只提问，不修改模型'}));
 await act(async()=>w.createSession());const c=w.useWorkspaceStore.getState().activeId;send('C 输入不能丢');assert.equal(requests.length,2);assert.equal(ui.getByLabelText('建模描述').value,'C 输入不能丢');assert.match(ui.getByRole('status').textContent,/2 个会话/);
 await act(async()=>w.switchSession(a));assert.ok(ui.getByRole('region',{name:'排队消息'}));fireEvent.click(ui.getByRole('button',{name:'引导',exact:true}));assert.equal(requests.length,2);assert.ok(ui.getByText('补充要求 · 等待接收'));
 await act(async()=>w.switchSession(b));assert.equal(ui.queryByText('A 要蓝色'),null);fireEvent.click(ui.getByRole('button',{name:'停止生成'}));assert.equal(requests[1].args[1].signal.aborted,true);assert.equal(requests[0].args[1].signal.aborted,false);assert.ok(ui.getByText('补充要求 · 未送达，可重新发送'));
 await act(async()=>requests[1].resolve(response('LATE B SHOULD BE IGNORED')));assert.equal(w.getSessionEditor(b).getState().messages.some(m=>m.text.includes('LATE B')),false);
 console.log('PASS cap refusal preserves input; steering and cancellation follow the original conversation after remount');
 handler=async()=>response('已收到 A 蓝色要求');await act(async()=>requests[0].resolve(response('A 初步建议')));await waitFor(()=>assert.equal(w.getSessionEditor(a).getState().aiStatus,'idle'));
 assert.equal(requests.length,3);assert.match(requests[2].args[1].body,/A 要蓝色/);assert.doesNotMatch(requests[2].args[1].body,/B 材质问题|讨论 B/);assert.equal(JSON.parse(requests[2].args[1].body).model,'A-model');assert.equal(new Headers(requests[2].args[1].headers).get('authorization'),'Bearer only-A-secret');
 await act(async()=>w.switchSession(c));assert.equal(ui.getByLabelText('建模描述').value,'C 输入不能丢');await act(async()=>new Promise(r=>setTimeout(r,30)));assert.equal(requests.length,3);
 console.log('PASS resumed A retains original model/key and refused C never auto-runs');
 await act(async()=>{w.switchSession(a);editor.getState().setComposerText('保留 A 草稿');});ui.unmount();assert.equal(w.getSessionEditor(a).getState().composerText,'保留 A 草稿');ui=render(React.createElement(Harness));assert.equal(ui.getByLabelText('建模描述').value,'保留 A 草稿');
 await act(async()=>w.flushWorkspace());assert.equal(useConversationRuns.getState().activeCount,0);
 console.log('4 parallel conversation UI checks passed (mocked models only)');
}finally{cleanup();await server.close();dom.window.close();}
