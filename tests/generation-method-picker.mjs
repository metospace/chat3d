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
const {render:rtlRender,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');const {ConfigProvider}=await import('antd');const render=ui=>rtlRender(ui,{wrapper:({children})=>React.createElement(ConfigProvider,{theme:{token:{motion:false}}},children)});
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try{
 const {GenerationMethodPicker}=await server.ssrLoadModule('/src/ui/GenerationMethodPicker.tsx'),{useEditorStore:store}=await server.ssrLoadModule('/src/store.ts'),{loadModelConfig,saveModelConfig}=await server.ssrLoadModule('/src/ai/modelConfigStorage.ts');const cfg={baseURL:'https://example.test/v1',apiKey:'mock-only',model:'model-a',useMock:false};
 function Harness(props){const [blender,setBlender]=React.useState(false);return React.createElement(GenerationMethodPicker,{...props,blenderModeling:blender,onBlenderModelingChange:setBlender});}
 await test('exactly two methods retain a transient choice within the mount without mutating settings',async()=>{
  store.setState({aiConfig:cfg,aiStatus:'idle'});saveModelConfig(cfg);const saved=localStorage.getItem('chat3d.modelConfig'),ui=render(React.createElement(Harness));
  fireEvent.keyDown(ui.getByRole('button',{name:'生成方式，当前直接生成'}),{key:'Enter'});const options=ui.getAllByRole('menuitemradio');assert.equal(options.length,2);assert.equal(ui.getByRole('menuitemradio',{name:'直接生成'}).getAttribute('aria-checked'),'true');assert.equal(ui.getByRole('menuitemradio',{name:'Blender 生成'}).getAttribute('aria-checked'),'false');
  fireEvent.click(ui.getByRole('menuitemradio',{name:'Blender 生成'}));await waitFor(()=>assert.equal(ui.queryByRole('menu'),null));ui.rerender(React.createElement(Harness));fireEvent.click(ui.getByRole('button',{name:'生成方式，当前Blender 生成'}));assert.equal(ui.getByRole('menuitemradio',{name:'Blender 生成'}).getAttribute('aria-checked'),'true');
  fireEvent.keyDown(ui.getByRole('menuitemradio',{name:'直接生成'}),{key:'Enter'});await waitFor(()=>assert.equal(ui.queryByRole('menu'),null));assert.ok(ui.getByRole('button',{name:'生成方式，当前直接生成'}));assert.equal(store.getState().aiConfig,cfg);assert.deepEqual(store.getState().aiConfig,{baseURL:'https://example.test/v1',apiKey:'mock-only',model:'model-a',useMock:false});assert.equal(localStorage.getItem('chat3d.modelConfig'),saved);
  fireEvent.click(ui.getByRole('button',{name:'生成方式，当前直接生成'}));fireEvent.click(ui.getByRole('menuitemradio',{name:'Blender 生成'}));ui.unmount();const remounted=render(React.createElement(Harness));assert.ok(remounted.getByRole('button',{name:'生成方式，当前直接生成'}));assert.equal(localStorage.getItem('chat3d.modelConfig'),saved);
 });
 await test('active work locks the method while a retained preview permits a next-run choice',async()=>{
  store.setState({aiConfig:cfg,aiStatus:'idle'});const ui=render(React.createElement(Harness));
  for(const aiStatus of ['capturing','context','generating','validating','applying']){await act(async()=>store.setState({aiStatus}));const button=ui.getByRole('button',{name:'生成方式，当前直接生成'});assert.equal(button.disabled,true);fireEvent.click(button);assert.equal(ui.queryByRole('menu'),null);}
  await act(async()=>store.setState({aiStatus:'previewing'}));assert.equal(ui.getByRole('button',{name:'生成方式，当前直接生成'}).disabled,false);fireEvent.click(ui.getByRole('button',{name:'生成方式，当前直接生成'}));fireEvent.click(ui.getByRole('menuitemradio',{name:'Blender 生成'}));assert.ok(ui.getByRole('button',{name:'生成方式，当前Blender 生成'}));
 });
 await test('starting a run closes an open menu without changing its chosen method',async()=>{
  store.setState({aiConfig:cfg,aiStatus:'idle'});let changes=0;const ui=render(React.createElement(GenerationMethodPicker,{blenderModeling:true,onBlenderModelingChange:()=>changes++}));fireEvent.click(ui.getByRole('button',{name:'生成方式，当前Blender 生成'}));assert.ok(ui.getByRole('menu'));await act(async()=>store.setState({aiStatus:'generating'}));await waitFor(()=>assert.equal(ui.queryByRole('menu'),null));assert.equal(ui.getByRole('button',{name:'生成方式，当前Blender 生成'}).disabled,true);assert.equal(changes,0);assert.equal(store.getState().aiConfig,cfg);
 });
 await test('a new-project method remains available while another project is running',async()=>{
  store.setState({aiConfig:cfg,aiStatus:'generating'});const ui=render(React.createElement(Harness,{forNewProject:true}));const button=ui.getByRole('button',{name:'生成方式，当前直接生成'});assert.equal(button.disabled,false);fireEvent.click(button);fireEvent.click(ui.getByRole('menuitemradio',{name:'Blender 生成'}));assert.ok(ui.getByRole('button',{name:'生成方式，当前Blender 生成'}));assert.equal(store.getState().aiStatus,'generating');assert.equal(store.getState().aiConfig,cfg);
 });
 await test('missing configuration opens configuration instead of the method menu',async()=>{
  store.setState({aiConfig:null,aiStatus:'idle'});let configured=0;const ui=render(React.createElement(Harness,{onConfigure:()=>configured++}));fireEvent.click(ui.getByRole('button',{name:'生成方式，当前直接生成'}));assert.equal(configured,1);assert.equal(ui.queryByRole('menu'),null);assert.equal(store.getState().aiConfig,null);
 });
 await test('legacy saved quality and style fields are stripped without losing approved credentials or configuration',async()=>{
  for(const rememberApiKey of [false,true])for(const generationQuality of ['fast','fine','unknown']){
   const legacy={...cfg,rememberApiKey,agentMode:'single',stream:false,reasoningEffort:'high',taskBudget:{maxMinutes:10,maxRounds:12,maxReportedTokens:12345},generationQuality,generationStyle:'stylized',style:'legacy-style'};localStorage.setItem('chat3d.modelConfig',JSON.stringify(legacy));const loaded=loadModelConfig(),saved=JSON.parse(localStorage.getItem('chat3d.modelConfig'));
   for(const field of ['generationQuality','generationStyle','style']){assert.equal(Object.hasOwn(loaded,field),false);assert.equal(Object.hasOwn(saved,field),false);}
   assert.equal(loaded.apiKey,cfg.apiKey);assert.equal(loaded.rememberApiKey,rememberApiKey);assert.equal(saved.apiKey,rememberApiKey?cfg.apiKey:undefined);for(const field of ['baseURL','model','agentMode','stream','reasoningEffort','taskBudget']){assert.deepEqual(loaded[field],legacy[field]);assert.deepEqual(saved[field],legacy[field]);}
   store.setState({aiConfig:loaded,aiStatus:'idle'});const ui=render(React.createElement(Harness));assert.ok(ui.getByRole('button',{name:'生成方式，当前直接生成'}));cleanup();
   saveModelConfig(legacy);const resaved=JSON.parse(localStorage.getItem('chat3d.modelConfig'));for(const field of ['generationQuality','generationStyle','style'])assert.equal(Object.hasOwn(resaved,field),false);assert.equal(resaved.apiKey,rememberApiKey?cfg.apiKey:undefined);
  }
 });
 console.log(passed+' generation method picker checks passed; no model requests');
}finally{cleanup();await server.close();dom.window.close()}
