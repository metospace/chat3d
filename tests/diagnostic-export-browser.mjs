import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

// Optional read-only replay: SCENIVO_DIAGNOSTIC_FIXTURE="D:/download/scenivo-diagnostics (5).json".
const inputPath=process.env.SCENIVO_DIAGNOSTIC_FIXTURE??process.env.CHAT3D_DIAGNOSTIC_INPUT;
const fixture=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TaskPanel} from '/src/ui/TaskPanel.tsx';
import {createEditorStore} from '/src/store.ts';
import {prepareDiagnosticExport} from '/src/util/diagnosticExport.ts';
window.exportWorkers={created:0,terminated:0,active:0};
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.done=false;window.exportWorkers.created++;window.exportWorkers.active++;}terminate(){if(!this.done){this.done=true;window.exportWorkers.terminated++;window.exportWorkers.active--;}return super.terminate();}};
window.downloads=[];const originalURL=URL.createObjectURL;
URL.createObjectURL=blob=>{window.downloads.push(blob);return originalURL(blob);};
HTMLAnchorElement.prototype.click=function(){};
const state=createEditorStore();window.editor=state;
const root=createRoot(document.getElementById('root'));
window.mount=()=>root.render(React.createElement(TaskPanel,{editor:state,onConversation:()=>{}}));window.unmount=()=>root.unmount();
window.loadInput=async actual=>{
 let snapshot;
 if(actual){const response=await fetch('/__diagnostic_input');if(!response.ok)throw Error(await response.text());snapshot=await response.json();}
 else {
  const payload='image-and-request-content-'.repeat(42000);
  const numeric=Array.from({length:1000000},(_,i)=>i/7);
  const doc={...state.getState().doc,nodes:[],assets:[],diagnosticGeometry:numeric};
  const requests=Array.from({length:50},(_,i)=>({at:i,kind:'model_request',data:{model:'fixture',messages:[{role:'system',content:'System prompt retained exactly'},{role:'user',content:payload+' request '+i}],temperature:0}}));
  const activity={title:'后台建模',turn:50,toolCalls:1,characters:1,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:1,plan:[],events:[],timings:[],diagnostics:requests};
  const applied=Array.from({length:100},()=>({command:{op:'updateTransform',nodeId:'fixture'},before:{nodes:[],materialIds:[],doc},after:{nodes:[],materialIds:[],doc},doc}));
  snapshot={doc,aiStatus:'generating',lastRun:activity,aiError:null,messages:[{id:'fixture',role:'user',text:'保留诊断内容',createdAt:1,run:{startedAt:1,status:'running',activity}}],pendingBatch:null,pendingResult:{doc,applied,errors:[]},past:[{summary:'test',bytes:1,applied,docAfter:doc}],future:[]};
 }
 const {aiStatus,lastRun,aiError,messages,doc,pendingBatch,pendingResult,past,future}=snapshot;
 state.setState({aiStatus:aiStatus??'idle',lastRun:lastRun??null,aiError:aiError??null,messages:messages??[],doc:doc??state.getState().doc,pendingBatch:pendingBatch??null,pendingResult:pendingResult??null,past:past??[],future:future??[]});
 window.liveDiagnostics=snapshot.liveDiagnostics;
};
window.startHeartbeat=()=>{window.beats=0;window.maxGap=0;let previous=performance.now();window.beatTimer=setInterval(()=>{const now=performance.now();window.maxGap=Math.max(window.maxGap,now-previous);previous=now;window.beats++;},10);};
window.stopHeartbeat=()=>clearInterval(window.beatTimer);
window.directExport=async()=>{const s=state.getState();const snapshot={aiStatus:s.aiStatus,lastRun:s.lastRun,aiError:s.aiError,messages:s.messages,doc:s.doc,pendingBatch:s.pendingBatch,pendingResult:s.pendingResult,past:s.past,future:s.future};const stringify=JSON.stringify;JSON.stringify=()=>{throw Error('JSON.stringify must not run on main thread');};try{const result=await prepareDiagnosticExport(snapshot,window.liveDiagnostics);window.directBlob=result.blob;return {bytes:result.bytes,summary:result.summary};}finally{JSON.stringify=stringify;}};
window.mount();`;
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'diagnostic-export-fixture',resolveId(id){if(id==='/__diagnostic_fixture.js')return '\0diagnostic-export-fixture';},load(id){if(id==='\0diagnostic-export-fixture')return fixture;},configureServer(server){server.middlewares.use(async(req,res,next)=>{
 if(req.url==='/__diagnostic_fixture'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__diagnostic_fixture','<html><body><div id="root"></div><script type="module" src="/__diagnostic_fixture.js"></script></body></html>'));return;}
 if(req.url==='/__diagnostic_input'){try{if(!inputPath)throw Error('SCENIVO_DIAGNOSTIC_FIXTURE is not set');res.setHeader('Content-Type','application/json');res.end(await readFile(inputPath));}catch(error){res.statusCode=500;res.end(String(error));}return;}
 next();
 });}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHAT3D_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__diagnostic_fixture');
 await page.waitForFunction(()=>!!window.editor);await page.evaluate(actual=>window.loadInput(actual),!!inputPath);
 const initialStatus=await page.evaluate(()=>window.editor.getState().aiStatus);
 await page.getByText('问题排查',{exact:true}).click();
 await page.getByRole('button',{name:'下载完整诊断记录',exact:true}).click();
 await page.getByRole('button',{name:'取消准备',exact:true}).waitFor();
 await page.waitForFunction(()=>window.exportWorkers.active>0);
 assert.equal(await page.locator('textarea').count(),0);
 const cancelLatency=await page.evaluate(async()=>{const start=performance.now();[...document.querySelectorAll('button')].find(button=>button.textContent==='取消准备').click();while(window.exportWorkers.active)await new Promise(resolve=>setTimeout(resolve,0));return performance.now()-start;});
 assert.ok(cancelLatency<200,'cancel should finish within 200 ms');await page.waitForFunction(()=>window.exportWorkers.active===0);
 assert.match(await page.getByRole('status').textContent(),/已取消/);
 assert.equal(await page.evaluate(()=>window.editor.getState().aiStatus),initialStatus);
 console.log('PASS preparation paints, cancellation terminates its worker, no diagnostic textarea is rendered');
 await page.getByRole('button',{name:'下载完整诊断记录',exact:true}).click();await page.getByRole('button',{name:'取消准备',exact:true}).waitFor();await page.waitForFunction(()=>window.exportWorkers.active>0);
 await page.getByText('问题排查',{exact:true}).click();await page.waitForFunction(()=>window.exportWorkers.active===0);
 const failure=await page.evaluate(async()=>{const Native=window.Worker;window.Worker=class{constructor(){throw Error('fixture worker unavailable');}};try{await window.directExport();return 'unexpected success';}catch(error){return String(error);}finally{window.Worker=Native;}});
 assert.match(failure,/fixture worker unavailable/);assert.equal(await page.evaluate(()=>window.exportWorkers.active),0);
 console.log('PASS worker construction failure propagates and retry is still available');
 console.log('PASS closing diagnostics cancels background preparation');
 await page.evaluate(()=>window.startHeartbeat());
 const result=await page.evaluate(()=>window.directExport());
 const heartbeat=await page.evaluate(()=>{window.stopHeartbeat();return {beats:window.beats,maxGap:window.maxGap,workers:window.exportWorkers};});
 assert.ok(result.bytes>0);assert.ok(result.summary.length<1024);assert.ok(heartbeat.beats>3,JSON.stringify(heartbeat));assert.ok(heartbeat.maxGap<500,JSON.stringify(heartbeat));assert.equal(heartbeat.workers.active,0);
 const data=await page.evaluate(async()=>{const b=JSON.parse(await window.directBlob.text());return {format:b.format,omissions:b.omissions,hasConfig:!!b.data.aiConfig||!!b.data.diagnosticApiKey};});
 assert.equal(data.format,'chat3d-diagnostics-v2');assert.equal(data.hasConfig,false);assert.ok(data.omissions.some(item=>item.path.includes('pendingResult.applied')));
 console.log('PASS full export keeps browser heartbeat alive, stringifies only in worker, returns Blob and small summary',JSON.stringify({bytes:result.bytes,...heartbeat}));
 await page.getByText('问题排查',{exact:true}).click();await page.getByRole('button',{name:'下载完整诊断记录',exact:true}).click();
 await page.waitForFunction(()=>window.downloads.length===1);await page.getByRole('status').filter({hasText:'尚未确认'}).waitFor();assert.ok(await page.getByLabel('诊断导出摘要').textContent());
 assert.equal(await page.locator('textarea').count(),0);
 console.log('PASS task panel downloads original Blob and renders only compact summary');
 await page.getByRole('button',{name:'下载完整诊断记录',exact:true}).click();await page.getByRole('button',{name:'取消准备',exact:true}).waitFor();await page.waitForFunction(()=>window.exportWorkers.active>0);await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>window.exportWorkers.active===0);
 assert.deepEqual(errors,[]);console.log('PASS unmount terminates export worker');
}finally{await browser?.close();await server.close();}
