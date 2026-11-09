import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const output=resolve('artifacts/ant-design-x');await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(path=>path&&existsSync(path));
assert.ok(executablePath,'Set CHAT3D_BROWSER_PATH');
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-x-browser-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;const report={checks:[],errors:[]};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
try{
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port);
 await page.getByLabel('新项目描述',{exact:true}).waitFor();
 const files=Array.from({length:5},(_,i)=>({name:`part-${i}.glb`,mimeType:'model/gltf-binary',buffer:Buffer.from('fixture')}));
 await check('home uses native Sender and Attachments file selection',async()=>{
  assert.equal(await page.locator('.home-x-sender .ant-sender-input').count(),1);
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加参考附件',exact:true}).click();
  const chooser=await chooserPromise;assert.equal(chooser.isMultiple(),true);await chooser.setFiles(files);
  await page.locator('.home-x-sender .ant-file-card[aria-label="part-4.glb"]').waitFor();
  assert.equal(await page.locator('.home-x-sender .ant-file-card').count(),5);
  await page.screenshot({path:join(output,'home-attachments.png')});
 });
 await check('home removal is keyboard accessible and draft stays intact',async()=>{
  await page.getByLabel('新项目描述',{exact:true}).fill('保留这个输入');
  await page.getByLabel('移除参考附件 5',{exact:true}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('.home-x-sender [aria-label="part-4.glb"]'));
  assert.equal(await page.getByLabel('新项目描述',{exact:true}).inputValue(),'保留这个输入');
 });
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.getByLabel('建模描述',{exact:true}).waitFor();
 const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#2563eb';ctx.fillRect(0,0,32,32);return canvas.toDataURL().split(',')[1];});
 const image={name:'reference.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
 await check('workbench Sender uploads local references without network requests',async()=>{
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加参考附件',exact:true}).click();
  const chooser=await chooserPromise;await chooser.setFiles([...files.slice(0,2),image]);
  await page.locator('.adx-sender .ant-file-card[aria-label="part-1.glb"]').waitFor();
  assert.equal(await page.locator('.adx-sender .ant-file-card').count(),3);
  assert.equal(await page.getByRole('button',{name:'发送',exact:true}).isEnabled(),true);
 });
 await check('Attachments image uses built-in image preview',async()=>{
  await page.locator('.adx-sender .ant-image').click();await page.locator('.ant-image-preview-close').waitFor();
  await page.locator('.ant-image-preview-close').click();
 });
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store.ts');const now=Date.now();
  const activity={title:'第9轮模型响应',turn:9,toolCalls:2,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:now,plan:[],events:[],explanations:[{id:'design-note',phase:'planning',text:'保留原有布局，检查货架层间距。',createdAt:now-3500},{id:'build-note',phase:'building',text:'先调整货架高度。',createdAt:now-1800},{id:'build-detail',phase:'building',text:'保留原有列距，再核对横梁位置。',createdAt:now-1000},{id:'legacy-note',text:'旧记录没有时间。'}],timings:[{id:'model-9',kind:'model',label:'第9轮模型响应',startedAt:now-4000,endedAt:now-3000},{id:'build',kind:'tool',toolName:'build_modeling_program',label:'build_modeling_program',phase:'building',summary:'{"operations":[]}',startedAt:now-2000},{id:'read',kind:'tool',toolName:'inspect_scene',label:'inspect_scene',phase:'reviewing',summary:'已读取现有货架布局。',detail:'Error: private raw failure',startedAt:now-3000,endedAt:now-2500}]};
  // Production attaches run metadata to the user request, not the assistant reply.
  s.setState({aiConfig:{baseURL:'https://fixture.invalid/v1',apiKey:'fixture-never-used',model:'UI fixture',agentMode:'single'},aiStatus:'generating',messages:[{id:'fixture-user',role:'user',text:'调整仓库货架的高度',createdAt:now-5000,run:{status:'running',startedAt:now-4000,activity}},{id:'fixture-response',role:'assistant',text:'正在检查货架结构。',createdAt:now}]});
  const {conversationController}=await import('/src/runtime/conversationController.ts');const {activeConversationStore}=await import('/src/conversationStores.ts');
  conversationController(activeConversationStore()).ui.setState({started:now-4000,runMessageId:'fixture-user',agentActivity:activity});
 });
 const timeline=page.getByRole('region',{name:'工作时间线',exact:true}),disclosure=timeline.locator('button[aria-expanded][aria-controls]');
 await check('user request precedes left-aligned process and assistant reply',async()=>{
  const boxes=await page.locator('.adx-messages .ant-bubble').evaluateAll(elements=>elements.filter(el=>el.matches('.adx-bubble,.adx-process-message')).map(el=>({kind:el.classList.contains('adx-process-message')?'process':el.classList.contains('is-user')?'user':'assistant',left:el.getBoundingClientRect().left,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
  assert.deepEqual(boxes.map(b=>b.kind),['user','process','assistant']);
  assert.ok(boxes[0].bottom<=boxes[1].top+1);assert.ok(boxes[1].bottom<=boxes[2].top+1);
  assert.ok(Math.abs(boxes[1].left-boxes[2].left)<=1,'process aligns with assistant, independent of user bubble');
 });
 await check('process starts compact and reveals all public records with one keyboard disclosure',async()=>{
  await disclosure.waitFor();assert.equal(await disclosure.count(),1);assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  const details=page.locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`),feed=timeline.getByRole('list',{name:'建模进展',exact:true});assert.equal(await details.evaluate(el=>el.hidden),true);assert.equal(await feed.isVisible(),false);assert.match(await disclosure.textContent(),/\d+/);assert.ok((await disclosure.textContent()).trim());
  const compact=await timeline.boundingBox(),stop=page.getByRole('button',{name:'停止生成',exact:true});assert.equal(await stop.isVisible(),true);assert.equal(await details.getByRole('button',{name:'停止生成',exact:true}).count(),0);
  await disclosure.focus();await disclosure.press('Enter');assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.equal(await details.evaluate(el=>el.hidden),false);await feed.waitFor();assert.ok((await timeline.boundingBox()).height>compact.height);
  const entries=feed.getByRole('listitem');assert.equal(await entries.count(),5);
  const explanations=['保留原有布局，检查货架层间距。','先调整货架高度。','保留原有列距，再核对横梁位置。','旧记录没有时间。'];for(const text of explanations)assert.equal(await entries.filter({hasText:text}).count(),1);
  assert.equal(await entries.filter({hasText:'已读取现有货架布局。'}).count(),1);assert.equal(await entries.evaluateAll(rows=>rows.every(row=>row.parentElement===rows[0].parentElement)),true);assert.equal(await feed.getByRole('list').count(),0);
  const visible=await timeline.textContent();for(const hidden of ['第9轮','build_modeling_program','inspect_scene','private raw failure','"operations"','Error:'])assert.equal(visible.includes(hidden),false,hidden);
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{conversationController}=await import('/src/runtime/conversationController.ts'),{activeConversationStore}=await import('/src/conversationStores.ts');const request=s.getState().messages.find(m=>m.run),activity={...request.run.activity,explanations:[{id:'earlier-layout',text:'先核对已有布局。',createdAt:request.run.startedAt-2000},{id:'earlier-height',text:'再核对现有高度。',createdAt:request.run.startedAt-1000},...request.run.activity.explanations]};s.getState().updateMessageRun(request.id,{activity});conversationController(activeConversationStore()).ui.setState({agentActivity:activity});});
  await entries.nth(6).waitFor();assert.equal(await entries.count(),7);assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.equal(await disclosure.count(),1);assert.equal(await timeline.getByRole('button').count(),1,'all records share the outer disclosure without an older-history toggle');assert.equal(await feed.getByRole('list').count(),0);
  await disclosure.press('Space');assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await feed.isVisible(),false);
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{conversationController}=await import('/src/runtime/conversationController.ts'),{activeConversationStore}=await import('/src/conversationStores.ts');const request=s.getState().messages.find(m=>m.run),activity={...request.run.activity,explanations:[...request.run.activity.explanations,{id:'latest-detail',text:'最后检查连接位置。',createdAt:Date.now()}]};s.getState().updateMessageRun(request.id,{activity});conversationController(activeConversationStore()).ui.setState({agentActivity:activity});});
  assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await details.evaluate(el=>el.hidden),true);assert.equal(await stop.isVisible(),true);await disclosure.press('Enter');await entries.nth(7).waitFor();assert.equal(await entries.count(),8);
  await page.getByLabel('建模描述',{exact:true}).click();await page.screenshot({path:join(output,'workbench-timeline-attachments.png')});
 });
 await check('native Sender cancel keeps unsent references and draft',async()=>{
  await page.getByLabel('建模描述',{exact:true}).fill('把高度改为 3 米');
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  assert.equal(await page.getByLabel('建模描述',{exact:true}).inputValue(),'把高度改为 3 米');
  assert.equal(await page.locator('.adx-sender .ant-file-card').count(),3);
 });
 await check('completed process preserves disclosure choice and Sender stays clean at narrow widths',async()=>{
  assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({composerImages:[],composerText:'把货架高度调整为 3 米',aiStatus:'idle',messages:s.getState().messages.map(m=>m.run?{...m,run:{...m.run,status:'completed',endedAt:Date.now()}}:m)});});
  await page.getByRole('list',{name:'建模进展',exact:true}).waitFor();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');await disclosure.click();
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({messages:s.getState().messages.map(m=>m.run?{...m,run:{...m.run,endedAt:Date.now()}}:m)});});assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await page.getByRole('list',{name:'建模进展',exact:true}).isVisible(),false);await disclosure.click();
  assert.equal(await page.getByRole('button',{name:'参考附件设置',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'添加参考附件',exact:true}).count(),1);
  assert.equal(await page.locator('.adx-sender .ant-sender-prefix').count(),0);
  assert.equal(await page.locator('.adx-sender .ant-sender-suffix').count(),0);
  assert.equal(await page.locator('.adx-sender .adx-composer-toolbar').count(),1);
  assert.equal(await page.locator('.adx-sender .adx-composer-hint').count(),0);
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const reopen=page.getByRole('button',{name:'打开 AI 助手',exact:true});if(await reopen.isVisible())await reopen.click();
  await page.getByLabel('建模描述',{exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>{const el=document.querySelector('.adx-composer-toolbar');return el&&el.clientWidth>0&&el.scrollWidth<=el.clientWidth+1;});
  await page.getByLabel('建模描述',{exact:true}).focus();
  await page.mouse.move(600,150);
  const modelStyle=await page.locator('.adx-composer-controls .model-picker-trigger').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(modelStyle,'rgba(0, 0, 0, 0)');
  await page.screenshot({path:join(output,'workbench-simple-think-sender.png')});
  await page.locator('.conversation-region').screenshot({path:join(output,'conversation-clean.png')});
  assert.equal(await page.locator('.ant-bubble-list').count(),1);
  assert.equal(await page.locator('.is-assistant .ant-bubble-footer').count(),0,'no empty response action footer');
  assert.equal(await page.getByRole('button',{name:'复制回复',exact:true}).count(),0);
 });
 await check('running conversation keeps request first and stop in footer',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');const now=Date.now();s.setState({aiStatus:'generating',composerText:'',messages:s.getState().messages.map(m=>m.run?{...m,run:{...m.run,status:'running',startedAt:now-5000}}:m)});const {conversationController}=await import('/src/runtime/conversationController.ts');const {activeConversationStore}=await import('/src/conversationStores.ts');conversationController(activeConversationStore()).ui.setState({started:now-5000,runMessageId:'fixture-user',agentActivity:s.getState().messages[0].run.activity});});
  await disclosure.waitFor();assert.equal(await disclosure.getAttribute('aria-expanded'),'true');await page.getByRole('list',{name:'建模进展',exact:true}).waitFor();
  const stop=page.getByRole('button',{name:'停止生成',exact:true});await stop.waitFor();const details=page.locator(`[id="${await disclosure.getAttribute('aria-controls')}"]`);assert.equal(await details.getByRole('button',{name:'停止生成',exact:true}).count(),0);
  await page.locator('.conversation-region').screenshot({path:join(output,'conversation-running.png')});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
