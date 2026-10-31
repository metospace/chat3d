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
const {render:rtlRender,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');const {Theme}=await import('@radix-ui/themes');const render=ui=>rtlRender(ui,{wrapper:({children})=>React.createElement(Theme,null,children)});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try{
 const {QualityPicker}=await server.ssrLoadModule('/src/ui/QualityPicker.tsx'),{useEditorStore:store,loadModelConfig}=await server.ssrLoadModule('/src/store.ts');const cfg={baseURL:'https://example.test/v1',apiKey:'mock-only',model:'model-a',useMock:false};
 await test('legacy config defaults to fine without inventing a past run mode',async()=>{localStorage.setItem('chat3d.modelConfig',JSON.stringify(cfg));assert.equal(loadModelConfig().generationQuality,'fine');store.setState({aiConfig:cfg,aiStatus:'idle'});const ui=render(React.createElement(QualityPicker));assert.ok(ui.getByRole('button',{name:'生成档位，当前精细'}));});
 await test('quality picker switches, persists and reloads fast preference',async()=>{store.setState({aiConfig:cfg,aiStatus:'idle'});const ui=render(React.createElement(QualityPicker));fireEvent.keyDown(ui.getByRole('button',{name:'生成档位，当前精细'}),{key:'Enter'});fireEvent.click(ui.getByRole('menuitemradio',{name:'快速生成'}));assert.equal(store.getState().aiConfig.generationQuality,'fast');assert.equal(loadModelConfig().generationQuality,'fast');assert.ok(ui.getByRole('button',{name:'生成档位，当前快速'}));});
 await test('active generation locks mode while retained preview permits a next-run choice',async()=>{store.setState({aiConfig:{...cfg,generationQuality:'fine'},aiStatus:'generating'});const ui=render(React.createElement(QualityPicker));assert.equal(ui.getByRole('button',{name:'生成档位，当前精细'}).disabled,true);await act(async()=>store.setState({aiStatus:'previewing'}));assert.equal(ui.getByRole('button',{name:'生成档位，当前精细'}).disabled,false);});
 await test('invalid persisted preference safely falls back to fine',async()=>{localStorage.setItem('chat3d.modelConfig',JSON.stringify({...cfg,generationQuality:'unknown'}));assert.equal(loadModelConfig().generationQuality,'fine');});
 await test('single-call mode clearly discloses no multiround visual review',async()=>{store.setState({aiConfig:{...cfg,agentMode:'single'},aiStatus:'idle'});const ui=render(React.createElement(QualityPicker));fireEvent.keyDown(ui.getByRole('button',{name:'生成档位，当前精细'}),{key:'Enter'});assert.ok(ui.getByText('更完整的建模要求；无多轮复核'));assert.equal(ui.queryByText(/耗时取决于模型服务/),null);});
 await test('starting generation closes an already-open quality menu without changing mode',async()=>{store.setState({aiConfig:{...cfg,generationQuality:'fine'},aiStatus:'idle'});const ui=render(React.createElement(QualityPicker));fireEvent.keyDown(ui.getByRole('button',{name:'生成档位，当前精细'}),{key:'Enter'});assert.ok(ui.getByRole('menuitemradio',{name:'快速生成'}));await act(async()=>store.setState({aiStatus:'generating'}));assert.equal(ui.queryByRole('menuitemradio',{name:'快速生成'}),null);assert.equal(store.getState().aiConfig.generationQuality,'fine');});
 console.log(passed+' quality picker checks passed; no model requests');
}finally{cleanup();await server.close();dom.window.close()}
