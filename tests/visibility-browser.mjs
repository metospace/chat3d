import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-visibility-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false}});let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHAT3D_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(30000);
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port);await page.getByLabel('新项目描述',{exact:true}).waitFor();await page.getByRole('button',{name:'新建项目',exact:true}).click();await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();await page.getByLabel('建模描述',{exact:true}).waitFor();
 await page.evaluate(async()=>{
  const {Viewport}=await import('/src/scene/Viewport.ts');const original=Viewport.prototype.sync;Viewport.prototype.sync=function(doc){window.visibilityViewport=this;return original.call(this,doc);};
  const {useEditorStore:s}=await import('/src/store.ts');
  const created=s.getState().applyCommandBatch([
   {op:'createPrimitive',name:'屏幕底板',geometry:{type:'box',params:{width:1,height:.8,depth:.08}},materialId:'mat_dark',transform:{position:[0,.8,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}},
   {op:'createPrimitive',name:'烟灰触控玻璃',geometry:{type:'box',params:{width:.92,height:.72,depth:.025}},materialId:'mat_cyan',transform:{position:[0,.8,.055],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}
  ],'双层触控屏');if(!created.ok)throw Error(created.error);
  const state=s.getState();state.select([state.doc.nodes[1].id]);
 });
 const tree=page.locator('.object-tree'),canvas=page.locator('.viewport-host canvas').first();
 await tree.getByRole('button',{name:'隐藏 烟灰触控玻璃',exact:true}).waitFor();
 const snapshot=()=>page.evaluate(async()=>{const {useEditorStore:s}=await import('/src/store.ts');const vp=window.visibilityViewport;return {nodes:s.getState().doc.nodes.map(n=>({id:n.id,name:n.name,visible:n.visible})),rendered:[...vp.nodeMap.keys()],camera:vp.camera.position.toArray(),past:s.getState().past.length};});
 const before=await snapshot();await page.evaluate(()=>window.visibilityViewport.render());await mkdir('artifacts/visibility',{recursive:true});await page.screenshot({path:'artifacts/visibility/before.png'});const pixelsBefore=await canvas.screenshot();
 await tree.getByRole('button',{name:'隐藏 烟灰触控玻璃',exact:true}).click();await tree.getByRole('button',{name:'显示 烟灰触控玻璃',exact:true}).waitFor();
 const hiddenRow=tree.getByRole('button',{name:'显示 烟灰触控玻璃',exact:true}).locator('..');assert.ok(await hiddenRow.getByText('已隐藏',{exact:true}).isVisible());assert.equal(await hiddenRow.getByRole('button',{name:'显示 烟灰触控玻璃',exact:true}).getAttribute('aria-pressed'),'true');
 const hidden=await snapshot();assert.equal(hidden.nodes[1].visible,false);assert.equal(hidden.nodes[0].visible,true);assert.equal(hidden.rendered.includes(before.nodes[1].id),false);assert.equal(hidden.rendered.includes(before.nodes[0].id),true);assert.deepEqual(hidden.camera,before.camera);assert.equal(hidden.past,before.past+1);
 await page.evaluate(()=>window.visibilityViewport.render());const pixelsHidden=await canvas.screenshot();assert.notDeepEqual(pixelsHidden,pixelsBefore);await page.screenshot({path:'artifacts/visibility/hidden.png'});
 await tree.getByRole('button',{name:'显示 烟灰触控玻璃',exact:true}).click();await tree.getByRole('button',{name:'隐藏 烟灰触控玻璃',exact:true}).waitFor();const shown=await snapshot();assert.equal(shown.nodes[1].visible,true);assert.equal(shown.rendered.includes(before.nodes[1].id),true);
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal((await snapshot()).nodes[1].visible,false);await page.getByRole('button',{name:'重做',exact:true}).click();assert.equal((await snapshot()).nodes[1].visible,true);
 console.log('PASS actual eye controls remove/recreate selected layer in rendered scene, preserve backing and camera, change pixels, and undo/redo visibility');
}finally{await browser?.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}
