import assert from 'node:assert/strict';import React from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);for(const k of ['window','document','HTMLElement','Node','MutationObserver'])globalThis[k]=dom.window[k];Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,fireEvent,cleanup,within}=await import('@testing-library/react');const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {ConversationRun}=await server.ssrLoadModule('/src/ui/ConversationRun.tsx');
 const start=Date.now()-10000;
 const explanations=[
  {id:'design',phase:'planning',text:'保留设备布局。',createdAt:start},
  {id:'build-a',phase:'building',text:'先调整操作人员的位置。',createdAt:start+1000},
  {id:'build-b',phase:'building',text:'再保持操作通道畅通。',createdAt:start+2000},
  {id:'review',phase:'reviewing',text:'最后核对通道宽度。',createdAt:start+4000}
 ];
 const activity={title:'第9轮：执行edit_scene',phase:'reviewing',turn:9,toolCalls:20,inputTokens:9999,outputTokens:8888,usageReported:true,explanations,timings:[
  {id:'model-9',kind:'model',label:'第9轮模型响应',phase:'building',startedAt:start,endedAt:start+9000,summary:'模型响应摘要不可见'},
  {id:'edit',kind:'tool',toolName:'edit_scene',label:'private edit label',phase:'building',startedAt:start+1500,endedAt:start+7000,summary:'保留已更新的设备位置。'},
  {id:'failed',kind:'tool',toolName:'build_modeling_program',label:'private failed label',startedAt:start+3000,endedAt:start+3500,summary:'本次结构调整未成功。',detail:'Error: private raw failure',failed:true},
  {id:'capture',kind:'tool',toolName:'capture_multiview',label:'private capture label',phase:'reviewing',startedAt:start+8000}
 ],plan:[],events:['raw event']};
 let stopped=0;const run={status:'running',startedAt:start,activity};const ui=render(React.createElement(ConversationRun,{run,onStop:()=>stopped++}));
 const section=ui.getByRole('region',{name:'工作时间线'});
 const disclosure=section.querySelector('button[aria-expanded]');assert.ok(disclosure);
 const details=document.getElementById(disclosure.getAttribute('aria-controls'));assert.ok(details);assert.ok(section.contains(details));
 const rows=()=>within(ui.getByRole('list',{name:'建模进展'})).getAllByRole('listitem');
 const assertCollapsed=()=>{assert.equal(disclosure.getAttribute('aria-expanded'),'false');assert.equal(details.hidden,true);assert.equal(ui.queryByRole('list',{name:'建模进展'}),null);};
 assertCollapsed();assert.ok(disclosure.textContent.trim());
 for(const text of [...explanations.map(item=>item.text),'保留已更新的设备位置。','本次结构调整未成功。'])assert.ok(details.contains(ui.getByText(text)),'public explanations and returned actions stay inside the hidden process');
 const stop=ui.getByRole('button',{name:'停止生成'});assert.ok(!details.contains(stop));fireEvent.click(stop);assert.equal(stopped,1);assertCollapsed();
 const currentAction=disclosure.querySelector('strong').textContent;
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,timings:[...activity.timings.slice(0,-1),{...activity.timings.at(-1),toolName:'edit_scene'}]}},onStop:()=>stopped++}));
 assert.notEqual(disclosure.querySelector('strong').textContent,currentAction,'the collapsed current action follows the real tool identity');assertCollapsed();
 ui.rerender(React.createElement(ConversationRun,{run,onStop:()=>stopped++}));
 fireEvent.click(disclosure);assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);
 assert.equal(rows().length,explanations.length+2,'expanded history includes every public explanation and returned action');
 assert.deepEqual(rows().filter(row=>explanations.some(item=>item.text===row.textContent)).map(row=>row.textContent),explanations.map(item=>item.text),'same-phase public explanations remain separate records');
 for(const row of rows())assert.equal(within(row).queryByRole('list'),null,'progress is flat rather than grouped under phase entries');
 assert.equal(details.querySelector('button[aria-expanded]'),null,'expanded history has no secondary older-record disclosure');
 const completedRow=ui.getByText('保留已更新的设备位置。').closest('li'),failedRow=ui.getByText('本次结构调整未成功。').closest('li');
 assert.match(completedRow.textContent,/已完成/);assert.match(failedRow.textContent,/未成功/);
 for(const hidden of ['第9轮','9999','edit_scene','build_modeling_program','capture_multiview','private edit label','private failed label','private capture label','模型响应摘要不可见','private raw failure','raw event'])assert.ok(!section.textContent.includes(hidden),hidden);
 fireEvent.click(ui.getByRole('button',{name:'停止生成'}));assert.equal(stopped,2);assert.equal(details.hidden,false);
 ui.rerender(React.createElement(ConversationRun,{run:{...run,status:'stopped',endedAt:start+10000}}));
 assert.equal(ui.queryByRole('button',{name:'停止生成'}),null);assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);
 const endedRows=rows();assert.equal(endedRows.length,explanations.length+3,'expanded stopped history retains all returned and interrupted actions');
 assert.match(endedRows.at(-1).textContent,/未完成/);assert.ok(!endedRows.at(-1).textContent.includes('已完成'),'stopping cannot turn a pending action into a completed action');
 console.log('PASS the process starts collapsed, expands into flat public history and keeps stop independent with honest outcomes');
 const many=Array.from({length:9},(_,index)=>({id:`history-${index}`,phase:'building',text:`公开进展记录 ${index+1}。`,createdAt:start+index}));
 const longActivity={...activity,explanations:many,timings:[activity.timings[0]]};
 fireEvent.click(disclosure);assertCollapsed();
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:longActivity},onStop:()=>stopped++}));
 assertCollapsed();
 fireEvent.click(disclosure);assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);assert.deepEqual(rows().map(row=>row.textContent),many.map(item=>item.text));
 for(const row of rows())assert.equal(within(row).queryByRole('list'),null);
 assert.equal(details.querySelector('button[aria-expanded]'),null);
 const added={id:'history-9',phase:'reviewing',text:'新收到的公开检查记录。',createdAt:start+20};
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...longActivity,explanations:[...many,added]}},onStop:()=>stopped++}));
 assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);assert.deepEqual(rows().map(row=>row.textContent),[...many,added].map(item=>item.text));
 fireEvent.click(disclosure);assertCollapsed();
 const latest={id:'history-10',text:'最后收到的公开检查记录。',createdAt:start+30};const updatedActivity={...longActivity,explanations:[...many,added,latest]};
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:updatedActivity},onStop:()=>stopped++}));
 assertCollapsed();assert.ok(details.contains(ui.getByText(latest.text)));
 fireEvent.click(ui.getByRole('button',{name:'停止生成'}));assert.equal(stopped,3);assertCollapsed();
 ui.rerender(React.createElement(ConversationRun,{run:{...run,status:'preview',activity:updatedActivity}}));
 assertCollapsed();assert.equal(ui.queryByRole('button',{name:'停止生成'}),null);
 fireEvent.click(disclosure);assert.equal(details.hidden,false);assert.deepEqual(rows().map(row=>row.textContent),[...many,added,latest].map(item=>item.text));
 console.log('PASS full history expands on demand and streaming updates or termination preserve the chosen expansion');
 ui.rerender(React.createElement(ConversationRun,{run:{status:'completed',startedAt:start,activity:{...activity,explanations:[]}}}));
 assert.equal(rows().length,3,'tool-only histories still show known observed actions');assert.ok(!section.textContent.includes('raw event'));
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,timings:[],explanations:[{id:'legacy',text:'旧版公开工作说明。'}]}}}));
 assert.equal(rows().length,1);assert.ok(ui.getByText('旧版公开工作说明。'));assert.equal(rows()[0].querySelector('time'),null);assert.ok(!rows()[0].textContent.includes('已完成'));
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,timings:[],explanations:[{id:'private',text:'<think>private reasoning</think>'},{id:'payload',text:'{"operations":["secret-node"]}'}]}}}));
 assert.equal(ui.queryByRole('list',{name:'建模进展'}),null);assert.ok(!section.textContent.includes('private reasoning'));assert.ok(!section.textContent.includes('secret-node'));
 console.log('PASS real tool histories remain available without public prose, while undated prose and private payloads never invent visible execution');
 const blender={stage:'receiving',instruction:'正在生成 Python 脚本（尚未执行）',script:'import bpy\nwidth = 2\nbpy.ops.mesh.primitive_cube_add(size=width)',receivedChars:72,updatedAt:Date.now(),events:[{stage:'receiving',message:'已开始接收脚本',at:start}]};
 fireEvent.click(disclosure);assertCollapsed();
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,blenderProgress:blender,explanations:[]}}}));
 assertCollapsed();assert.equal(ui.queryByRole('region',{name:'Blender 脚本与执行阶段'}),null);assert.ok(details.contains(ui.getByLabelText('脚本末尾预览')));
 fireEvent.click(disclosure);assert.equal(details.hidden,false);
 const panel=ui.getByRole('region',{name:'Blender 脚本与执行阶段'});assert.ok(details.contains(panel));
 assert.match(panel.textContent,/尚未执行/);assert.match(panel.querySelector('[aria-label="脚本末尾预览"]').textContent,/primitive_cube_add/);
 const scriptDetails=panel.querySelector('details');assert.equal(scriptDetails.open,false);scriptDetails.open=true;
 ui.rerender(React.createElement(ConversationRun,{run:{...run,activity:{...activity,blenderProgress:{...blender,stage:'rendering',instruction:'正在渲染预览',updatedAt:Date.now()}}}}));
 assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);assert.equal(scriptDetails.open,true);assert.match(panel.textContent,/正在渲染预览/);
 ui.rerender(React.createElement(ConversationRun,{run:{...run,status:'stopped',activity:{...activity,blenderProgress:{...blender,stage:'rendering',instruction:'正在渲染预览'}}}}));
 assert.match(panel.textContent,/已停止/);assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(details.hidden,false);assert.equal(ui.queryByRole('button',{name:'停止生成'}),null);assert.equal(scriptDetails.open,true);assert.equal(ui.getByLabelText('完整保留的 Blender 脚本').textContent,blender.script);
 console.log('PASS Blender code requires expanding the process and both disclosures survive stage changes and termination');
 cleanup();
}finally{cleanup();await server.close();dom.window.close()}
