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
const calls=[];globalThis.animationUiCalls=calls;
const server=await createServer({plugins:[{name:'animation-viewport-fixture',enforce:'pre',load(id){if(id.endsWith('/src/scene/Viewport.ts'))return `export class Viewport {
 constructor(){this.s={playing:false,time:0,speed:1,duration:0,error:'',loop:false};}
 setPlaybackListener(fn){this.fn=fn;this.emit();} emit(){this.fn?.({...this.s});} start(){} setActive(){} dispose(){} setSelection(){} setComposition(config){globalThis.animationComposition=config;} setBoxSelection(enabled,callback,wholeModel){globalThis.latestBoxSelection={enabled,callback,wholeModel};} setRenderQuality(){} setRenderPreset(){} setBackdrop(){} setGridVisible(){}
 sync(doc){this.s={...this.s,playing:false,time:0,duration:doc.animation?.duration??0};this.emit();}
 playAnimation(){globalThis.animationUiCalls.push('play');this.s.playing=true;this.emit();} pauseAnimation(){globalThis.animationUiCalls.push('pause');this.s.playing=false;this.emit();}
 resetAnimation(){globalThis.animationUiCalls.push('reset');this.s.playing=false;this.s.time=0;this.emit();} seekAnimation(t){globalThis.animationUiCalls.push(['seek',t]);this.s.time=t;this.s.playing=false;this.emit();} setAnimationSpeed(s){globalThis.animationUiCalls.push(['speed',s]);this.s.speed=s;this.emit();}
 }`;}}],server:{middlewareMode:true},appType:'custom'});let passed=0;
try{
 const {ViewportPanel}=await server.ssrLoadModule('/src/ui/ViewportPanel.tsx');const {useEditorStore:editor,createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const animation={version:1,name:'演示运动',duration:8,loop:true,tracks:[]};
 editor.setState({doc:{...createInitialDoc(),animation},selection:[],aiStatus:'idle',previewDoc:null});const ui=render(React.createElement(Theme,null,React.createElement(ViewportPanel)));
 fireEvent.click(ui.getByRole('button',{name:'播放动画'}));assert.ok(calls.includes('play'));fireEvent.click(ui.getByRole('button',{name:'暂停',exact:true}));assert.ok(calls.includes('pause'));fireEvent.change(ui.getByRole('slider',{name:'动画时间'}),{target:{value:'3'}});assert.deepEqual(calls.at(-1),['seek',3]);fireEvent.change(ui.getByRole('combobox',{name:'动画速度'}),{target:{value:'2'}});assert.deepEqual(calls.at(-1),['speed',2]);fireEvent.click(ui.getByRole('button',{name:'重置',exact:true}));assert.equal(calls.at(-1),'reset');console.log('PASS playback controls route play pause seek speed and reset to the viewport');passed++;
 await act(async()=>editor.setState({aiStatus:'generating'}));assert.equal(ui.getByRole('button',{name:'播放动画'}).disabled,true);assert.equal(calls.at(-1),'reset');console.log('PASS generating resets playback and prevents concurrent manual animation preview');passed++;
 await act(async()=>editor.setState({aiStatus:'previewing',previewDoc:{...createInitialDoc(),animation}}));assert.ok(ui.getByText(/待确认动画/));assert.equal(ui.getByRole('button',{name:'播放动画'}).disabled,false);console.log('PASS pending animation preview can play before user confirmation');passed++;
 await act(async()=>editor.setState({aiStatus:'idle',previewDoc:null,doc:createInitialDoc()}));assert.equal(ui.queryByRole('button',{name:'播放动画'}),null);console.log('PASS clearing or switching to a static project removes stale playback controls');passed++;
 console.log(`${passed} animation UI checks passed with a fixture viewport`);
}finally{cleanup();await server.close();dom.window.close();delete globalThis.animationUiCalls;}
