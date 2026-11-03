import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const output=resolve('artifacts/ant-design-x');await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium'].find(path=>path&&existsSync(path));
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-panels-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false}});
let browser,page;const report={checks:[],errors:[]};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
try {
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
 await page.emulateMedia({reducedMotion:'reduce'});
 const settlePopups=()=>page.waitForFunction(()=>[...document.querySelectorAll('.ant-popover,.ant-select-dropdown')].every(el=>el.getAnimations({subtree:true}).every(animation=>animation.playState!=='running')));
 page.on('pageerror',error=>report.errors.push(error.message));
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base);await page.getByRole('button',{name:'新建项目',exact:true}).click();
 await page.getByRole('menuitem',{name:'新建空白资产',exact:true}).click();
 await page.getByLabel('建模描述',{exact:true}).fill('保留货架结构，只调整层板高度');
 await page.evaluate(async()=>{
  const {useEditorStore:s}=await import('/src/store.ts');
  const {applyBatch}=await import('/src/domain/commands.ts');
  const part=(name,size,position,materialId)=>({op:'createPrimitive',name,parentId:null,materialId,geometry:{type:'box',params:{width:size[0],height:size[1],depth:size[2]}},transform:{position,rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
  const operations=[];
  for(const x of [-.95,.95])for(const z of [-.25,.25])operations.push(part('蓝色立柱',[.08,2,.08],[x,1,z],'mat_blue'));
  for(const y of [.15,.7,1.25,1.8])operations.push(part('层板',[2,.06,.6],[0,y,0],'mat_white'));
  const doc=applyBatch(s.getState().doc,{operations}).doc;
  s.setState({doc,selection:[doc.nodes[4].id],aiConfig:{baseURL:'https://fixture.invalid/v1',apiKey:'never-used',model:'UI fixture',agentMode:'single'},messages:[{id:'u',role:'user',text:'创建四层仓储货架，蓝色立柱。',createdAt:Date.now()-1000},{id:'a',role:'assistant',text:'货架已创建。选中层板后，可以在左侧编辑位置，也可以继续告诉我调整要求。',createdAt:Date.now()}]});
 });
 await page.getByRole('button',{name:'属性',exact:true}).click();
 const inspector=page.getByRole('region',{name:'选中对象属性'}),assistant=page.getByRole('complementary',{name:'AI 助手',exact:true});
 await check('properties and assistant have independent headers and editable drafts',async()=>{
  assert.equal(await inspector.isVisible(),true);assert.equal(await assistant.isVisible(),true);
  assert.equal(await page.getByRole('radiogroup',{name:'右侧工作区'}).count(),0);
  await page.getByRole('spinbutton',{name:'画布位移 X',exact:true}).fill('0.2');
  await page.getByRole('button',{name:'收起对话区',exact:true}).click();assert.equal(await inspector.isVisible(),true);
  await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();assert.equal(await inspector.isVisible(),true);
  assert.equal(await page.getByRole('spinbutton',{name:'画布位移 X',exact:true}).inputValue(),'0.2');
  assert.equal(await page.getByLabel('建模描述',{exact:true}).inputValue(),'保留货架结构，只调整层板高度');
 });
 for(const theme of ['light','dark'])await check('control focus and native select in '+theme,async()=>{
  await page.evaluate(theme=>{localStorage.setItem('chat3d.appearance.v1',theme);window.dispatchEvent(new StorageEvent('storage',{key:'chat3d.appearance.v1',newValue:theme}));},theme);
  const number=page.getByRole('spinbutton',{name:'画布位移 X',exact:true});await number.focus();
  assert.equal(await number.evaluate(el=>getComputedStyle(el).borderWidth),'0px','only the InputNumber wrapper draws a border');
  await page.screenshot({path:join(output,'controls-focus-'+theme+'.png')});
  const select=page.getByRole('combobox',{name:'对话修改范围',exact:true});await select.click();
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').waitFor();
  const bounds=await page.locator('.instruction-context .ant-select').boundingBox();assert.ok(bounds.height>=30&&bounds.height<=34);
  await settlePopups();await page.screenshot({path:join(output,'controls-select-'+theme+'.png')});
  await select.press('Escape');await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'切换视角',exact:true}).click();
  await page.getByRole('menu',{name:'视角',exact:true}).waitFor();await settlePopups();await page.screenshot({path:join(output,'controls-menu-'+theme+'.png')});
  await page.getByRole('button',{name:'切换视角',exact:true}).click();await page.getByRole('menu',{name:'视角',exact:true}).waitFor({state:'hidden'});
 });
 await page.evaluate(()=>{localStorage.setItem('chat3d.appearance.v1','light');window.dispatchEvent(new StorageEvent('storage',{key:'chat3d.appearance.v1',newValue:'light'}));});
 for(const width of [1440,1280,1024,768,390])await check(`independent panels at ${width}px do not overlap`,async()=>{
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const properties=await inspector.boundingBox(),chat=await assistant.boundingBox();
  assert.ok(properties&&chat);assert.ok(properties.x+properties.width<=chat.x+1||properties.y+properties.height<=chat.y+1,'panels overlap');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width>=1024){const scene=await page.locator('.scene-region').boundingBox();assert.ok(scene.width>=300,'canvas retains useful width');assert.ok(properties.x+properties.width<=scene.x+1);assert.ok(scene.x+scene.width<=chat.x+1);}
  await page.screenshot({path:join(output,`independent-panels-${width}.png`)});
 });
 await check('closing properties leaves the assistant and current draft intact',async()=>{
  await page.getByRole('button',{name:'关闭属性面板',exact:true}).click();assert.equal(await assistant.isVisible(),true);
  assert.equal(await page.getByLabel('建模描述',{exact:true}).inputValue(),'保留货架结构，只调整层板高度');
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error){if(page)await page.screenshot({path:join(output,'pro-v6-migration-failure.png')});throw error;} finally {await browser?.close();await server.close();await writeFile(join(output,'panels-report.json'),JSON.stringify(report,null,2));}
