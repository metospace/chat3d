import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { createServer } from 'vite';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);
for(const name of ['window','document','HTMLElement','HTMLInputElement','Element','CustomEvent','Node','NodeFilter','MutationObserver','Event','MouseEvent','localStorage','location']) Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=globalThis.cancelAnimationFrame;
globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};globalThis.SVGElement=dom.window.SVGElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let handler=async()=>new Response('{}');
globalThis.fetch=async(...args)=>{const r=await handler(...args);r.headers.set('x-chat3d-proxy','1');return r;};
const {render:rtlRender,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');const {Theme}=await import('@radix-ui/themes');const render=ui=>rtlRender(ui,{wrapper:({children})=>React.createElement(Theme,null,children)});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try{
 const {DeleteSelectionAction}=await server.ssrLoadModule('/src/ui/DeleteSelectionAction.tsx');
 const {ObjectTree}=await server.ssrLoadModule('/src/ui/ObjectTree.tsx');
 const {createInitialDoc,useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');
 const node=(id,extra={})=>({id,parentId:null,name:id,kind:'primitive',visible:true,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},...extra});
 const nodes=[node('a',{assemblyId:'a',assemblyName:'机组'}),node('b',{assemblyId:'a',assemblyName:'机组'}),node('other')];
 const reset=(state={})=>store.setState({doc:{...createInitialDoc(),nodes:structuredClone(nodes)},selection:['a'],past:[],future:[],previewDoc:null,pendingBatch:null,pendingResult:null,aiStatus:'idle',...state});
 await test('visible delete action has accessible help and deletes exactly the selection',async()=>{
  reset();let notice='';const ui=render(React.createElement(DeleteSelectionAction,{onNotice:value=>notice=value}));const button=ui.getByRole('button',{name:'删除选中对象'});assert.match(ui.getByTitle(/从当前场景删除/).title,/Delete/);assert.match(ui.getByTitle(/从当前场景删除/).title,/资产库原件保留/);fireEvent.click(button);assert.deepEqual(store.getState().doc.nodes.map(n=>n.id),['b','other']);assert.deepEqual(store.getState().selection,[]);assert.match(notice,/可撤销恢复/);assert.equal(button.disabled,true);
 });
 await test('Delete key removes a multiselection once and undo restores the model',async()=>{
  reset({selection:['a','b']});render(React.createElement(DeleteSelectionAction));fireEvent.keyDown(window,{key:'Delete'});assert.deepEqual(store.getState().doc.nodes.map(n=>n.id),['other']);assert.equal(store.getState().past.length,1);fireEvent.keyDown(window,{key:'Delete'});assert.equal(store.getState().past.length,1);act(()=>store.getState().undo());assert.deepEqual(store.getState().doc.nodes,nodes);
 });
 await test('keyboard deletion never intercepts text fields, contenteditable children or input-like roles',async()=>{
  reset();const ui=render(React.createElement(React.Fragment,null,React.createElement(DeleteSelectionAction),React.createElement('input',{'aria-label':'input'}),React.createElement('textarea',{'aria-label':'chat'}),React.createElement('select',{'aria-label':'select'}),React.createElement('div',{contentEditable:true,suppressContentEditableWarning:true},React.createElement('span',{'data-testid':'editable-child'},'typing')),React.createElement('div',{role:'textbox','aria-label':'custom text'}),React.createElement('div',{role:'spinbutton','aria-label':'custom number'})));
  for(const target of [ui.getByLabelText('input'),ui.getByLabelText('chat'),ui.getByLabelText('select'),ui.getByTestId('editable-child'),ui.getByRole('textbox',{name:'custom text'}),ui.getByRole('spinbutton')])fireEvent.keyDown(target,{key:'Delete'});
  assert.equal(store.getState().doc.nodes.length,3);assert.equal(store.getState().past.length,0);
 });
 await test('held keys, IME, modifiers, Backspace and prevented keyboard events do not delete',async()=>{
  reset();render(React.createElement(DeleteSelectionAction));for(const extra of [{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{key:'Backspace'}])fireEvent.keyDown(window,{key:'Delete',...extra});const event=new window.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true});event.preventDefault();fireEvent(window,event);assert.equal(store.getState().past.length,0);
 });
 await test('open dialogs block keyboard deletion of the scene behind them',async()=>{
  reset();const ui=render(React.createElement(React.Fragment,null,React.createElement(DeleteSelectionAction),React.createElement('div',{role:'dialog','aria-label':'asset library'},'library')));fireEvent.keyDown(ui.getByRole('dialog'),{key:'Delete'});fireEvent.keyDown(window,{key:'Delete'});assert.equal(store.getState().doc.nodes.length,3);
 });
 await test('inactive workbench and generation/preview locks block both button and Delete',async()=>{
  reset();const ui=render(React.createElement(DeleteSelectionAction,{active:false}));fireEvent.keyDown(window,{key:'Delete'});assert.equal(ui.getByRole('button',{name:'删除选中对象'}).disabled,true);ui.rerender(React.createElement(DeleteSelectionAction,{active:true}));
  for(const aiStatus of ['capturing','context','generating','validating','previewing','applying']){act(()=>store.setState({aiStatus}));assert.equal(ui.getByRole('button',{name:'删除选中对象'}).disabled,true);fireEvent.click(ui.getByRole('button',{name:'删除选中对象'}));fireEvent.keyDown(window,{key:'Delete'});assert.equal(store.getState().doc.nodes.length,3);}assert.match(ui.getByTitle(/任务执行中/).title,/暂不能删除/);
 });
 await test('structure tree supports whole assembly selection and additive toggling across groups / parts',async()=>{
  reset({selection:[]});const ui=render(React.createElement(ObjectTree));fireEvent.click(ui.getByRole('button',{name:'选择组件 机组'}));assert.deepEqual(store.getState().selection,['a','b']);fireEvent.click(ui.getByRole('button',{name:'other',exact:true}),{ctrlKey:true});assert.deepEqual(store.getState().selection,['a','b','other']);fireEvent.click(ui.getByRole('button',{name:'选择组件 机组'}),{metaKey:true});assert.deepEqual(store.getState().selection,['other']);fireEvent.click(ui.getByRole('button',{name:'展开 机组'}));fireEvent.click(ui.getByRole('button',{name:'a',exact:true}),{shiftKey:true});assert.deepEqual(store.getState().selection,['other','a']);fireEvent.click(ui.getByRole('button',{name:'b',exact:true}));assert.deepEqual(store.getState().selection,['b']);
 });
 console.log(passed+' scene deletion UI checks passed');
}finally{cleanup();await server.close();dom.window.close()}
