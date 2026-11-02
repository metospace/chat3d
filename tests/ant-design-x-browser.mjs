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
 await page.getByLabel('建模指令',{exact:true}).waitFor();
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
  const activity={title:'正在接收模型回复',turn:1,toolCalls:1,characters:0,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:now,plan:[],events:[],explanations:[{text:'保留原有布局，检查货架层间距。'}],timings:[{kind:'tool',label:'检查场景结构',startedAt:now-3000,endedAt:now-2000}]};
  // Production attaches run metadata to the user request, not the assistant reply.
  s.setState({aiConfig:{baseURL:'https://fixture.invalid/v1',apiKey:'fixture-never-used',model:'UI fixture',agentMode:'single'},aiStatus:'generating',messages:[{id:'fixture-user',role:'user',text:'调整仓库货架的高度',createdAt:now-5000,run:{status:'running',startedAt:now-4000,activity}},{id:'fixture-response',role:'assistant',text:'正在检查货架结构。',createdAt:now}]});
  const {conversationController}=await import('/src/runtime/conversationController.ts');const {activeConversationStore}=await import('/src/conversationStores.ts');
  conversationController(activeConversationStore()).ui.setState({started:now-4000,runMessageId:'fixture-user',agentActivity:activity});
 });
 await check('user request precedes left-aligned process and assistant reply',async()=>{
  const boxes=await page.locator('.adx-messages .ant-bubble').evaluateAll(elements=>elements.filter(el=>el.matches('.adx-bubble,.adx-process-message')).map(el=>({kind:el.classList.contains('adx-process-message')?'process':el.classList.contains('is-user')?'user':'assistant',left:el.getBoundingClientRect().left,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
  assert.deepEqual(boxes.map(b=>b.kind),['user','process','assistant']);
  assert.ok(boxes[0].bottom<=boxes[1].top+1);assert.ok(boxes[1].bottom<=boxes[2].top+1);
  assert.ok(Math.abs(boxes[1].left-boxes[2].left)<=1,'process aligns with assistant, independent of user bubble');
 });
 for(const reducedMotion of ['no-preference','reduce'])await check('native processing spinner rotates with '+reducedMotion,async()=>{
  await page.emulateMedia({reducedMotion});const spinner=page.locator('.adx-run.is-active .anticon-loading');
  await spinner.waitFor();const before=await spinner.evaluate(el=>({transform:getComputedStyle(el).transform,animation:getComputedStyle(el).animationName}));
  await page.waitForTimeout(180);const after=await spinner.evaluate(el=>getComputedStyle(el).transform);
  assert.notEqual(before.animation,'none');assert.notEqual(before.transform,after,'running indicator must visibly rotate');
 });
 await check('Think uses plain paragraphs and keyboard disclosure without tool nodes',async()=>{
  await page.locator('.adx-run .ant-think').waitFor();assert.equal(await page.locator('.adx-run .ant-thought-chain').count(),0);assert.equal(await page.locator('.adx-run .ant-think-content p').textContent(),'保留原有布局，检查货架层间距。');
  const toggle=page.getByRole('button',{name:/正在处理.*收起摘要/});await toggle.focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:/正在处理.*查看摘要/}).waitFor();
  await page.getByRole('button',{name:/正在处理.*查看摘要/}).press('Enter');
  await page.getByRole('button',{name:/正在处理.*收起摘要/}).waitFor();
  await page.getByLabel('建模指令',{exact:true}).click();
  await page.screenshot({path:join(output,'workbench-think-attachments.png')});
 });
 await check('native Sender cancel keeps unsent references and draft',async()=>{
  await page.getByLabel('建模指令',{exact:true}).fill('把高度改为 3 米');
  await page.getByRole('button',{name:'停止生成',exact:true}).click();
  assert.equal(await page.getByLabel('建模指令',{exact:true}).inputValue(),'把高度改为 3 米');
  assert.equal(await page.locator('.adx-sender .ant-file-card').count(),3);
 });
 await check('official-style Think and single-row Sender stay clean at narrow widths',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({composerImages:[],composerText:'把货架高度调整为 3 米',aiStatus:'idle',messages:s.getState().messages.map(m=>m.run?{...m,run:{...m.run,status:'completed'}}:m)});});
  await page.getByRole('button',{name:/处理完成.*查看摘要/}).click();
  await page.locator('.adx-run .ant-think-content p').waitFor();
  assert.equal(await page.locator('.adx-sender .ant-sender-prefix').count(),0);
  assert.equal(await page.locator('.adx-sender .ant-sender-suffix').count(),0);
  assert.equal(await page.locator('.adx-sender .adx-composer-toolbar').count(),1);
  assert.equal(await page.locator('.adx-sender .adx-composer-hint').count(),0);
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const reopen=page.getByRole('button',{name:'打开 AI 助手',exact:true});if(await reopen.isVisible())await reopen.click();
  await page.getByLabel('建模指令',{exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>{const el=document.querySelector('.adx-composer-toolbar');return el&&el.clientWidth>0&&el.scrollWidth<=el.clientWidth+1;});
  const type=await page.locator('.adx-run .ant-think-content p').evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),line:getComputedStyle(el).lineHeight}));assert.ok(type.size>=14);
  await page.getByLabel('建模指令',{exact:true}).focus();
  await page.mouse.move(600,150);
  const modelStyle=await page.locator('.adx-composer-controls .model-picker-trigger').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(modelStyle,'rgba(0, 0, 0, 0)');
  await page.screenshot({path:join(output,'workbench-simple-think-sender.png')});
  await page.locator('.conversation-region').screenshot({path:join(output,'conversation-clean.png')});
  assert.equal(await page.locator('.ant-bubble-list').count(),1);
  assert.equal(await page.locator('.is-assistant .ant-bubble-footer').count(),0,'no empty response action footer');
  assert.equal(await page.getByRole('button',{name:'复制回复',exact:true}).count(),0);
  assert.equal(await page.locator('.adx-run .anticon-loading').count(),0,'completed process has no running indicator');
 });
 await check('running conversation keeps request first and native stop in footer',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');const now=Date.now();s.setState({aiStatus:'generating',composerText:'',messages:s.getState().messages.map(m=>m.run?{...m,run:{...m.run,status:'running',startedAt:now-5000}}:m)});const {conversationController}=await import('/src/runtime/conversationController.ts');const {activeConversationStore}=await import('/src/conversationStores.ts');conversationController(activeConversationStore()).ui.setState({started:now-5000,runMessageId:'fixture-user',agentActivity:s.getState().messages[0].run.activity});});
  await page.getByRole('button',{name:/正在处理.*收起摘要/}).waitFor();
  await page.getByRole('button',{name:'停止生成',exact:true}).waitFor();
  await page.locator('.conversation-region').screenshot({path:join(output,'conversation-running.png')});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
