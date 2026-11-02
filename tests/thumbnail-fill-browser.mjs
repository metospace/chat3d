import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
const output='artifacts/thumbnail-fill';await mkdir(output,{recursive:true});
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-thumbnails-')),server:{host:'127.0.0.1',port:0,hmr:false}});
let browser,page;const report={checks:[],errors:[]};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:2010,height:1100}});page.setDefaultTimeout(30000);
 const base='http://127.0.0.1:'+server.httpServer.address().port;page.on('pageerror',error=>report.errors.push(error.stack));await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);await page.getByLabel('新项目描述',{exact:true}).waitFor();
 await page.evaluate(async()=>{
  const w=await import('/src/workspace.ts'),{useEditorStore:s}=await import('/src/store.ts'),{projectThumbnail}=await import('/src/scene/projectThumbnail.ts'),{saveLibraryProject}=await import('/src/domain/workspaceLibrary.ts');
  w.createSession(undefined,{moduleKind:'asset',title:'已保存工作台',assetCategory:'设备'});
  const part=(name,width,height,depth,position)=>({op:'createPrimitive',name,parentId:null,materialId:'mat_blue',geometry:{type:'box',params:{width,height,depth}},transform:{position,scale:[1,1,1],rotationQuaternion:[0,0,0,1]}});
  s.getState().applyCommandBatch([part('台面',1.5,.06,.7,[0,.8,0]),part('支架',.08,.8,.08,[-.6,.4,0]),part('支架',.08,.8,.08,[.6,.4,0])],'fixture');await saveLibraryProject(doc=>projectThumbnail(doc,new AbortController().signal));
  w.createSession(undefined,{moduleKind:'asset',title:'未存预览的立柱'});s.getState().applyCommandBatch([part('立柱',.4,2,.4,[0,1,0])],'fixture');
  w.createSession(undefined,{moduleKind:'asset',title:'未应用的预览'});const {applyBatch}=await import('/src/domain/commands.ts'),doc=s.getState().doc,operations=[part('待确认高杆',.2,2,.2,[0,1,0])],batch={requestId:'preview-fixture',projectId:doc.projectId,baseRevision:doc.revision,selectedIds:[],summary:'预览草稿',operations},result=applyBatch(doc,batch);s.setState({pendingBatch:batch,pendingResult:result,previewDoc:result.doc,aiStatus:'previewing'});
  w.createSession(undefined,{moduleKind:'asset',title:'空白草稿'});await w.flushWorkspace();
 });
 await page.reload();await page.getByLabel('新项目描述',{exact:true}).waitFor();
 const state=()=>page.evaluate(async()=>{const {useWorkspaceStore:w}=await import('/src/workspace.ts');return JSON.stringify({active:w.getState().activeId,sessions:w.getState().sessions});});const before=await state();
 await check('draft geometry gains a local preview without saving or switching projects',async()=>{
  const img=page.getByAltText('未存预览的立柱 几何缩略图',{exact:true});await img.waitFor();assert.ok(await img.evaluate(el=>el.complete&&el.naturalWidth>0||new Promise(resolve=>el.addEventListener('load',()=>resolve(el.naturalWidth>0),{once:true}))));await page.getByAltText('未应用的预览 几何缩略图',{exact:true}).waitFor();assert.equal(await state(),before);assert.ok(await page.locator('.project-gallery-preview').getByText('空白项目',{exact:true}).isVisible());
 });
 const filled=async(locator,frame)=>{const img=await locator.boundingBox(),box=await frame.boundingBox();assert.ok(Math.abs(img.width-box.width)<1&&Math.abs(img.height-box.height)<1);assert.ok(Math.abs(box.width/box.height-4/3)<.01);assert.equal(await locator.evaluate(el=>getComputedStyle(el).objectFit),'cover');};
 for(const width of [2010,1440,768,390])await check('home previews fill 4:3 frames at '+width,async()=>{
  await page.setViewportSize({width,height:1100});const image=page.getByAltText('已保存工作台 几何缩略图',{exact:true});await image.scrollIntoViewIfNeeded();await filled(image,image.locator('..'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(output,'home-'+width+'.png'),fullPage:true});
 });
 await page.setViewportSize({width:2010,height:1100});await page.getByRole('button',{name:'资产库',exact:true}).click();await page.getByRole('heading',{name:'资产库',exact:true}).waitFor();
 await check('library preview fills the card width with the renderer aspect ratio',async()=>{
  const image=page.locator('.resource-page').getByAltText('已保存工作台 几何缩略图',{exact:true}),tile=page.getByRole('button',{name:'查看资产 已保存工作台',exact:true});await image.waitFor();const img=await image.boundingBox(),card=await tile.boundingBox();assert.ok(Math.abs(img.width-card.width)<1);assert.ok(Math.abs(img.width/img.height-4/3)<.01);assert.equal(await image.evaluate(el=>getComputedStyle(el).objectFit),'cover');await page.screenshot({path:join(output,'library.png'),fullPage:true});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}
finally{await browser?.close();await server.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));}
