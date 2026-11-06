import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
const output='artifacts/asset-drag';await mkdir(output,{recursive:true});
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-asset-drag-')),server:{host:'127.0.0.1',port:0,hmr:false}});
let browser,page;const report={checks:[],errors:[]};const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(25000);
 const base='http://127.0.0.1:'+server.httpServer.address().port;page.on('pageerror',error=>report.errors.push(error.stack));await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);await page.getByLabel('新项目描述',{exact:true}).waitFor();
 const fixture=await page.evaluate(async()=>{
  const {createInitialDoc}=await import('/src/store.ts'),{applyBatch}=await import('/src/domain/commands.ts'),{createModelAsset}=await import('/src/domain/modelAssets.ts'),storage=await import('/src/domain/modelAssetStorage.ts'),{saveLibraryCategory}=await import('/src/domain/libraryCategories.ts');
  const parent=await saveLibraryCategory('拖放分类'),child=await saveLibraryCategory('工位子类',undefined,{parentValue:parent.value});const part=(name,width,height,depth,position)=>({op:'createPrimitive',name,parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width,height,depth}},transform:{position,scale:[1,1,1],rotationQuaternion:[0,0,0,1]}});
  const doc=applyBatch(createInitialDoc(),{operations:[part('台面',1.5,.1,.7,[0,.8,0]),part('底座',1.2,.15,.6,[0,.075,0])]}).doc;
  const asset=createModelAsset(doc,doc.nodes.map(node=>node.id),{name:'拖放工作台',category:child.value});await storage.saveModelAsset(asset,0);await storage.saveModelAsset(createModelAsset(doc,doc.nodes.map(node=>node.id),{name:'筛选对照资产',category:'设备'}),0);return {id:asset.id,version:asset.version,original:JSON.stringify(asset)};
 });
 await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.evaluate(async()=>{const {createSession}=await import('/src/workspace.ts');createSession(undefined,{moduleKind:'scene',title:'拖放场景'});});
 await page.getByRole('button',{name:'资产',exact:true}).click();const shelf=page.getByRole('region',{name:'画布资产架',exact:true}),card=shelf.getByRole('button',{name:'选择资产 拖放工作台',exact:true});await card.waitFor();
 await page.waitForFunction(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return s.getState().viewportStatus==='ready';});
 const state=()=>page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return {doc:s.getState().doc,selection:s.getState().selection,past:s.getState().past.length};});
 const emptyCanvas=page.getByRole('region',{name:'空画布',exact:true});
 await check('hierarchical categories and search filter the shelf together',async()=>{
  await shelf.getByRole('button',{name:'画布资产分类',exact:true}).click();await page.getByRole('menuitemradio',{name:'拖放分类',exact:true}).click();assert.ok(await card.isVisible());assert.equal(await shelf.getByRole('button',{name:'选择资产 筛选对照资产',exact:true}).count(),0);
  await shelf.getByLabel('搜索画布资产',{exact:true}).fill('不存在');assert.ok(await shelf.getByText('当前分类没有匹配的资产。',{exact:true}).isVisible());await shelf.getByLabel('搜索画布资产',{exact:true}).fill('工作台');assert.ok(await card.isVisible());assert.equal(await shelf.getByRole('button',{name:/放置 v/}).count(),0);const panel=await shelf.boundingBox(),footer=await shelf.locator('footer').boundingBox();assert.ok(Math.abs(footer.y+footer.height-panel.y-panel.height)<2);await page.screenshot({path:join(output,'filtered-shelf.png')});
 });
 await check('pointer placement hides empty guidance and cancellation restores it only on an empty scene',async()=>{
  await emptyCanvas.waitFor();await card.press('Enter');const hint=page.locator('.manual-placement-hint');await hint.waitFor();await emptyCanvas.waitFor({state:'hidden'});assert.equal((await state()).doc.nodes.length,0);await page.screenshot({path:join(output,'pointer-preview.png')});await hint.getByRole('button',{name:'取消',exact:true}).click();await hint.waitFor({state:'hidden'});await emptyCanvas.waitFor();assert.equal((await state()).doc.nodes.length,0);await page.getByRole('button',{name:'资产',exact:true}).click();await card.waitFor();
 });
 await check('pointer confirmation commits on the canvas without the empty overlay intercepting clicks',async()=>{
  await card.press('Enter');await page.locator('.manual-placement-hint').waitFor();const canvas=await page.locator('.scene-region .viewport-host canvas').first().boundingBox();await page.mouse.move(canvas.x+canvas.width*.65,canvas.y+canvas.height*.65);await page.mouse.click(canvas.x+canvas.width*.65,canvas.y+canvas.height*.65);await page.waitForFunction(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return s.getState().doc.nodes.length===2;});await emptyCanvas.waitFor({state:'hidden'});await page.locator('.manual-placement-hint').waitFor({state:'hidden'});await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().undo();});await emptyCanvas.waitFor();await page.getByRole('button',{name:'资产',exact:true}).click();await card.waitFor();
 });
 const dragToCanvas=async(x=.68,y=.66)=>{const source=await card.boundingBox(),canvas=await page.locator('.scene-region .viewport-host canvas').first().boundingBox();await page.mouse.move(source.x+source.width/2,source.y+30);await page.mouse.down();await page.mouse.move(source.x+source.width/2+12,source.y+32,{steps:4});await page.mouse.move(canvas.x+canvas.width*x,canvas.y+canvas.height*y,{steps:12});await page.mouse.move(canvas.x+canvas.width*x+1,canvas.y+canvas.height*y+1);};
 await check('native drag displays a scene ghost before any document mutation',async()=>{
  await dragToCanvas();await page.waitForFunction(async()=>{const {useLibraryAssetDrag:s}=await import('/src/ui/libraryAssetDrag.tsx');return s.getState().drag?.hovering;});assert.equal((await state()).doc.nodes.length,0);await emptyCanvas.waitFor({state:'hidden'});await page.locator('.asset-drop-hint').waitFor();await page.screenshot({path:join(output,'drag-ghost.png')});
 });
 await check('release places the complete pinned asset at the projected ground point',async()=>{
  await page.mouse.up();await page.waitForFunction(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return s.getState().doc.nodes.length===2;});const value=await state();assert.equal(value.selection.length,2);assert.equal(value.past,1);assert.equal(new Set(value.doc.nodes.map(node=>node.modelAsset.instanceId)).size,1);assert.ok(value.doc.nodes.every(node=>node.modelAsset.version===fixture.version));const {x,z,minY}=await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts'),{assemblyBounds}=await import('/src/domain/assemblyEditing.ts');const b=assemblyBounds(s.getState().doc.nodes);return {x:(b.min.x+b.max.x)/2,z:(b.min.z+b.max.z)/2,minY:b.min.y};});assert.equal(minY,0);assert.ok(Math.abs(x)+Math.abs(z)>.1);assert.ok(Math.abs(x/.25-Math.round(x/.25))<1e-6&&Math.abs(z/.25-Math.round(z/.25))<1e-6);await page.screenshot({path:join(output,'placed.png')});
 });
 await check('Escape and releasing outside the canvas leave the scene unchanged',async()=>{
  const before=JSON.stringify((await state()).doc);await dragToCanvas(.5,.7);await page.keyboard.press('Escape');await page.mouse.up();assert.equal(JSON.stringify((await state()).doc),before);assert.equal(await page.locator('.scene-region .viewport-host canvas').first().evaluate(el=>el.style.cursor),'');
  const source=await card.boundingBox();await page.mouse.move(source.x+25,source.y+30);await page.mouse.down();await page.mouse.move(source.x+35,source.y+40,{steps:4});await page.mouse.move(25,400,{steps:8});await page.mouse.up();assert.equal(JSON.stringify((await state()).doc),before);await page.waitForFunction(async()=>{const {useLibraryAssetDrag:s}=await import('/src/ui/libraryAssetDrag.tsx');return s.getState().drag===null;});
 });
 await check('a second native drop is independent and each whole instance can be undone',async()=>{
  await dragToCanvas(.38,.7);await page.mouse.up();await page.waitForFunction(async()=>{const {useEditorStore:s}=await import('/src/store.ts');return s.getState().doc.nodes.length===4;});const value=await state();assert.equal(new Set(value.doc.nodes.map(node=>node.modelAsset.instanceId)).size,2);await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().undo();});assert.equal((await state()).doc.nodes.length,2);await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.getState().redo();});assert.equal((await state()).doc.nodes.length,4);
 });
 await check('generation locks dragging and source library geometry remains unchanged',async()=>{
  await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({aiStatus:'generating'});});assert.ok(await card.isDisabled());assert.equal(await card.getAttribute('draggable'),'false');await page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');s.setState({aiStatus:'idle'});});const original=await page.evaluate(async id=>{const {readModelAsset}=await import('/src/domain/modelAssetStorage.ts');return JSON.stringify(await readModelAsset(id,1));},fixture.id);assert.equal(original,fixture.original);
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){if(page)await page.screenshot({path:join(output,'failure.png')});throw error;}
finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
