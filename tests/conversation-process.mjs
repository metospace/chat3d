import assert from 'node:assert/strict';import React from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);for(const k of ['window','document','HTMLElement','Node','MutationObserver'])globalThis[k]=dom.window[k];Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,fireEvent,cleanup}=await import('@testing-library/react');const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {ConversationRun}=await server.ssrLoadModule('/src/ui/ConversationRun.tsx');
 const start=Date.now()-10000;
 const explanations=[
  {id:'design',phase:'planning',text:'保留设备布局。',createdAt:start},
  {id:'build-a',phase:'building',text:'先调整操作人员的位置。',createdAt:start+1000},
  {id:'build-b',phase:'building',text:'再保持操作通道畅通。',createdAt:start+2000},
  {id:'build-repeat',phase:'building',text:'先调整操作人员的位置。',createdAt:start+3000},
  {id:'review',phase:'reviewing',text:'最后核对通道宽度。',createdAt:start+4000}
 ];
 const activity={title:'第9轮：执行edit_scene',phase:'reviewing',turn:9,toolCalls:20,inputTokens:9999,outputTokens:8888,usageReported:true,explanations,timings:[
  {id:'model-9',kind:'model',label:'第9轮模型响应',phase:'building',startedAt:start,endedAt:start+9000,summary:'模型响应摘要不可见'},
  {id:'edit',kind:'tool',toolName:'edit_scene',label:'建立模型结构',phase:'building',startedAt:start+1000,endedAt:start+7000,summary:'工具摘要不可见',detail:'Error: private raw failure',failed:true},
  {id:'capture',kind:'tool',label:'获取多角度检查图',phase:'reviewing',startedAt:start+8000}
 ],plan:[],events:['raw event']};
 let stopped=0;const run={status:'running',startedAt:start,activity};const ui=render(React.createElement(ConversationRun,{run,onStop:()=>stopped++}));
 const section=ui.getByRole('region',{name:'工作时间线'});
 const rows=()=>[...section.querySelectorAll('.adx-work-entry')];
 assert.deepEqual(rows().map(row=>row.dataset.phase),['planning','building','reviewing']);
 assert.deepEqual(rows().map(row=>row.querySelector('.adx-run-text').textContent),['保留设备布局。','先调整操作人员的位置。\n\n再保持操作通道畅通。','最后核对通道宽度。']);
 assert.deepEqual(rows().map(row=>row.dataset.status),['ended','ended','running']);
 assert.equal(rows()[1].querySelectorAll('time').length,2);
 assert.equal(rows()[1].querySelectorAll('time')[0].dateTime,new Date(start+1000).toISOString());
 assert.equal(rows()[1].querySelectorAll('time')[1].dateTime,new Date(start+3000).toISOString());
 for(const hidden of ['第9轮','9999','edit_scene','建立模型结构','获取多角度检查图','模型响应摘要不可见','工具摘要不可见','private raw failure','raw event'])assert.ok(!section.textContent.includes(hidden));
 assert.equal(section.querySelector('[data-kind="tool"],[data-kind="model"]'),null);
 assert.equal(ui.queryByText('已完成'),null,'public prose cannot prove completed execution');
 const heading=section.querySelector('button[aria-expanded]');assert.equal(heading.tagName,'BUTTON');assert.equal(heading.getAttribute('aria-expanded'),'true');
 const content=document.getElementById(heading.getAttribute('aria-controls'));assert.ok(content.contains(section.querySelector('ol')));assert.equal(content.hidden,false);
 assert.equal(section.querySelector('.adx-run-record-count'),null);assert.ok(!section.textContent.includes('工作记录 '));assert.equal(heading.querySelector('svg'),null);
 fireEvent.click(heading);assert.equal(heading.getAttribute('aria-expanded'),'false');assert.equal(content.hidden,true);assert.equal(ui.queryByRole('list'),null);
 fireEvent.click(ui.getByRole('button',{name:'停止生成'}));assert.equal(stopped,1);assert.equal(content.hidden,true);
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,lastEventAt:Date.now()}}}));assert.equal(heading.getAttribute('aria-expanded'),'false');assert.equal(ui.queryByRole('list'),null);
 ui.rerender(React.createElement(ConversationRun,{run:{...run,status:'preview'}}));assert.equal(content.hidden,true);assert.equal(ui.queryByRole('button',{name:'停止生成'}),null);
 fireEvent.click(heading);assert.equal(heading.getAttribute('aria-expanded'),'true');assert.ok(ui.getByRole('list'));assert.ok(rows().every(row=>row.dataset.status==='ended'));
 console.log('PASS native disclosure preserves user choice through live and ended updates, independently of stop');
 ui.rerender(React.createElement(ConversationRun,{run:{status:'completed',startedAt:start,activity:{...activity,explanations:[]}}}));
 assert.equal(section.querySelector('.adx-work-entry'),null);assert.ok(section.textContent.includes('未保存'));assert.ok(!section.textContent.includes('raw event'));
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,explanations:[]}}}));
 assert.equal(section.querySelector('.adx-work-entry'),null);assert.ok(section.textContent.includes('等待'));assert.ok(!section.textContent.includes('建立模型结构'));
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,explanations:[{id:'legacy',text:'旧版公开工作说明。'}]}}}));
 assert.ok(ui.getByText('时间未记录'));assert.equal(section.querySelector('.adx-work-entry').dataset.status,'recorded');
 console.log('PASS tool-only histories remain compact and legacy public prose never receives an invented timestamp');
 cleanup();
}finally{await server.close();dom.window.close()}
