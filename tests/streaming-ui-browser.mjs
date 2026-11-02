import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
const fixture=`
import {applyBatch} from '/src/domain/commands.ts';
export async function runModelingAgent(options){
 const start=Date.now();let activity;
 const operations=Array.from({length:8},(_,i)=>({op:'createPrimitive',name:'货架层板 '+i,parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width:2,height:.08,depth:.6}},transform:{position:[i%2*2.5,.2+Math.floor(i/2)*.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}));
 const batch={requestId:crypto.randomUUID(),projectId:options.document.projectId,baseRevision:options.document.revision,selectedIds:[],summary:'仓库货架预览已生成',operations};
 const result=applyBatch(options.document,{operations});options.onControl?.({steer:()=>true});
 for(let turn=0;turn<8;turn++){
  for(let delta=0;delta<250;delta++){
   if(options.signal.aborted)throw new DOMException('已停止','AbortError');
   activity={title:'正在创建仓库结构',turn:turn+1,toolCalls:turn,characters:turn*250+delta+1,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:Date.now(),plan:[],events:[],explanations:Array.from({length:turn+1},(_,n)=>({id:'public-'+n,text:'按尺寸创建货架，保留中央通道并检查连接结构。'.repeat(10)})),timings:[{id:'build',kind:'tool',label:'创建货架',startedAt:start}]};
   options.onActivity?.(activity);await Promise.resolve();
  }
  options.onCheckpoint?.({batch,result,activity});options.onPreview?.(result.doc);await new Promise(resolve=>setTimeout(resolve,80));
 }
 activity={...activity,title:'已生成预览',timings:activity.timings.map(t=>({...t,endedAt:Date.now()}))};return {batch,result,activity};
}`;
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-stream-')),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'streaming-agent-fixture',enforce:'pre',load(id){if(id.endsWith('/src/ai/modelingAgent.ts'))return fixture;}}]});
const report={errors:[],checks:[]};let browser,page;
try{
 await server.listen();browser=await chromium.launch({executablePath:process.env.CHAT3D_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(30000);
 page.on('pageerror',error=>report.errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.route('**/api/model/**',()=>assert.fail('UI stress test must not call a model endpoint'));
 await page.goto(base);await page.getByLabel('新项目描述',{exact:true}).waitFor();
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.getByLabel('建模指令',{exact:true}).waitFor();
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store.ts'),{activeConversationStore}=await import('/src/conversationStores.ts'),{conversationController}=await import('/src/runtime/conversationController.ts');
  s.setState({aiConfig:{baseURL:'https://fixture.invalid/v1',apiKey:'test-only-never-sent',model:'fixture',agentMode:'pi'},messages:Array.from({length:12},(_,i)=>[{id:'u-'+i,role:'user',text:'调整仓储模型 '+i,createdAt:Date.now()},{id:'a-'+i,role:'assistant',text:'保留原有布局，调整货架尺寸与连接。'.repeat(6),createdAt:Date.now()}]).flat()});
  window.progressUpdates=0;conversationController(activeConversationStore()).ui.subscribe((state,previous)=>{if(state.agentActivity!==previous.agentActivity)window.progressUpdates++;});
 });
 await page.getByLabel('建模指令',{exact:true}).fill('创建立体仓库货架');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.getByRole('region',{name:'预览确认',exact:true}).waitFor();
 const completed=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return {updates:window.progressUpdates,status:s.getState().aiStatus,characters:s.getState().lastRun.characters,original:s.getState().doc.nodes.length,preview:s.getState().pendingResult.doc.nodes.length};});
 assert.ok(completed.updates<80,JSON.stringify(completed));assert.equal(completed.status,'previewing');assert.equal(completed.characters,2000);assert.equal(completed.original,0);assert.equal(completed.preview,8);
 report.checks.push('2000 buffered progress events complete with bounded UI notifications and intact preview');console.log('PASS',report.checks.at(-1),JSON.stringify(completed));
 await page.getByRole('button',{name:'应用修改',exact:true}).click();
 await page.getByLabel('建模指令',{exact:true}).fill('继续调整货架');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await page.waitForTimeout(250);
 const stopped=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return {status:s.getState().aiStatus,nodes:s.getState().doc.nodes.length};});
 assert.ok(['previewing','cancelled'].includes(stopped.status));assert.equal(stopped.nodes,8);
 report.checks.push('stop retains the applied scene and delayed events cannot restart the run');console.log('PASS',report.checks.at(-1));
 await mkdir('artifacts/ant-design-x',{recursive:true});await page.screenshot({path:'artifacts/ant-design-x/streaming-progress-fixed.png'});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){
 if(page)try{report.failure=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return {status:s.getState().aiStatus,error:s.getState().aiError,updates:window.progressUpdates};});console.log('FAILURE STATE',JSON.stringify(report.failure));}catch{}
 throw error;
}finally{await browser?.close();await server.close();await writeFile('artifacts/ant-design-x/streaming-report.json',JSON.stringify(report,null,2));}
