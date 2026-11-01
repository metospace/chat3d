import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
import React from 'react';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location','DocumentFragment'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
installBrowserGlobals(dom);
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.indexedDB=indexedDB;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};globalThis.SVGElement=dom.window.SVGElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
HTMLElement.prototype.scrollIntoView=()=>{};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {ConfigProvider}=await import('antd');
const server=await createServer({plugins:[{name:'workbench-viewport-fixture',enforce:'pre',load(id){if(id.endsWith('/src/ui/ViewportPanel.tsx'))return "import React from 'react';export function ViewportPanel(){return React.createElement('div',{'data-testid':'viewport-fixture'});}";}}],server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});let passed=0;

try{
 const {default:App}=await server.ssrLoadModule('/src/App.tsx'),w=await server.ssrLoadModule('/src/workspace.ts'),{useEditorStore:store}=await server.ssrLoadModule('/src/store.ts'),{clampConversationWidth,CONVERSATION_WIDTH_KEY}=await server.ssrLoadModule('/src/ui/ConversationResize.tsx');
 Object.defineProperty(window,'innerWidth',{value:1440,writable:true,configurable:true});
 await w.initializeWorkspace();await w.flushWorkspace();localStorage.removeItem(CONVERSATION_WIDTH_KEY);let ui=render(React.createElement(ConfigProvider,{theme:{token:{motion:false}}},React.createElement(App)));fireEvent.click(ui.getByRole('button',{name:'新建项目',exact:true}));fireEvent.click(ui.getByRole('menuitem',{name:/新建空白/}));
 const input=ui.getByRole('textbox',{name:'建模指令'}),separator=ui.getByRole('separator',{name:'调整对话区宽度'});assert.equal(input.rows,4);console.log('PASS conversation and multiline composer are open by default');passed++;
 fireEvent.change(input,{target:{value:'保持其他模型不变\n只调整托盘位置'}});const initial=Number(separator.getAttribute('aria-valuenow'));fireEvent.keyDown(separator,{key:'ArrowLeft'});assert.equal(Number(separator.getAttribute('aria-valuenow')),initial+24);assert.equal(input.value,'保持其他模型不变\n只调整托盘位置');console.log('PASS keyboard resizing widens conversation without losing draft');passed++;
 fireEvent.keyDown(separator,{key:'Home'});assert.equal(separator.getAttribute('aria-valuenow'),'360');fireEvent.keyDown(separator,{key:'End'});assert.equal(Number(separator.getAttribute('aria-valuenow')),clampConversationWidth(720));assert.equal(Number(localStorage.getItem(CONVERSATION_WIDTH_KEY)),clampConversationWidth(720));console.log('PASS separator is bounded and width preference is saved');passed++;
 assert.equal(ui.queryByRole('button',{name:'展开输入框'}),null);assert.equal(ui.queryByRole('button',{name:'缩小输入框'}),null);assert.equal(input.rows,4);console.log('PASS composer remains usable without expand control');passed++;
 fireEvent.click(ui.getByRole('button',{name:'收起对话区'}));assert.equal(document.querySelector('.conversation-region').hidden,true);fireEvent.click(ui.getByRole('button',{name:'打开 AI 助手'}));assert.equal(ui.getByRole('textbox',{name:'建模指令'}),input);assert.equal(input.value,'保持其他模型不变\n只调整托盘位置');console.log('PASS collapsing and reopening preserves conversation and draft');passed++;
 fireEvent.click(ui.getByRole('tab',{name:'任务记录',exact:true}));assert.ok(ui.getByRole('heading',{name:'任务与执行记录'}));fireEvent.click(ui.getByRole('tab',{name:'对话',exact:true}));assert.equal(ui.getByRole('textbox',{name:'建模指令'}),input);console.log('PASS task history and conversation remain independently navigable');passed++;
 fireEvent.click(ui.getByRole('button',{name:'收起对话区'}));await act(async()=>store.setState({aiStatus:'generating'}));assert.equal(document.querySelector('.conversation-region').hidden,false);assert.equal(store.getState().aiStatus,'generating');console.log('PASS active task reopens process visibility without cancelling');passed++;
 if(ui.getByRole('button',{name:'结构',exact:true}).getAttribute('aria-pressed')==='true')fireEvent.click(ui.getByRole('button',{name:'结构',exact:true}));
 await act(async()=>{window.innerWidth=1024;window.dispatchEvent(new Event('resize'));});
 fireEvent.click(ui.getByRole('button',{name:'结构',exact:true}));assert.equal(document.querySelector('.conversation-region').hidden,true);assert.equal(document.querySelector('.editor-objects').hidden,false);assert.equal(store.getState().aiStatus,'generating');
 fireEvent.click(ui.getByRole('button',{name:'打开 AI 助手'}));assert.equal(document.querySelector('.editor-objects').hidden,true);assert.equal(ui.getByRole('textbox',{name:'建模指令'}),input);assert.equal(input.value,'保持其他模型不变\n只调整托盘位置');console.log('PASS narrow-window editor panels and assistant switch without losing the live task or composer');passed++;
 await act(async()=>store.setState({aiStatus:'idle'}));await w.flushWorkspace();console.log(`${passed} persistent conversation checks passed`);
}finally{cleanup();await server.close();dom.window.close()}
