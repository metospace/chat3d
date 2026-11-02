import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location']) Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;
globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};globalThis.SVGElement=dom.window.SVGElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
installBrowserGlobals(dom);
let handler=async()=>new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'}]}));
globalThis.fetch=async(...args)=>{const r=await handler(...args);r.headers.set('x-chat3d-proxy','1');return r;};
const {render:rtlRender,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');const {Theme}=await import('@radix-ui/themes');const render=ui=>rtlRender(ui,{wrapper:({children})=>React.createElement(Theme,null,children)});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try{
 const {ToolbarAction}=await server.ssrLoadModule('/src/ui/ToolbarAction.tsx');
 await test('enabled toolbar action exposes name and useful hover title without changing click behavior',async()=>{let clicks=0;const ui=render(React.createElement(ToolbarAction,{label:'移动选中对象',help:'打开位置设置',onPress:()=>clicks++},'icon'));assert.ok(ui.getByTitle('移动选中对象：打开位置设置'));fireEvent.click(ui.getByRole('button',{name:'移动选中对象'}));assert.equal(clicks,1);});
 await test('disabled action remains focusable for explanation but cannot execute',async()=>{let clicks=0;const ui=render(React.createElement(ToolbarAction,{label:'撤销',help:'撤回修改',disabled:true,disabledReason:'当前没有可撤销的修改',onPress:()=>clicks++},'icon'));const target=ui.getByTitle('撤销：当前没有可撤销的修改');assert.equal(target.tabIndex,0);assert.equal(ui.getByRole('button',{name:'撤销'}).disabled,true);fireEvent.click(ui.getByRole('button',{name:'撤销'}));assert.equal(clicks,0);fireEvent.focus(target);await waitFor(()=>assert.match(ui.getByRole('tooltip').textContent,/当前没有可撤销/));});
 await test('asset search matches current display category and description while preserving stable key',async()=>{const {searchLibraryAssets}=await server.ssrLoadModule('/src/domain/libraryAssetSearch.ts');const row={id:'a',version:1,name:'托盘',category:'仓储',description:'可堆叠周转',size:[1,1,1],parts:1,createdAt:'2026-10-05',quality:'unreviewed'};const categories=[{value:'仓储',label:'物流容器',revision:1}];assert.equal(searchLibraryAssets([row],categories,'物流容器')[0].id,'a');assert.equal(searchLibraryAssets([row],categories,'堆叠')[0].category,'仓储');assert.equal(row.category,'仓储');assert.equal(searchLibraryAssets([row],categories,'不存在').length,0);});
 console.log(passed+' toolbar/help and category-search checks passed');
}finally{cleanup();await server.close();dom.window.close()}
