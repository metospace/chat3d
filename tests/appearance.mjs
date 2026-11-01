import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createServer} from 'vite';
import React from 'react';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});
for(const name of ['window','document','HTMLElement','HTMLInputElement','HTMLFormElement','HTMLSelectElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location','DocumentFragment'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
installBrowserGlobals(dom);
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.indexedDB=indexedDB;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};globalThis.SVGElement=dom.window.SVGElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
HTMLElement.prototype.scrollIntoView=()=>{};
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {ConfigProvider}=await import('antd');
const server=await createServer({plugins:[{name:'workbench-viewport-fixture',enforce:'pre',load(id){if(id.endsWith('/src/ui/ViewportPanel.tsx'))return "import React from 'react';export function ViewportPanel(){return React.createElement('div',{'data-testid':'viewport-fixture'});}";}}],server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});let passed=0;

let dark=true;const listeners=new Set();window.matchMedia=()=>({get matches(){return dark},addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)});
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name)};
try{
 const {AppearanceProvider,useAppearance,APPEARANCE_KEY,parseAppearance}=await server.ssrLoadModule('/src/ui/Appearance.tsx');
 let appearance;let mounts=0;
 function Child(){appearance=useAppearance();React.useEffect(()=>{mounts++},[]);return React.createElement('input',{'aria-label':'保留草稿',defaultValue:'保留模型指令'})}
 const renderTheme=()=>render(React.createElement(AppearanceProvider,null,React.createElement(Child)));
 localStorage.removeItem(APPEARANCE_KEY);let ui=renderTheme();
 check('first visit defaults to light even on a dark OS',()=>{assert.equal(appearance.mode,'light');assert.equal(appearance.resolved,'light');assert.equal(document.documentElement.dataset.appearance,'light')});
 const input=ui.getByRole('textbox',{name:'保留草稿'});fireEvent.change(input,{target:{value:'继续编辑托盘'}});
 await act(async()=>appearance.setMode('dark'));
 check('dark selection updates theme, document and saved preference',()=>{assert.equal(appearance.resolved,'dark');assert.equal(localStorage.getItem(APPEARANCE_KEY),'dark');assert.equal(document.documentElement.dataset.appearance,'dark');assert.equal(document.documentElement.style.colorScheme,'dark')});
 check('theme changes preserve mounted children and unsent drafts',()=>{assert.equal(mounts,1);assert.equal(ui.getByRole('textbox',{name:'保留草稿'}),input);assert.equal(input.value,'继续编辑托盘')});
 cleanup();ui=renderTheme();check('saved dark appearance survives remount',()=>assert.equal(appearance.mode,'dark'));
 await act(async()=>{dark=false;listeners.forEach(fn=>fn());appearance.setMode('system')});
 check('system option resolves current OS appearance',()=>assert.equal(appearance.resolved,'light'));
 await act(async()=>{dark=true;listeners.forEach(fn=>fn())});check('system changes apply live without reload',()=>assert.equal(appearance.resolved,'dark'));
 await act(async()=>appearance.setMode('light'));await act(async()=>{dark=false;listeners.forEach(fn=>fn());dark=true;listeners.forEach(fn=>fn())});
 check('explicit light ignores OS appearance changes',()=>assert.equal(appearance.resolved,'light'));
 await act(async()=>window.dispatchEvent(new window.StorageEvent('storage',{key:APPEARANCE_KEY,newValue:'dark'})));check('another tab updates current appearance',()=>assert.equal(appearance.mode,'dark'));
 check('invalid stored values fall back safely',()=>assert.equal(parseAppearance('garbage'),'light'));
 const originalSet=window.Storage.prototype.setItem;window.Storage.prototype.setItem=()=>{throw Error('storage blocked')};await act(async()=>appearance.setMode('light'));
 check('blocked preference storage does not block switching and reports it',()=>{assert.equal(appearance.resolved,'light');assert.equal(appearance.storageError,true)});window.Storage.prototype.setItem=originalSet;
 cleanup();check('system listener is removed on unmount',()=>assert.equal(listeners.size,0));
 const {default:App}=await server.ssrLoadModule('/src/App.tsx');const w=await server.ssrLoadModule('/src/workspace.ts');await w.initializeWorkspace();await w.flushWorkspace();localStorage.setItem(APPEARANCE_KEY,'light');ui=render(React.createElement(ConfigProvider,{theme:{token:{motion:false}}},React.createElement(App)));
 check('global appearance entry is available on the home page',()=>assert.ok(ui.getByRole('button',{name:'切换外观，当前浅色'})));
 fireEvent.click(ui.getByRole('button',{name:'设置',exact:true}));check('settings exposes the same appearance preference',()=>assert.ok(ui.getByRole('combobox',{name:'应用外观'})));
 fireEvent.click(ui.getByRole('button',{name:'首页',exact:true}));fireEvent.click(ui.getByRole('button',{name:'新建项目',exact:true}));fireEvent.click(ui.getByRole('menuitem',{name:/新建空白/}));check('appearance remains available in compact editor navigation',()=>assert.ok(ui.getByRole('button',{name:'切换外观，当前浅色'})));
 console.log(`${passed} appearance checks passed`);
}finally{cleanup();await server.close();dom.window.close()}
