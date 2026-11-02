import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
const fixture=`
import {applyBatch} from '/src/domain/commands.ts';
export async function runModelingAgent(options){
 let activity;for(let i=0;i<40;i++){
  if(options.signal.aborted)throw new DOMException('已停止','AbortError');
  activity={title:'正在检查货架',turn:1,toolCalls:0,characters:i+1,inputTokens:0,outputTokens:0,usageReported:false,lastEventAt:Date.now(),plan:[],events:[],timings:[],explanations:[{id:'scroll-progress',text:'继续核对尺寸与结构。'.repeat((i+1)*8)}]};
  options.onActivity?.(activity);await new Promise(resolve=>setTimeout(resolve,120));
 }
 return {batch:{requestId:crypto.randomUUID(),projectId:options.document.projectId,baseRevision:options.document.revision,selectedIds:[],summary:'已完成本轮说明：'+options.text+'。\\n'+'这是最新的回答。'.repeat(24),operations:[]},result:applyBatch(options.document,{operations:[]}),activity};
}`;
const output='artifacts/chat-scroll';await mkdir(output,{recursive:true});
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-scroll-')),server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'scroll-agent-fixture',enforce:'pre',load(id){if(id.endsWith('/src/ai/modelingAgent.ts'))return fixture;}}]});
let browser,page;const report={checks:[],errors:[]};const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(25000);page.on('pageerror',error=>report.errors.push(error.stack));
 const base='http://127.0.0.1:'+server.httpServer.address().port;await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());await page.route('**/api/model/**',()=>assert.fail('scroll test must not call a model endpoint'));
 await page.goto(base);await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{activeConversationStore}=await import('/src/conversationStores.ts'),{conversationController}=await import('/src/runtime/conversationController.ts');window.scrollFixtureState=()=>({status:s.getState().aiStatus,characters:conversationController(activeConversationStore()).ui.getState().agentActivity?.characters??0});s.setState({aiConfig:{baseURL:'https://fixture.invalid/v1',apiKey:'never-sent',model:'fixture',agentMode:'pi'},messages:Array.from({length:24},(_,i)=>[{id:'user-'+i,role:'user',text:'历史要求 '+i,createdAt:Date.now()},{id:'assistant-'+i,role:'assistant',text:('历史回答 '+i+'：保留布局，检查连接和尺寸。').repeat(18),createdAt:Date.now()}]).flat()});});
 const transcript=page.locator('.adx-messages .chat-transcript'),metrics=()=>transcript.evaluate(el=>({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,direction:getComputedStyle(el).flexDirection}));
 const bottom=()=>page.waitForFunction(()=>{const el=document.querySelector('.adx-messages .chat-transcript');return el&&Math.abs(el.scrollTop)<2;});
 const readHistory=async()=>{await transcript.evaluate(el=>{el.scrollTop=-Math.min(800,el.scrollHeight-el.clientHeight);});await page.waitForFunction(()=>document.querySelector('.adx-messages .chat-transcript').scrollTop< -400);await page.waitForTimeout(80);};
 const lastVisible=async()=>{const box=await transcript.boundingBox(),last=await page.locator('.adx-bubble.is-assistant').last().boundingBox();assert.ok(last.y+last.height<=box.y+box.height+1&&last.y+last.height>box.y);};
 await check('native reversed scrolling starts at the latest answer in the workbench theme',async()=>{await bottom();const value=await metrics();assert.equal(value.direction,'column-reverse');assert.ok(value.total>value.height*4);await lastVisible();});
 await check('view latest moves downward to the actual newest message',async()=>{await readHistory();await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().addAssistantMessage('刚到达的最新消息。'.repeat(30));});await page.getByRole('button',{name:'查看最新消息 ↓',exact:true}).click();await bottom();await lastVisible();assert.equal(await page.getByRole('button',{name:'查看最新消息 ↓',exact:true}).count(),0);await page.screenshot({path:join(output,'latest-message.png')});});
 for(const turn of [1,2])await check('sending message '+turn+' returns to the bottom and follows streamed growth',async()=>{
  await readHistory();await page.getByLabel('建模指令',{exact:true}).fill('第 '+turn+' 次核对，只给出说明');await page.getByRole('button',{name:'发送',exact:true}).click();await bottom();await page.waitForFunction(()=>window.scrollFixtureState().characters>2);await bottom();
  await page.waitForTimeout(250);assert.ok(Math.abs((await metrics()).top)<2);
  if(turn===1){await readHistory();await page.waitForTimeout(400);assert.ok((await metrics()).top< -400);assert.ok(await page.getByRole('button',{name:'查看最新消息 ↓',exact:true}).isVisible());await page.getByRole('button',{name:'查看最新消息 ↓',exact:true}).click();await bottom();await readHistory();await page.getByLabel('建模指令',{exact:true}).fill('下一步核对，不自动执行');await page.getByLabel('建模指令',{exact:true}).press('Enter');await bottom();assert.ok(await page.getByRole('region',{name:'排队消息',exact:true}).isVisible());await page.getByRole('button',{name:'移出队列 下一步核对，不自动执行',exact:true}).click();}
  await page.waitForFunction(()=>window.scrollFixtureState().status==='idle');await bottom();await lastVisible();await page.screenshot({path:join(output,'sent-'+turn+'.png')});
 });
 await check('current selection is explicit and does not silently change the modification scope',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().applyCommandBatch([{op:'createPrimitive',name:'托盘货架 B3',parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}],'selection fixture');s.getState().select([s.getState().doc.nodes[0].id]);});assert.equal(await page.getByLabel('当前选中对象',{exact:true}).textContent(),'当前选中：托盘货架 B3');assert.match(await page.getByLabel('当前选中对象',{exact:true}).getAttribute('title'),/修改范围以右侧设置为准/);assert.ok(await page.locator('.instruction-context .ant-select').getByText('全场景',{exact:true}).isVisible());
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){if(page)console.log('FAILURE',await page.evaluate(()=>({state:window.scrollFixtureState?.(),top:document.querySelector('.adx-messages .chat-transcript')?.scrollTop})));if(page)await page.screenshot({path:join(output,'failure.png')});throw error;}
finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
