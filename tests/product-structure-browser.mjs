import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
const output='artifacts/product-structure';await mkdir(output,{recursive:true});
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-structure-')),server:{host:'127.0.0.1',port:0,hmr:false}});
let browser,page;const report={checks:[],errors:[]};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHAT3D_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(25000);
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 page.on('pageerror',error=>report.errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);await page.getByRole('heading',{name:'项目工作台',exact:true}).waitFor();
 await check('project hub separates the project library and three creation methods',async()=>{
  const library=await page.getByRole('region',{name:'本地项目',exact:true}).boundingBox(),create=await page.getByRole('complementary',{name:'创建新项目',exact:true}).boundingBox();assert.ok(library.x+library.width<=create.x);
  await page.getByLabel('新项目描述',{exact:true}).fill('保留我的创作输入');
  await page.getByRole('radiogroup',{name:'创建方式',exact:true}).getByText('空白项目',{exact:true}).click();assert.ok(await page.getByRole('button',{name:'创建空白资产',exact:true}).isVisible());
  await page.getByRole('radiogroup',{name:'创建方式',exact:true}).getByText('导入 GLB',{exact:true}).click();assert.ok(await page.getByRole('button',{name:'选择 GLB 文件',exact:true}).isVisible());
  await page.getByRole('radiogroup',{name:'创建方式',exact:true}).getByText('AI 生成',{exact:true}).click();assert.equal(await page.getByLabel('新项目描述',{exact:true}).inputValue(),'保留我的创作输入');
  await page.screenshot({path:join(output,'project-hub.png')});
 });
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.getByLabel('建模指令',{exact:true}).fill('只修改已选层板的高度');
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().applyCommandBatch([{op:'createPrimitive',name:'货架层板',parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width:2,height:.08,depth:.6}},transform:{position:[0,1,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}],'fixture');s.getState().select([s.getState().doc.nodes[0].id]);});
 await page.getByRole('button',{name:'属性',exact:true}).click();
 await check('editor uses centered horizontal scene tools and independent inspector and assistant',async()=>{
  const tools=await page.getByRole('group',{name:'场景编辑工具',exact:true}).boundingBox(),inspector=await page.getByRole('region',{name:'选中对象属性',exact:true}).boundingBox(),canvas=await page.locator('.scene-region').boundingBox(),chat=await page.getByRole('complementary',{name:'AI 助手',exact:true}).boundingBox();
  assert.ok(tools.width>tools.height&&tools.height<=48);assert.ok(Math.abs(tools.x+tools.width/2-canvas.x-canvas.width/2)<=1);assert.ok(tools.y>=canvas.y&&tools.y-canvas.y<=16);assert.ok(inspector.x+inspector.width<=canvas.x+1);assert.ok(canvas.x+canvas.width<=chat.x+1);assert.ok(canvas.width>=400);
  assert.equal(await page.getByRole('tablist',{name:'助手工作区'}).count(),0);assert.ok(await page.getByRole('combobox',{name:'对话修改范围',exact:true}).isVisible());
  await page.screenshot({path:join(output,'workbench.png')});
 });
 await check('scope and placement locking share one dropdown without a duplicate constraint button',async()=>{
  assert.equal(await page.getByRole('button',{name:'修改范围与参考',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'参考附件设置',exact:true}).count(),0);const select=page.getByRole('combobox',{name:'对话修改范围',exact:true});assert.equal(await select.count(),1);await select.click();const lock=page.getByRole('checkbox',{name:'锁定已有对象的位置与朝向',exact:true});await lock.check();assert.ok(await page.getByText('已锁定位置与朝向',{exact:true}).isVisible());await page.waitForTimeout(250);await page.screenshot({path:join(output,'unified-scope.png')});await lock.uncheck();await select.press('Escape');assert.equal(await page.getByLabel('建模指令',{exact:true}).inputValue(),'只修改已选层板的高度');
 });
 await check('canvas toolbar stays centered when the inspector and assistant change width',async()=>{
  const centered=async()=>{const c=await page.locator('.scene-region').boundingBox(),t=await page.getByRole('group',{name:'场景编辑工具',exact:true}).boundingBox();assert.ok(Math.abs(t.x+t.width/2-c.x-c.width/2)<=1);assert.ok(t.y-c.y<=16);};
  await page.getByRole('button',{name:'关闭属性面板',exact:true}).click();await centered();await page.getByRole('button',{name:'收起对话区',exact:true}).click();await centered();await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();await page.getByRole('button',{name:'属性',exact:true}).click();await centered();
 });
 await check('task details open separately and preserve the composer and inspector',async()=>{
  await page.getByRole('button',{name:'本项目任务记录',exact:true}).click();await page.getByRole('dialog',{name:'本项目任务记录',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'本项目任务记录',exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByLabel('建模指令',{exact:true}).inputValue(),'只修改已选层板的高度');assert.ok(await page.getByRole('region',{name:'选中对象属性',exact:true}).isVisible());
 });
 await check('queued messages own the inline guidance, delete and more actions',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{conversationController}=await import('/src/runtime/conversationController.ts'),{activeConversationStore}=await import('/src/conversationStores.ts');s.setState({aiStatus:'generating',messages:[{id:'queued-ui',role:'user',text:'再优化下',createdAt:Date.now(),queuedTask:{status:'waiting'}}]});conversationController(activeConversationStore()).ui.setState({canSteer:true,started:Date.now()});});
  assert.equal(await page.getByRole('radiogroup',{name:'生成期间发送方式'}).count(),0);
  const queue=page.getByRole('region',{name:'排队消息'});assert.ok(await queue.getByRole('button',{name:'引导',exact:true}).isVisible());
  await queue.getByRole('button',{name:'消息选项 再优化下',exact:true}).click();await page.getByRole('menuitem',{name:'编辑消息',exact:true}).waitFor();await page.waitForTimeout(220);await page.screenshot({path:join(output,'queued-message-menu.png')});await page.locator('.adx-composer-surface').screenshot({path:join(output,'queued-message-inline.png')});await page.keyboard.press('Escape');
  await queue.getByRole('button',{name:'移出队列 再优化下',exact:true}).click();await queue.waitFor({state:'hidden'});await page.getByRole('button',{name:'撤销移除',exact:true}).click();await queue.waitFor();
  assert.equal(await page.getByLabel('建模指令',{exact:true}).inputValue(),'只修改已选层板的高度');
 });
 await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{applyBatch}=await import('/src/domain/commands.ts');const doc=s.getState().doc,operations=[{op:'rename',targetId:doc.nodes[0].id,name:'调整后的货架层板'}],batch={requestId:'review',projectId:doc.projectId,baseRevision:doc.revision,selectedIds:[],summary:'已调整层板名称',qualityIssues:['调整后的货架层板外形与参考图不同','表面材质仍待核对','警示文字不清晰','表面材质仍待核对'],operations},result=applyBatch(doc,{operations});s.setState({aiStatus:'previewing',pendingBatch:batch,pendingResult:result,previewDoc:result.doc});});
 await check('compact preview opens actionable checks without expanding over the canvas',async()=>{
  const card=page.getByRole('region',{name:'预览确认',exact:true});assert.ok((await card.boundingBox()).height<190);assert.equal(await card.getByText('表面材质仍待核对',{exact:true}).count(),0);
  await card.getByRole('button',{name:'待核对项 · 3',exact:true}).click();const drawer=page.getByRole('dialog',{name:'本次修改检查',exact:true});await drawer.waitFor();
  assert.ok(await drawer.getByText('外形与比例',{exact:true}).isVisible());assert.ok(await drawer.getByText('材质与表面',{exact:true}).isVisible());assert.equal(await drawer.getByText('已报告差异',{exact:true}).count(),2);assert.equal(await drawer.getByText('需复核',{exact:true}).count(),1);assert.equal(await drawer.getByText('表面材质仍待核对',{exact:true}).count(),1);
  assert.equal(await page.locator('.preview-review-drawer .ant-drawer-mask').count(),0);await page.waitForTimeout(350);const drawerBox=await drawer.boundingBox();assert.ok(drawerBox.x>=0&&drawerBox.x+drawerBox.width<=1441);await page.screenshot({path:join(output,'preview-checks.png')});
  await drawer.getByRole('button',{name:'生成核对指令',exact:true}).click();await drawer.waitFor({state:'hidden'});assert.equal(await page.getByLabel('建模指令',{exact:true}).inputValue(),'只修改已选层板的高度');assert.ok(await page.getByText('输入框已有内容，请先处理当前草稿，再生成核对指令',{exact:true}).isVisible());
  await page.getByLabel('建模指令',{exact:true}).fill('');await card.getByRole('button',{name:'待核对项 · 3',exact:true}).click();await drawer.getByRole('button',{name:'定位相关组件',exact:true}).click();await drawer.waitFor({state:'hidden'});
  const state=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return {selected:s.getState().selection,pending:s.getState().pendingResult.doc.nodes[0].id,name:s.getState().doc.nodes[0].name};});assert.deepEqual(state.selected,[state.pending]);assert.equal(state.name,'货架层板');
  await card.getByRole('button',{name:'待核对项 · 3',exact:true}).click();await drawer.getByRole('button',{name:'生成核对指令',exact:true}).click();await drawer.waitFor({state:'hidden'});const draft=await page.getByLabel('建模指令',{exact:true}).inputValue();assert.match(draft,/1. 调整后的货架层板外形与参考图不同/);assert.match(draft,/证据不足/);assert.match(draft,/3. 警示文字不清晰/);
  assert.equal(await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return s.getState().aiStatus;}),'previewing');await page.screenshot({path:join(output,'preview-prepared-check.png')});
 });
 await check('preview card and inspection drawer remain within a narrow window',async()=>{
  await page.setViewportSize({width:390,height:960});await page.waitForTimeout(250);const card=page.getByRole('region',{name:'预览确认',exact:true});const box=await card.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);assert.ok(await card.getByRole('button',{name:'应用修改',exact:true}).isVisible());
  await card.getByRole('button',{name:'待核对项 · 3',exact:true}).click();const drawer=page.getByRole('dialog',{name:'本次修改检查',exact:true});await page.waitForTimeout(350);const d=await drawer.boundingBox();assert.ok(d.x>=0&&d.x+d.width<=391);assert.ok(await drawer.getByRole('button',{name:'生成核对指令',exact:true}).isVisible());await page.screenshot({path:join(output,'preview-checks-390.png')});await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});await page.setViewportSize({width:1440,height:960});await page.waitForTimeout(200);
 });
 await check('review belongs to the canvas and confirmation commits a reversible change',async()=>{
  assert.ok(await page.locator('.scene-region .workbench-review-slot').getByRole('region',{name:'预览确认',exact:true}).isVisible());assert.equal(await page.locator('.conversation-region .decision-review').count(),0);
  await page.screenshot({path:join(output,'preview-decision.png')});await page.getByRole('button',{name:'应用修改',exact:true}).click();
  const value=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');const applied=s.getState().doc.nodes[0].name;s.getState().undo();return {applied,undone:s.getState().doc.nodes[0].name};});assert.equal(value.applied,'调整后的货架层板');assert.equal(value.undone,'货架层板');
 });
 for(const width of [1280,1024,768,390])await check('editor regions stay within the viewport at '+width,async()=>{
  await page.setViewportSize({width,height:960});await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const canvas=await page.locator('.scene-region').boundingBox(),tools=await page.getByRole('group',{name:'场景编辑工具',exact:true}).boundingBox();assert.ok(canvas.y>=55);assert.ok(tools.x>=canvas.x&&tools.x+tools.width<=canvas.x+canvas.width+1);assert.ok(Math.abs(tools.x+tools.width/2-canvas.x-canvas.width/2)<=1);assert.ok(await page.getByRole('button',{name:'浏览场景',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===top||el.contains(top);}));
  const chat=await page.getByRole('complementary',{name:'AI 助手',exact:true}).boundingBox(),inspector=await page.getByRole('region',{name:'选中对象属性',exact:true}).boundingBox();assert.ok(chat.x+chat.width<=width+1);assert.ok(inspector.x+inspector.width<=chat.x+1||inspector.y+inspector.height<=chat.y+1);await page.screenshot({path:join(output,'workbench-'+width+'.png')});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){if(page)await page.screenshot({path:join(output,'failure.png')});throw error;}
finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
