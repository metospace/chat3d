import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const output=resolve('artifacts/ant-design-x');await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(path=>path&&existsSync(path));
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-pro-v6-')),server:{host:'127.0.0.1',port:0,hmr:false}});
let browser,page;const report={checks:[],errors:[]};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
try{
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);
 await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',error=>report.errors.push(error.message));
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);await page.getByLabel('新项目描述',{exact:true}).waitFor();
 await check('ProLayout and PageContainer render a usable home',async()=>{
  assert.ok(await page.locator('.ant-pro-layout').count());
  const main=await page.locator('.pro-home-page').boundingBox();assert.ok(main.width>900);
  await page.getByLabel('新项目描述',{exact:true}).fill('保留这个首页输入');
  await page.screenshot({path:join(output,'pro-v6-home-empty.png'),fullPage:true});
 });
 await page.evaluate(async()=>{
  const w=await import('/src/workspace.ts'),{useEditorStore:s}=await import('/src/store.ts');
  w.createSession(undefined,{moduleKind:'asset',title:'金属工作台',assetCategory:'设备'});
  s.getState().applyCommandBatch([{op:'createPrimitive',name:'工作台面',parentId:null,geometry:{type:'box',params:{width:1.5,height:.04,depth:.7}},transform:{position:[0,.8,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_white'}],'UI fixture');
  const {saveLibraryProject}=await import('/src/domain/workspaceLibrary.ts');await saveLibraryProject();
  w.createSession(undefined,{moduleKind:'scene',title:'装配车间布局'});await w.flushWorkspace();
 });
 await check('recent ProList opens a project without losing home draft',async()=>{
  await page.getByRole('button',{name:'继续编辑 金属工作台',exact:true}).waitFor();
  await page.screenshot({path:join(output,'pro-v6-home.png'),fullPage:true});
  await page.getByRole('button',{name:'资产库',exact:true}).click();
  await page.getByRole('heading',{name:'资产库',exact:true}).waitFor();
 });
 await check('resource grid, ProTable and ProForm preserve saved geometry',async()=>{
  await page.getByRole('button',{name:'查看资产 金属工作台',exact:true}).waitFor();
  await page.screenshot({path:join(output,'pro-v6-assets-grid.png'),fullPage:true});
  await page.getByRole('button',{name:'列表视图',exact:true}).click();assert.ok(await page.locator('.ant-pro-table').count());
  await page.screenshot({path:join(output,'pro-v6-assets-table.png'),fullPage:true});
  await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('menuitem',{name:'编辑信息',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'编辑资产信息',exact:true});await dialog.getByLabel('资产名称',{exact:true}).fill('工业工作台');
  await dialog.getByLabel('库内容说明',{exact:true}).fill('Pro v6 表单验证');
  await page.screenshot({path:join(output,'pro-v6-metadata.png')});
  await dialog.getByRole('button',{name:'保存信息',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(async()=>{const {listModelAssets,readModelAsset}=await import('/src/domain/modelAssetStorage.ts');const a=(await listModelAssets())[0];return (await readModelAsset(a.id,a.version)).nodes.length;}),1);
 });
 await check('scene library and task table remain reachable',async()=>{
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.locator('.resource-inspector-drawer.ant-drawer-open').waitFor({state:'hidden'});await page.getByRole('button',{name:'场景库',exact:true}).click();await page.getByRole('heading',{name:'场景库',exact:true}).waitFor();
  await page.getByRole('button',{name:'任务记录',exact:true}).click();await page.getByRole('heading',{name:'任务中心',exact:true}).waitFor();
  assert.ok(await page.locator('.ant-pro-table').count());await page.screenshot({path:join(output,'pro-v6-tasks.png'),fullPage:true});
 });
 await check('settings uses native tabs and update settings',async()=>{
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'通用',exact:true}).waitFor();
  await page.screenshot({path:join(output,'pro-v6-settings.png'),fullPage:true});
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();assert.ok(await page.getByRole('button',{name:'管理项目备份',exact:true}).isVisible());
  await page.getByRole('tab',{name:'关于',exact:true}).click();
 });
 await page.getByRole('button',{name:'首页',exact:true}).click();
 await check('home input survives navigation and native themes work',async()=>{
  assert.equal(await page.getByLabel('新项目描述',{exact:true}).inputValue(),'保留这个首页输入');
  await page.evaluate(()=>{localStorage.setItem('chat3d.appearance.v1','dark');dispatchEvent(new StorageEvent('storage',{key:'chat3d.appearance.v1',newValue:'dark'}));});
  await page.waitForFunction(()=>document.documentElement.dataset.appearance==='dark');await page.screenshot({path:join(output,'pro-v6-home-dark.png'),fullPage:true});
 });
 for(const width of [1280,1024,768,390])await check('manager content stays visible at '+width,async()=>{
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const box=await page.getByLabel('新项目描述',{exact:true}).boundingBox();assert.ok(box.width>180&&box.x>=0&&box.x+box.width<=width+1);
  await page.screenshot({path:join(output,`pro-v6-home-${width}.png`),fullPage:true});
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){if(page)await page.screenshot({path:join(output,'pro-v6-manager-failure.png'),fullPage:true});throw error;}
finally{await browser?.close();await server.close();await writeFile(join(output,'pro-v6-report.json'),JSON.stringify(report,null,2));}
