// Cloud/local Chromium smoke, no model calls. Start Vite; override BASE/CHROME as needed.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.BASE??'http://127.0.0.1:1425';
const browser=await chromium.launch({executablePath:process.env.CHROME??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:false})}));
 await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'建模工作台',exact:true}).waitFor();
 await page.evaluate(async()=>{
  const {createInitialDoc}=await import('/src/store.ts');const {applyBatch}=await import('/src/domain/commands.ts');const workspace=await import('/src/workspace.ts');await workspace.initializeWorkspace();
  const part=(name,x)=>({name,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_blue',transform:{position:[x,.5,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
  const r=applyBatch(createInitialDoc(),{operations:[{op:'createAssembly',name:'待删除机组',parts:[part('主体',-1),part('附件',1)]},{op:'createAssembly',name:'保留模型',parts:[part('箱体',4)]}]});if(r.errors.length)throw r.errors[0];workspace.createSession(r.doc);
 });
 await page.getByRole('button',{name:'建模工作台',exact:true}).click();await page.getByRole('button',{name:'结构',exact:true}).click();
 await page.getByRole('button',{name:'选择组件 待删除机组',exact:true}).click();
 const state=()=>page.evaluate(async()=>{const s=(await import('/src/store.ts')).useEditorStore.getState();return {count:s.doc.nodes.length,selection:s.selection.length,history:s.past.length,status:s.viewportStatus,names:s.doc.nodes.map(n=>n.name)};});
 assert.equal((await state()).selection,2);
 const deleteButton=page.getByRole('button',{name:'删除选中对象',exact:true});await deleteButton.hover();assert.match(await deleteButton.locator('..').getAttribute('title'),/可撤销恢复/);
 await deleteButton.click();assert.equal((await state()).count,1);assert.equal((await state()).selection,0);assert.match((await state()).names[0],/保留模型/);
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal((await state()).count,3);await page.getByRole('button',{name:'重做',exact:true}).click();assert.equal((await state()).count,1);await page.getByRole('button',{name:'撤销',exact:true}).click();
 console.log('PASS browser button deletes entire selected assembly; undo / redo exactly restores it');
 await page.getByRole('button',{name:'选择组件 待删除机组',exact:true}).click();const search=page.getByLabel('搜索场景组件');await search.fill('');await search.focus();await page.keyboard.press('Delete');assert.equal((await state()).count,3);const input=page.getByLabel('建模描述');await input.fill('文字编辑');await page.keyboard.press('Home');await page.keyboard.press('Delete');assert.equal((await state()).count,3);assert.equal(await input.inputValue(),'字编辑');
 await page.getByRole('button',{name:'选择组件 待删除机组',exact:true}).click();await page.getByRole('button',{name:'保留模型 · 箱体',exact:true}).click({modifiers:['Control']});assert.equal((await state()).selection,3);await page.keyboard.press('Delete');assert.equal((await state()).count,0);await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal((await state()).count,3);
 console.log('PASS browser Ctrl multi-selection and Delete; text fields keep scene intact');
 await page.getByRole('button',{name:'选择组件 待删除机组',exact:true}).click();await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({aiStatus:'generating'});});await page.keyboard.press('Delete');assert.equal((await state()).count,3);assert.equal(await deleteButton.isDisabled(),true);await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({aiStatus:'idle'});});
 await page.getByRole('button',{name:'资产库',exact:true}).first().click();await page.keyboard.press('Delete');assert.equal((await state()).count,3);await page.getByRole('button',{name:'建模工作台',exact:true}).click();
 await page.screenshot({path:'/tmp/chat3d-scene-deletion-browser.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS browser task lock and non-workbench navigation prevent deletion');console.log('Renderer status: '+(await state()).status);console.log('Screenshot: /tmp/chat3d-scene-deletion-browser.png');
}finally{await browser.close()}
