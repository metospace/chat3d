import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','Element','Node','localStorage','MutationObserver'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);globalThis.cancelAnimationFrame=clearTimeout;
const {render,fireEvent,waitFor,cleanup,within}=await import('@testing-library/react'),{ConfigProvider}=await import('antd');
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {TaskCenter}=await server.ssrLoadModule('/src/ui/StudioPages.tsx'),w=await server.ssrLoadModule('/src/workspace.ts'),{useEditorStore:s}=await server.ssrLoadModule('/src/store.ts');
 await w.initializeWorkspace();w.createSession(undefined,{moduleKind:'asset',title:'待查看的历史项目'});const history=w.useWorkspaceStore.getState().activeId;
 const message=s.getState().addUserMessage('历史建模指令',[]);s.getState().updateMessageRun(message,{startedAt:Date.now(),endedAt:Date.now(),status:'completed',mode:'single'});
 w.createSession(undefined,{moduleKind:'scene',title:'当前未完成项目'});const current=w.useWorkspaceStore.getState().activeId;s.getState().setComposerText('不要丢失这条草稿');let opened=0;
 const ui=render(React.createElement(ConfigProvider,{theme:{token:{motion:false}}},React.createElement(TaskCenter,{locked:false,onOpen:()=>opened++})));
 await waitFor(()=>assert.ok(ui.getByRole('button',{name:'待查看的历史项目',exact:true})));fireEvent.click(ui.getByRole('button',{name:'待查看的历史项目',exact:true}));
 await waitFor(()=>assert.ok(ui.getByRole('dialog',{name:'待查看的历史项目',exact:true})));assert.equal(w.useWorkspaceStore.getState().activeId,current);assert.equal(s.getState().composerText,'不要丢失这条草稿');
 console.log('PASS inspecting another task keeps the active project and unsent draft');
 fireEvent.click(within(ui.getByRole('dialog',{name:'待查看的历史项目',exact:true})).getByRole('button',{name:'前往对话',exact:true}));
 assert.equal(opened,1);assert.equal(w.useWorkspaceStore.getState().activeId,history);assert.equal(w.getSessionEditor(current).getState().composerText,'不要丢失这条草稿');
 console.log('PASS explicit project entry switches only the selected task and preserves the previous draft');
 const {instructionContract,referenceReconstructionContract}=await server.ssrLoadModule('/src/ai/instructionContract.ts');
 assert.match(instructionContract({single:true,selectionOnly:true}),/JSON对象的summary字段/);assert.match(instructionContract({selectionOnly:true}),/仅选中对象/);assert.match(referenceReconstructionContract(),/不同视角/);assert.match(referenceReconstructionContract(),/任务中断/);
 console.log('PASS shared instruction contracts preserve scope, preview authorization and reference review distinctions');
 await w.flushWorkspace();
}finally{cleanup();await server.close();dom.window.close();}
