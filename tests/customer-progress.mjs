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
globalThis.CSS={escape:value=>String(value).replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};globalThis.SVGElement=dom.window.SVGElement;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let handler=async()=>new Response(JSON.stringify({data:[{id:'model-b'},{id:'model-a'}]}));
globalThis.fetch=async(...args)=>{const r=await handler(...args);r.headers.set('x-chat3d-proxy','1');return r;};
const {render:rtlRender,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');const {Theme}=await import('@radix-ui/themes');const render=ui=>rtlRender(ui,{wrapper:({children})=>React.createElement(Theme,null,children)});
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);cleanup();};
try{
 const {activityProgress,customerText,progressSteps}=await server.ssrLoadModule('/src/domain/customerProgress.ts');
 await test('technical actions are translated and unknown identifiers never leak',async()=>{assert.equal(customerText('read_saved_asset'),'读取资产用途与连接点');assert.equal(customerText('unknown_private_function'),'模型处理步骤');assert.ok(!customerText('Bearer abcdefgh sk-secret123').includes('secret123'));});
 const activity={title:'read_saved_asset',turn:4,toolCalls:3,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:4000,plan:['read_saved_asset 后检查形状'],events:['read_saved_asset secret_private_tool'],timings:[{id:'a',kind:'tool',label:'read_saved_asset',startedAt:1000,endedAt:2000},{id:'b',kind:'tool',label:'read_saved_asset',startedAt:2000,endedAt:3000},{id:'c',kind:'tool',label:'edit_scene',startedAt:3000}]};
 await test('consecutive repeated steps condense without marking unfinished work complete',async()=>{const steps=progressSteps(activity,false);assert.equal(steps.length,2);assert.equal(steps[0].count,2);assert.equal(steps[0].completed,2);assert.equal(steps[1].completed,0);assert.equal(steps[1].running,false);assert.equal(progressSteps(activity,true)[1].running,true);});
 const {TaskPanel}=await server.ssrLoadModule('/src/ui/TaskPanel.tsx');const {useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');
 await test('customer task panel hides raw tool events and technical metrics but preserves factual unknown time',async()=>{store.setState({lastRun:activity,aiStatus:'idle',messages:[],aiError:null,pendingBatch:null,pendingResult:null});const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.ok(ui.getByRole('heading',{name:'处理进展'}));assert.ok(ui.getByText('未完成'));assert.ok(ui.getByText('读取资产用途与连接点'));assert.ok(!ui.container.textContent.includes('read_saved_asset'));assert.ok(!ui.container.textContent.includes('secret_private_tool'));assert.ok(!ui.container.textContent.includes('工具调用'));assert.ok(ui.getByText('计划不等于完成结果，实际状态以执行记录和预览为准'));assert.ok(ui.getByRole('button',{name:'下载脱敏诊断记录'}));});
 await test('stopped task says stopped without claiming completion or applying changes',async()=>{store.setState({aiStatus:'cancelled',lastRun:activity});const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.ok(ui.getByRole('heading',{name:'已停止，已生成的内容保留'}));assert.ok(ui.getByText('未完成'));});
 await test('manual edits retain identity and show applied, undo and redo without an AI result',async()=>{store.setState({past:[],future:[],lastRun:null,aiStatus:'idle',messages:[],aiError:null,pendingBatch:null,pendingResult:null});const result=store.getState().applyCommandBatch([{op:'createPrimitive',name:'测试料箱',parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}],'添加测试料箱');assert.equal(result.ok,true);const entry=store.getState().past.at(-1);assert.equal(entry.source,'manual');assert.ok(entry.id);assert.ok(entry.createdAt);const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.ok(ui.getByText('已应用 · 手动操作'));assert.ok(ui.getByText('添加测试料箱'));assert.ok(ui.getByRole('heading',{name:'AI 修改结果 0'}));await act(async()=>store.getState().undo());assert.ok(ui.getByText('已撤销 · 手动操作'));assert.equal(store.getState().future.at(-1).id,entry.id);await act(async()=>store.getState().redo());assert.ok(ui.getByText('已应用 · 手动操作'));assert.equal(store.getState().past.at(-1).id,entry.id);});
 await test('legacy history is not misrepresented as manual or given an invented timestamp',async()=>{const entry=store.getState().past.at(-1);store.setState({past:[{...entry,id:undefined,source:undefined,createdAt:undefined}],future:[]});const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.ok(ui.getByText('已应用 · 历史操作'));assert.ok(ui.getByText('时间未记录'));});
 await test('AI operations are excluded from manual history and empty text does not point at absent history',async()=>{const entry=store.getState().past.at(-1);store.setState({past:[{...entry,source:'ai'}],future:[],messages:[]});const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.equal(ui.queryByLabelText('手动修改记录'),null);assert.ok(!ui.container.textContent.includes('上方记录'));});
 const {RunTrace}=await server.ssrLoadModule('/src/ui/RunTrace.tsx');
 await test('historical trace preserves ended semantics and omits raw details',async()=>{const ui=render(React.createElement(RunTrace,{run:{status:'stopped',mode:'pi',startedAt:1000,endedAt:4000,activity},now:5000}));assert.ok(ui.getByText('已停止'));assert.ok(ui.getByText('未完成'));assert.ok(!ui.container.textContent.includes('read_saved_asset'));assert.ok(!ui.container.textContent.includes('secret_private_tool'));});
 await test('partial and unverified previews do not display processing completed',async()=>{
  const {runStatusLabel}=await server.ssrLoadModule('/src/domain/runStatusLabel.ts');assert.equal(runStatusLabel({status:'preview',startedAt:1},{...activity,outcome:'partial'}),'未完成，已保留草稿');assert.equal(runStatusLabel({status:'preview',startedAt:1},{...activity,outcome:'budget-exhausted'}),'未完成，已保留草稿');assert.equal(runStatusLabel({status:'preview',startedAt:1},{...activity,detailAcceptance:{status:'pending'}}),'预览已生成，待核对');
  const {RunTrace:ChatRunTrace}=await server.ssrLoadModule('/src/ui/chat/RunTrace.tsx');const a={...activity,outcome:'partial',explanations:[{text:'仍需完成完整取放动作'}]};const ui=render(React.createElement(ChatRunTrace,{run:{status:'preview',startedAt:1,activity:a}}));assert.ok(ui.getByText('未完成，已保留草稿'));assert.equal(ui.queryByText('处理完成'),null);
 });
 await test('task panel distinguishes unfinished drafts from successful model delivery',async()=>{
  store.setState({aiStatus:'previewing',pendingBatch:{requestId:'partial',summary:'尚未恢复完整搬运',taskStatus:'partial',incomplete:true,operations:[]},pendingResult:null,lastRun:{...activity,outcome:'partial'},messages:[]});const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.ok(ui.getByRole('heading',{name:'未完成，已保留阶段草稿'}));assert.ok(ui.getByText('当前任务尚未完成，可继续处理剩余问题；也可保留或放弃阶段结果。'));
 });
 await test('structured preview checks are authoritative and preserve semicolons without duplicate fragments',async()=>{
  const {previewChecks}=await server.ssrLoadModule('/src/domain/previewChecks.ts');
  const issue='需求待核对：门架应与参考图一致；当前缺少侧面证据',summary='预览已生成\n仍需改进：'+issue;
  assert.deepEqual(previewChecks([issue,issue,'堆高车：尚未完成六项细节验收'],summary).map(x=>x.text),[issue,'堆高车：尚未完成六项细节验收']);
  assert.deepEqual(previewChecks([],summary),[]);
  assert.deepEqual(previewChecks(undefined,'已知问题：'+issue).map(x=>x.text),[issue]);
  assert.deepEqual(previewChecks(['材质证据不足','缺少侧面证据','原图模糊，无法确认文字是否错误','警示文字不清晰','主体外形与参考图不同']).map(x=>x.reportedDifference),[false,false,false,true,true]);
 });
 await test('submitted preview with unknown evidence remains reviewable rather than an unfinished task',async()=>{
  store.setState({aiStatus:'previewing',pendingBatch:{requestId:'review',taskStatus:'submitted',qualityIssues:['缺少侧面证据'],operations:[]},pendingResult:null,lastRun:null,messages:[]});
  const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));assert.equal(ui.container.textContent.includes('未完成，已保留阶段草稿'),false);assert.ok(ui.container.textContent.includes('仍需核对'));
 });
 await test('completion gate separates explicit defects and missing functions from unknown evidence',async()=>{
  const {confirmedCompletionIssues:issues}=await server.ssrLoadModule('/src/domain/completionIssues.ts');assert.deepEqual(issues(['材质尚未验收','原图模糊，无法确认文字是否错误','缺少材质证据','整车同步及穿插尚未完整验证']),[]);assert.deepEqual(issues(['货叉轨道未恢复','整车没有运动轨道','车身仍受遮挡']),['货叉轨道未恢复','整车没有运动轨道','车身仍受遮挡']);assert.deepEqual(issues(['主体偏高'],true),['主体偏高']);assert.deepEqual(issues(['参考图模糊','材质尚未验收'],true),[]);
 });
 await test('phase and model response state are independent of prose, age and metadata activity',async()=>{
  const now=1_000_000;
  const review={...activity,phase:'reviewing',lastModelEditAt:now-240_000,lastEventAt:now,title:'旧的构建说明',timings:[{id:'review-model',kind:'model',label:'private_model_request',startedAt:now-100_000}]};
  const progress=activityProgress(review,true,now);
  assert.equal(progress.phase,'reviewing');assert.equal(progress.modelState,'waiting');assert.equal(progress.modelEditAgeSeconds,240);assert.ok(progress.reviewNote);
  assert.equal(activityProgress({...review,lastEventAt:now+60_000},true,now+60_000).modelEditAgeSeconds,300);
  assert.equal(activityProgress({...review,timings:[{...review.timings[0],firstDataAt:now-90_000}]},true,now).modelState,'waiting','transport bytes are not model content');
  assert.equal(activityProgress({...review,timings:[{...review.timings[0],firstContentAt:now-90_000}]},true,now).modelState,'responding');
  assert.equal(activityProgress({...review,timings:[{...review.timings[0],endedAt:now}]},true,now).modelState,undefined);
  assert.equal(activityProgress({...review,timings:[...review.timings,{id:'capture',kind:'tool',label:'private_capture_tool',startedAt:now}]},true,now).modelState,undefined);
  assert.equal(activityProgress(activity,true,now).modelEditAgeSeconds,undefined,'legacy records never invent a model edit');
  assert.equal(activityProgress({...review,lastModelEditAt:NaN},true,now).modelEditAgeSeconds,undefined);
  assert.equal(activityProgress(activity,true,now).phase,undefined);assert.equal(activityProgress(activity,true,now).reviewNote,undefined);
  assert.equal(activityProgress(activity,true,now+3_600_000).label,activityProgress(activity,true,now).label,'elapsed time alone cannot change the reported work');
  assert.equal(activityProgress(review,false,now).phase,undefined);assert.equal(activityProgress(review,false,now).modelState,undefined);assert.equal(activityProgress(review,false,now).modelEditAgeSeconds,undefined);
  const {runStatusLabel}=await server.ssrLoadModule('/src/domain/runStatusLabel.ts');
  assert.equal(runStatusLabel({status:'running'},activity),'正在处理');
  for(const phase of ['planning','building','reviewing','repairing'])assert.equal(activityProgress({...review,phase},true,now).phase,phase);
  assert.notEqual(runStatusLabel({status:'running'},review),runStatusLabel({status:'running'},{...review,phase:'building'}));
  assert.equal(runStatusLabel({status:'stopped'},review),'已停止');assert.equal(runStatusLabel({status:'failed'},review),'处理未完成');
 });
 await test('long reviews retain public prose and elapsed status without synthesizing timing events',async()=>{
  const realNow=Date.now,realSet=globalThis.setInterval,realClear=globalThis.clearInterval;
  let now=1_000_000,nextId=0;const timers=new Map();
  Date.now=()=>now;globalThis.setInterval=(fn,delay)=>{assert.equal(delay,1000);const id=++nextId;timers.set(id,fn);return id;};globalThis.clearInterval=id=>timers.delete(id);
  try{
   const {RunTrace:ChatRunTrace}=await server.ssrLoadModule('/src/ui/chat/RunTrace.tsx');
   const explanation={id:'public',text:'按已有安排处理模型'};
   const review={...activity,phase:'reviewing',lastModelEditAt:now-240_000,lastEventAt:now,explanations:[explanation],timings:[{id:'waiting',kind:'model',label:'secret_model_tool',startedAt:now-100_000}]};
   const run={status:'running',startedAt:now-496_000,mode:'pi',activity:review};let stopped=0;
   const ui=render(React.createElement(ChatRunTrace,{run,onStop:()=>stopped++}));
   const section=ui.getByRole('region',{name:'工作时间线'});
   assert.equal(section.dataset.phase,'reviewing');assert.equal(section.dataset.modelState,'waiting');
   assert.ok(ui.getByText('496 秒'));assert.ok(ui.getByText(explanation.text));
   assert.equal(ui.queryByLabelText('当前模型处理状态'),null);assert.equal(ui.queryByLabelText('距上次模型修改'),null);assert.equal(ui.container.textContent.includes('secret_model_tool'),false);
   assert.equal(ui.container.querySelectorAll('.adx-work-entry').length,1);assert.equal(ui.container.querySelector('.adx-work-entry').dataset.kind,'explanation');
   assert.equal(timers.size,1);now+=1000;act(()=>{for(const tick of timers.values())tick();});assert.ok(ui.getByText('497 秒'));
   ui.rerender(React.createElement(ChatRunTrace,{run:{...run,activity:{...review,phase:'repairing',lastEventAt:now}},onStop:()=>stopped++}));
   assert.equal(section.dataset.phase,'repairing');assert.ok(ui.getByText(explanation.text));assert.equal(ui.queryByLabelText('距上次模型修改'),null);
   fireEvent.click(ui.getByRole('button',{name:'停止生成'}));assert.equal(stopped,1);
   ui.rerender(React.createElement(ChatRunTrace,{run:{...run,status:'stopped',endedAt:now},onStop:()=>stopped++}));
   assert.equal(timers.size,0);assert.equal(section.dataset.phase,undefined);assert.equal(ui.queryByLabelText('距上次模型修改'),null);assert.equal(ui.queryByRole('button',{name:'停止生成'}),null);ui.unmount();
   const mounted=render(React.createElement(ChatRunTrace,{run}));assert.equal(timers.size,1);mounted.unmount();assert.equal(timers.size,0);
  }finally{cleanup();Date.now=realNow;globalThis.setInterval=realSet;globalThis.clearInterval=realClear;}
 });
 await test('busy task panel and historical trace use phase without replacing draft or ending semantics',async()=>{
  const now=Date.now();const review={...activity,phase:'reviewing',lastModelEditAt:now-240_000,lastEventAt:now,title:'旧的构建说明',timings:[{id:'waiting',kind:'model',label:'secret_wait_tool',startedAt:now-100_000}]};
  const run={status:'running',mode:'pi',startedAt:now-496_000,activity:review};
  store.setState({aiStatus:'generating',lastRun:review,messages:[{id:'phase-run',role:'user',text:'检查当前模型',createdAt:run.startedAt,run}],pendingBatch:null,pendingResult:null,past:[],future:[],aiError:null});
  const ui=render(React.createElement(TaskPanel,{onConversation:()=>{}}));const current=ui.getByRole('region',{name:'当前任务状态'});
  assert.equal(current.dataset.phase,'reviewing');assert.equal(current.dataset.modelState,'waiting');assert.ok(current.querySelector('[aria-label="距上次模型修改"]'));assert.equal(current.textContent.includes(review.title),false);assert.equal(current.textContent.includes('secret_wait_tool'),false);
  cleanup();const trace=render(React.createElement(RunTrace,{run,now}));const section=trace.getByRole('region',{name:'本轮执行过程'});assert.equal(section.dataset.phase,'reviewing');assert.equal(section.dataset.modelState,'waiting');assert.match(trace.getByLabelText('距上次模型修改').textContent,/240/);
  trace.rerender(React.createElement(RunTrace,{run:{...run,status:'stopped',endedAt:now},now:now+60_000}));assert.equal(section.dataset.phase,undefined);assert.equal(trace.queryByLabelText('距上次模型修改'),null);assert.ok(trace.getByText('496 秒'));assert.ok(trace.getByText('已停止'));
 });
 await test('compact busy chat separates review, waiting and model edit age without declaring a stall',async()=>{
  const {ChatPanelX}=await server.ssrLoadModule('/src/ui/chat/ChatPanelX.tsx');
  const {activeConversationStore}=await server.ssrLoadModule('/src/conversationStores.ts');const {conversationController}=await server.ssrLoadModule('/src/runtime/conversationController.ts');
  const runtime=conversationController(activeConversationStore()),previous=runtime.ui.getState(),now=Date.now();
  const review={...activity,phase:'reviewing',title:'旧的构建说明',lastModelEditAt:now-240_000,explanations:[{id:'same',text:'已有公开说明'}],timings:[{id:'review-wait',kind:'model',label:'private_review_tool',startedAt:now-100_000}]};
  store.setState({aiStatus:'generating',lastRun:review,messages:[],pendingBatch:null,pendingResult:null,composerText:'',composerImages:[],aiConfig:null,aiError:null});
  runtime.ui.setState({agentActivity:review,started:now-496_000,runMessageId:null});
  try{
   const ui=render(React.createElement(ChatPanelX,{canvasMode:true,expanded:false}));const draft=ui.getByLabelText('当前草稿状态');
   assert.equal(draft.dataset.phase,'reviewing');assert.equal(draft.dataset.modelState,'waiting');assert.match(draft.querySelector('[aria-label="距上次模型修改"]').textContent,/240/);
   const compact=ui.container.querySelector('.adx-compact-strip');assert.ok(compact);assert.equal(compact.textContent.includes('生成中'),false);assert.equal(ui.container.textContent.includes('private_review_tool'),false);assert.equal(ui.container.textContent.includes('停滞'),false);
   const responding={...review,timings:[{...review.timings[0],firstContentAt:now}]};act(()=>runtime.ui.setState({agentActivity:responding}));assert.equal(draft.dataset.modelState,'responding');assert.equal(draft.dataset.phase,'reviewing');
   act(()=>{runtime.ui.setState({agentActivity:{...responding,phase:'repairing',lastModelEditAt:Date.now()}});});assert.equal(draft.dataset.phase,'repairing');assert.match(draft.querySelector('[aria-label="距上次模型修改"]').textContent,/0/);
   act(()=>store.setState({aiStatus:'cancelled'}));assert.equal(ui.queryByLabelText('当前草稿状态'),null);assert.equal(ui.container.querySelector('.adx-compact-strip'),null);
  }finally{cleanup();runtime.ui.setState(previous);store.setState({aiStatus:'idle'});}
 });
 console.log(passed+' customer progress checks passed');
}finally{cleanup();await server.close();dom.window.close()}
