import {installBrowserGlobals} from './jsdom-env.mjs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location']) Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;
globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let handler=async()=>new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'}]}));
globalThis.fetch=async(...args)=>{const r=await handler(...args);r.headers.set('x-chat3d-proxy','1');return r;};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try {
 const {ModelPicker}=await server.ssrLoadModule('/src/ui/ModelPicker.tsx'),{useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');const cfg={baseURL:'https://example.test/v1',apiKey:'mock-only',model:'model-a',useMock:false};
 const reset=()=>{store.setState({aiConfig:cfg,aiStatus:'idle'});handler=async()=>new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'},{id:'model-b'}]}));};
 await test('model picker fetches actual unique IDs, searches and persists selection',async()=>{reset();const ui=render(React.createElement(ModelPicker));fireEvent.click(ui.getByRole('button',{name:'切换模型，当前 model-a'}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'使用模型 model-b'})));assert.equal(ui.getAllByRole('button',{name:'使用模型 model-b'}).length,1);fireEvent.change(ui.getByLabelText('搜索模型'),{target:{value:'MODEL-B'}});assert.equal(ui.queryByRole('button',{name:'使用模型 model-a'}),null);fireEvent.click(ui.getByRole('button',{name:'使用模型 model-b'}));assert.equal(store.getState().aiConfig.model,'model-b');assert.ok(ui.getByRole('button',{name:'切换模型，当前 model-b'}));});
 await test('missing connection opens settings without network request',async()=>{reset();store.setState({aiConfig:null});let count=0;handler=async()=>{throw Error('unexpected network')};const ui=render(React.createElement(ModelPicker,{onConfigure:()=>count++}));fireEvent.click(ui.getByRole('button',{name:'连接并选择模型'}));assert.equal(count,1);assert.equal(ui.queryByLabelText('搜索模型'),null);});
 await test('generation locks picker and prevents model changes',async()=>{reset();store.setState({aiStatus:'generating'});const ui=render(React.createElement(ModelPicker));assert.equal(ui.getByRole('button',{name:'切换模型，当前 model-a'}).disabled,true);fireEvent.click(ui.getByRole('button',{name:'切换模型，当前 model-a'}));assert.equal(ui.queryByLabelText('搜索模型'),null);assert.equal(store.getState().aiConfig.model,'model-a');});
 await test('list failure preserves current model and never invents alternatives',async()=>{reset();handler=async()=>new Response('unavailable',{status:503});const ui=render(React.createElement(ModelPicker));fireEvent.click(ui.getByRole('button',{name:'切换模型，当前 model-a'}));await waitFor(()=>assert.ok(ui.getByRole('alert')));assert.equal(ui.queryAllByRole('button',{name:/使用模型/}).length,0);assert.equal(store.getState().aiConfig.model,'model-a');});
 await test('endpoint change discards old in-flight catalog',async()=>{reset();let release;handler=()=>new Promise(r=>release=r);const ui=render(React.createElement(ModelPicker));fireEvent.click(ui.getByRole('button',{name:'切换模型，当前 model-a'}));await waitFor(()=>assert.ok(release));const oldRelease=release;handler=async()=>new Response(JSON.stringify({data:[{id:'new-only'}]}));await act(async()=>store.setState({aiConfig:{...cfg,baseURL:'https://new.example.test/v1'}}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'使用模型 new-only'})));await act(async()=>oldRelease(new Response(JSON.stringify({data:[{id:'stale-only'}]}))));assert.equal(ui.queryByRole('button',{name:'使用模型 stale-only'}),null);fireEvent.click(ui.getByRole('button',{name:'使用模型 new-only'}));assert.equal(store.getState().aiConfig.model,'new-only');});
 console.log(`${passed} model picker checks passed; all API calls mocked`);
}finally{cleanup();await server.close();dom.window.close()}
