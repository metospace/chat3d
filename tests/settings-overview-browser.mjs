import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const output=resolve('artifacts/ant-design-x');await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path=>path&&existsSync(path));
assert.ok(executablePath,'Set CHAT3D_BROWSER_PATH');
const cacheDir=await mkdtemp(join(tmpdir(),'scenivo-settings-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;const report={checks:[],errors:[]};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
try {
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
 page.on('pageerror',error=>report.errors.push(error.message));
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.route('**/api/version',route=>route.fulfill({status:200,json:{version:'0.2.27'}}));
 await page.goto(base);await page.getByRole('button',{name:'设置',exact:true}).click();
 await check('footer has one settings entry and one account entry without duplicate version',async()=>{
  const footer=page.locator('.studio-sidebar-footer');
  assert.equal(await footer.getByRole('button').count(),2);
  assert.equal(await footer.getByRole('button',{name:'登录账户',exact:true}).isVisible(),true);
  assert.equal(await footer.locator('.app-update-nav-entry').count(),0);
  assert.equal(await page.getByRole('button',{name:'设置',exact:true}).getAttribute('aria-current'),'page');
 });
 await check('general and data tabs expose the relevant settings only',async()=>{
  assert.equal(await page.getByRole('tab',{name:'通用',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('button',{name:'模型配置',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'管理项目备份',exact:true}).isVisible(),false);
  await page.screenshot({path:join(output,'settings-general.png')});
  await page.getByRole('tab',{name:'数据管理',exact:true}).click();
  for(const name of ['管理项目备份','管理项目','管理资产备份'])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true);
  assert.equal(await page.locator('.settings-data-note').isVisible(),true);
  await page.screenshot({path:join(output,'settings-data.png')});
 });
 await check('about keeps version and update action in one compact section',async()=>{
  await page.getByRole('tab',{name:'关于',exact:true}).click();
  assert.equal(await page.getByText('网页版',{exact:true}).isVisible(),true);
  const panel=page.locator('.app-update-panel-settings');
  const summary=await panel.locator('.app-update-summary').boundingBox();
  const action=await page.getByRole('button',{name:'检查更新',exact:true}).boundingBox();
  assert.ok(Math.abs(summary.y+summary.height/2-action.y-action.height/2)<2);
  assert.ok((await page.locator('.app-update-settings-group').boundingBox()).height<240);
  assert.equal(await panel.locator('.app-update-brand-card').count(),0);
  await page.getByRole('button',{name:'检查更新',exact:true}).click();
  await page.getByRole('status').filter({hasText:/最新|当前/}).waitFor();
  await page.screenshot({path:join(output,'settings-about.png')});
 });
 await check('update reminder is shown in settings without another sidebar entry',async()=>{
  await page.evaluate(async()=>{const {useAppUpdate}=await import('/src/domain/appUpdateClient.ts');useAppUpdate.setState({release:{version:'99.0.0',notes:'布局验证'},dismissed:null,remind:null,phase:'idle',busy:true,dirty:false,checkMessage:''});});
  const updateDialog=page.getByRole('dialog',{name:'应用更新',exact:true});await updateDialog.waitFor();
  await updateDialog.getByRole('button',{name:'稍后提醒',exact:true}).click();await updateDialog.waitFor({state:'hidden'});
  await page.locator('.studio-settings-update .ant-badge-status-error').waitFor();
  await page.evaluate(async()=>{const {useAppUpdate}=await import('/src/domain/appUpdateClient.ts');useAppUpdate.setState({busy:false});});
  assert.equal(await updateDialog.count(),0,'dismissed release stays closed after task ends');
  assert.equal(await page.locator('.studio-sidebar-footer').getByRole('button').count(),2);
  assert.equal(await page.getByRole('tab',{name:'关于',exact:true}).locator('.ant-badge').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'刷新到 99.0.0',exact:true}).isVisible(),true);
 });
 for(const theme of ['light','dark'])for(const width of [1440,992,390])await check(`settings ${theme} at ${width}px stay within viewport`,async()=>{
  await page.setViewportSize({width,height:900});
  await page.evaluate(theme=>{localStorage.setItem('chat3d.appearance.v1',theme);window.dispatchEvent(new StorageEvent('storage',{key:'chat3d.appearance.v1',newValue:theme}));},theme);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(const name of ['通用','数据管理','团队连接','关于']){
   const tab=page.getByRole('tab',{name,exact:true});await tab.click();
   const pane=page.getByRole('tabpanel',{name,exact:true});
   await pane.waitFor({state:'visible'});
   const overflow=await pane.evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,name+' tab horizontal overflow');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.locator('.studio-settings-update .ant-badge-status-error').isVisible(),true,'update dot stays visible at compact sidebar widths');
  await page.waitForFunction(()=>{const bar=document.querySelector('.settings-category-tabs .ant-tabs-ink-bar'),tab=document.querySelector('.settings-category-tabs .ant-tabs-tab-active');return !bar||!tab||Math.abs(bar.getBoundingClientRect().left-tab.getBoundingClientRect().left)<1;});
  await page.screenshot({path:join(output,`settings-about-${theme}-${width}.png`)});
 });
 await check('update reminder clears when no newer release remains',async()=>{
  await page.evaluate(async()=>{const {useAppUpdate}=await import('/src/domain/appUpdateClient.ts');useAppUpdate.setState({release:null});});
  assert.equal(await page.locator('.studio-settings-update').count(),0);
  assert.equal(await page.getByRole('tab',{name:'关于',exact:true}).locator('.ant-badge').count(),0);
 });
 assert.deepEqual(report.errors,[]);report.passed=true;
} finally {await browser?.close();await server.close();await writeFile(join(output,'settings-report.json'),JSON.stringify(report,null,2));}
