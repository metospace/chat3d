import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const backend=process.env.SCENIVO_TEST_ORIGIN??'http://127.0.0.1:1420';
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-blender-direct-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false}});let browser;
try{
 await server.listen();const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&existsSync(p));browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});page.setDefaultTimeout(90000);
 const files=new Map();let calls=0,executions=0,statusChecks=0,mode='blender';
 let releaseModel,releaseBuild;const modelGate=new Promise(resolve=>releaseModel=resolve),buildGate=new Promise(resolve=>releaseBuild=resolve);
 await page.route('**/api/blender/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;if(path==='/api/blender/python/status')statusChecks++;if(request.method()==='POST')await buildGate;const headers={'X-Chat3D-Python':request.headers()['x-chat3d-python']??'1',origin:backend};if(request.method()==='POST')headers['Content-Type']='application/json';const response=await fetch(backend+path,{method:request.method(),headers,body:request.method()==='POST'?request.postData():undefined});const bytes=Buffer.from(await response.arrayBuffer());if(request.method()==='POST'&&response.ok){executions++;const form=await new Response(bytes,{headers:{'Content-Type':response.headers.get('content-type')}}).formData();for(const key of ['blend','glb','render'])files.set(key,Buffer.from(await form.get(key).arrayBuffer()));}await route.fulfill({status:response.status,contentType:response.headers.get('content-type')??'application/json',body:bytes});});
 const script=await readFile(new URL('./blender-agv-fixture.py',import.meta.url),'utf8');
 await page.route('**/api/model/chat/completions',async route=>{
  calls++;const body=JSON.parse(route.request().postData());
  if(mode==='normal'){assert.equal(body.tools?.some(t=>t.function.name==='run_blender_python')??false,false);await route.fulfill({status:200,contentType:'application/json',headers:{'x-chat3d-proxy':'1'},body:JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'无需修改',operations:[]})}}]})});return;}
  assert.deepEqual(body.tools.map(t=>t.function.name),['run_blender_python']);
  await modelGate;
  const tool_calls=[{index:0,id:'real-blender',type:'function',function:{name:'run_blender_python',arguments:JSON.stringify({name:'原始AGV',script})}}];
  const events=[{choices:[{index:0,delta:{role:'assistant',tool_calls},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}];
  await route.fulfill({status:200,contentType:'text/event-stream',headers:{'x-chat3d-proxy':'1'},body:events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n'});
 });
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port);await page.getByLabel('新项目描述',{exact:true}).waitFor();
 const home=page.getByRole('region',{name:'创建新项目',exact:true}),option=home.getByRole('button',{name:'生成档位，当前精细',exact:true});assert.equal(statusChecks,0);
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().setAiConfig({baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture',agentMode:'pi',stream:true});});
 await option.click();assert.equal(await page.getByRole('menuitemradio',{name:'直接生成',exact:true}).getAttribute('aria-checked'),'true');assert.equal(await page.getByRole('menuitemradio',{name:'简洁风格',exact:true}).count(),0);await page.getByRole('menuitemradio',{name:'Blender 生成',exact:true}).click();await home.getByLabel('新项目描述',{exact:true}).fill('用 Blender 制作 AGV，返回原始模型和效果图');
 await page.getByRole('menu',{name:'生成档位',exact:true}).waitFor({state:'hidden'});
 await mkdir('artifacts/blender-direct',{recursive:true});await page.screenshot({path:'artifacts/blender-direct/home.png'});
 await page.setViewportSize({width:390,height:844});assert.ok(await option.isVisible());
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,{},{timeout:5000});
 await page.screenshot({path:'artifacts/blender-direct/home-narrow.png'});await page.setViewportSize({width:1440,height:960});
 await home.getByRole('button',{name:'开始生成',exact:true}).click();const card=page.getByRole('region',{name:'最新 Blender 建模结果'});
 const progress=page.getByRole('status',{name:'生成进度',exact:true});await progress.getByText('等待模型回复',{exact:true}).waitFor();assert.equal(await page.getByText('等待模型回复',{exact:true}).count(),1);assert.equal(await page.getByText('等待公开工作说明。',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).count(),1);await page.screenshot({path:'artifacts/blender-direct/waiting.png'});
 assert.equal(await page.getByText('会自动执行 Python，仅用于可信输入',{exact:true}).count(),0);
 await page.getByRole('button',{name:'收起对话区',exact:true}).click();await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();await progress.getByText('等待模型回复',{exact:true}).waitFor();
 releaseModel();await progress.getByText('Blender 正在建模与渲染',{exact:true}).waitFor();await page.screenshot({path:'artifacts/blender-direct/executing.png'});releaseBuild();
 try{await card.waitFor();}catch(error){const state=await page.evaluate(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');const s=activeConversationStore().getState();return {status:s.aiStatus,error:s.aiError,timings:s.lastRun?.timings};});throw Error(JSON.stringify({calls,executions,state}),{cause:error});}
 await page.getByRole('region',{name:'预览确认',exact:true}).waitFor();assert.deepEqual(await page.evaluate(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');const s=activeConversationStore().getState();return {official:s.doc.nodes.length,preview:s.pendingResult?.doc.nodes.length,status:s.aiStatus};}),{official:0,preview:10,status:'previewing'});assert.equal(calls,1);assert.equal(executions,1);
 const diagnostics=await page.evaluate(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');const s=activeConversationStore().getState(),{fullRunDiagnostics}=await import('/src/domain/runDiagnostics.ts');return fullRunDiagnostics(s);});assert.ok(diagnostics.lastRun.diagnostics.some(entry=>entry.kind==='tool_start'&&entry.data.arguments.script===script));assert.ok(diagnostics.lastRun.diagnostics.some(entry=>entry.kind==='tool_end'));assert.ok(diagnostics.lastRun.diagnostics.some(entry=>entry.kind==='model_request'));assert.equal(JSON.stringify(diagnostics).includes('fixture.invalid'),true);
 await page.screenshot({path:'artifacts/blender-direct/workbench-preview.png'});
 await page.getByRole('button',{name:'应用修改',exact:true}).click();await page.waitForFunction(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');const s=activeConversationStore().getState();return s.aiStatus==='idle'&&s.doc.nodes.length===10;});
 await page.evaluate(async()=>{const {Viewport}=await import('/src/scene/Viewport.ts');const original=Viewport.prototype.setComposition;Viewport.prototype.setComposition=function(config){window.blenderWorkbenchViewport=this;return original.call(this,config);};});
 const tree=page.locator('.object-tree');await tree.getByRole('button',{name:'展开 原始AGV',exact:true}).click();const forks=tree.getByRole('button',{name:/^Fork/});await forks.nth(0).click();await forks.nth(1).click({modifiers:['Shift']});
 const selectionLabel=page.getByLabel('当前选中对象',{exact:true});assert.match(await selectionLabel.textContent(),/2 个部件.*Fork/);
 await page.getByRole('button',{name:'移动选中对象',exact:true}).click();
 const snapshot=()=>page.evaluate(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');const state=activeConversationStore().getState();return {selection:state.selection,nodes:state.doc.nodes.map(n=>({id:n.id,transform:n.transform})),undo:state.past.length};});
 const before=await snapshot();assert.equal(before.selection.length,2);
 const handle=await page.evaluate(async()=>{const vp=window.blenderWorkbenchViewport,object=vp.scene.getObjectByName('__manualTransformHandle');const p=object.position.clone().project(vp.camera),r=vp.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};});
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x+75,handle.y,{steps:6});await page.mouse.up();
 const after=await snapshot();assert.equal(after.undo,before.undo+1);for(const [index,node] of before.nodes.entries()){if(before.selection.includes(node.id))assert.notDeepEqual(after.nodes[index],node);else assert.deepEqual(after.nodes[index],node);}
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual((await snapshot()).nodes,before.nodes);
 assert.equal(await page.getByRole('button',{name:'交互查看 GLB',exact:true}).count(),0);
 await card.locator('summary').click();await page.waitForFunction(()=>{const image=document.querySelector('.adx-blender-render');return image?.complete&&image.naturalWidth>0;});
 const hash=data=>createHash('sha256').update(data).digest('hex');for(const [key,ext] of [['blend','.blend'],['glb','.glb'],['render','.png']]){const download=page.waitForEvent('download');await card.getByRole('link',{name:'下载 '+ext,exact:true}).click();const item=await download;assert.equal(item.suggestedFilename(),'原始AGV'+ext);assert.equal(hash(await readFile(await item.path())),hash(files.get(key)));}
 const header=page.locator('.conversation-panel-title'),taskButton=header.getByRole('button',{name:'本项目任务记录',exact:true}),closeButton=header.getByRole('button',{name:'收起对话区',exact:true});const taskBox=await taskButton.boundingBox(),closeBox=await closeButton.boundingBox();assert.ok(taskBox.width>=60&&taskBox.x+taskBox.width<=closeBox.x);
 await taskButton.click();const taskDialog=page.getByRole('dialog',{name:'本项目任务记录',exact:true});await taskDialog.getByText('问题排查',{exact:true}).click();const fileDownload=page.waitForEvent('download');await taskDialog.getByRole('button',{name:'下载完整诊断记录',exact:true}).click();const downloaded=await fileDownload;const complete=JSON.parse(await readFile(await downloaded.path(),'utf8'));assert.ok(complete.lastRun.diagnostics.some(entry=>entry.kind==='tool_start'&&entry.data.arguments.script===script));assert.equal(complete.aiConfig,undefined);await page.screenshot({path:'artifacts/blender-direct/full-diagnostics.png'});await page.keyboard.press('Escape');await taskDialog.waitFor({state:'hidden'});
 await page.screenshot({path:'artifacts/blender-direct/result.png'});
 await page.getByRole('button',{name:'返回首页',exact:true}).click();await option.click();await page.getByRole('menuitemradio',{name:'直接生成',exact:true}).click();
 mode='normal';const previousChecks=statusChecks;await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().setAiConfig({...s.getState().aiConfig,agentMode:'single',stream:false});});await home.getByLabel('新项目描述',{exact:true}).fill('说明当前任务，不创建模型');await home.getByRole('button',{name:'开始生成',exact:true}).click();await page.waitForFunction(async()=>{const {activeConversationStore}=await import('/src/conversationStores.ts');return activeConversationStore().getState().messages.some(m=>m.role==='assistant');});assert.equal(executions,1);assert.equal(statusChecks,previousChecks);assert.equal(calls,2);assert.equal(await page.locator('.conversation-region .quality-picker-trigger').getAttribute('aria-description'),'生成方式：直接生成');
 const editorPicker=page.locator('.conversation-region .quality-picker-trigger');await editorPicker.click();await page.getByRole('menuitemradio',{name:'Blender 生成',exact:true}).click();await page.getByText('本机 Blender 已连接',{exact:true}).waitFor();assert.equal(await editorPicker.getAttribute('aria-description'),'生成方式：Blender 生成');await editorPicker.click();await page.screenshot({path:'artifacts/blender-direct/editor-method-menu.png'});await page.getByRole('menuitemradio',{name:'直接生成',exact:true}).click();assert.equal(await editorPicker.getAttribute('aria-description'),'生成方式：直接生成');assert.equal(await page.getByRole('checkbox',{name:'Blender Python 建模',exact:true}).count(),0);
 console.log('PASS Blender workbench preview and apply, exact multi-part drag and undo, original downloads, unchecked home isolation');
}finally{await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
