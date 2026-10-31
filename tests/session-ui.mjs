import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
import React from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location','DocumentFragment'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.indexedDB=indexedDB;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
HTMLElement.prototype.scrollIntoView=()=>{};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {Theme}=await import('@radix-ui/themes');
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let passed=0;
try{
 const {SessionSidebar}=await server.ssrLoadModule('/src/ui/SessionSidebar.tsx');
 const w=await server.ssrLoadModule('/src/workspace.ts');
 await w.initializeWorkspace();await w.flushWorkspace();
 const ui=render(React.createElement(Theme,null,React.createElement(SessionSidebar,{locked:false,onClose:()=>{}})));
 fireEvent.click(ui.getByRole('button',{name:'新建会话'}));assert.equal(w.useWorkspaceStore.getState().sessions.length,2);
 const id=w.useWorkspaceStore.getState().activeId;
 const menus=ui.getAllByRole('button',{name:'新建会话 的菜单'});
 fireEvent.keyDown(menus[0],{key:'Enter'});await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'重命名'})));
 fireEvent.click(ui.getByRole('menuitem',{name:'重命名'}));await waitFor(()=>assert.ok(ui.getByRole('dialog',{name:'重命名会话'})));
 fireEvent.change(ui.getByRole('textbox',{name:'会话名称'}),{target:{value:'AGV 项目'}});fireEvent.click(ui.getByRole('button',{name:'保存名称'}));
 await waitFor(()=>assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===id).title,'AGV 项目'));console.log('PASS Radix sidebar creates and renames session via keyboard-accessible menu/dialog');passed++;
 fireEvent.change(ui.getByRole('textbox',{name:'搜索会话'}),{target:{value:'找不到'}});assert.ok(ui.getByText('没有匹配的会话'));fireEvent.change(ui.getByRole('textbox',{name:'搜索会话'}),{target:{value:''}});console.log('PASS session filter provides empty state and restores list');passed++;
 fireEvent.keyDown(ui.getByRole('button',{name:'AGV 项目 的菜单'}),{key:'Enter'});await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'移至回收站'})));fireEvent.click(ui.getByRole('menuitem',{name:'移至回收站'}));await waitFor(()=>assert.ok(ui.getByRole('alertdialog')));fireEvent.click(ui.getByRole('button',{name:'移至回收站',exact:true}));await waitFor(()=>assert.ok(w.useWorkspaceStore.getState().sessions.find(s=>s.id===id).deletedAt));fireEvent.click(ui.getByRole('button',{name:'回收站',exact:true}));fireEvent.click(ui.getByRole('button',{name:'恢复 AGV 项目'}));assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===id).deletedAt,null);console.log('PASS confirmed trash action remains recoverable through sidebar');passed++;

 fireEvent.click(ui.getByRole('button',{name:'返回会话',exact:true}));
 fireEvent.keyDown(ui.getByRole('button',{name:'AGV 项目 的菜单'}),{key:'Enter'});await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'置顶会话'})));fireEvent.click(ui.getByRole('menuitem',{name:'置顶会话'}));assert.equal(w.useWorkspaceStore.getState().sessions.find(s=>s.id===id).pinned,true);console.log('PASS session pin action persists without changing project contents');passed++;
 fireEvent.click(ui.getByRole('button',{name:'草稿',exact:true}));assert.ok(ui.getByText('没有未发送的草稿'));fireEvent.click(ui.getByRole('button',{name:'全部',exact:true}));assert.ok(ui.getByRole('button',{name:'AGV 项目 的菜单'}));console.log('PASS draft filter has an accurate empty state and is reversible');passed++;
 await act(async()=>w.flushWorkspace());console.log(`${passed} session UI checks passed in jsdom`);
}finally{cleanup();await server.close();dom.window.close()}
