import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
const out=path.resolve('windows-smoke-results');fs.mkdirSync(out,{recursive:true});
const application=process.env.CHAT3D_INSTALLED_EXE;assert.ok(application&&fs.existsSync(application),'Installed Scenivo executable required');
const logs=fs.openSync(path.join(out,'driver.log'),'w');
const profile=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP??out,'chat3d-webview-test-'));
const app=spawn(application,[],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9222',WEBVIEW2_USER_DATA_FOLDER:profile},stdio:['ignore',logs,logs]});
let browser,page;const report={application,startedAt:new Date().toISOString(),checks:[],limitations:['No real model service configured','CI graphics are not the user GPU','Native IPC save checks do not cover the diagnostic button after a real generation']};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const exec=script=>page.evaluate(script=>new Function(script)(),script);
const asyncExec=(script,args=[])=>page.evaluate(({script,args})=>new Promise(resolve=>new Function(script).apply(null,[...args,resolve])),{script,args});
async function check(name,fn){const detail=await fn();report.checks.push({name,pass:true,detail});console.log('PASS',name);}
try{
 app.on('error',e=>{report.launchError=String(e)});
 for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:9222/json/version',{signal:AbortSignal.timeout(1000)});if(r.ok)break;throw Error('not ready')}catch{if(i===59)throw Error('WebView2 CDP endpoint not ready');await sleep(1000)}}
 browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
 for(let i=0;i<30;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().startsWith('devtools:'));if(page)break;await sleep(500)}assert.ok(page,'App WebView missing');
 page.setDefaultTimeout(30000);
 await check('installed desktop starts and renders home',async()=>{for(let i=0;i<60;i++){const body=await exec('return document.body.innerText');if(/Scenivo/.test(body)&&body.length>100){fs.writeFileSync(path.join(out,'home.txt'),body);return {title:await exec('return document.title'),textLength:body.length}}await sleep(1000)}throw Error('Home never rendered')});
 fs.writeFileSync(path.join(out,'home.png'),await page.screenshot());
 const invoke=async(contents,kind)=>asyncExec(`const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('save_support_json',{contents:arguments[0],kind:arguments[1]}).then(path=>done({path}),error=>done({error:String(error)}));`,[contents,kind]);
 const text=JSON.stringify({format:'chat3d-diagnostics-v2',data:{smokeTest:true,message:'中文诊断落盘核验'},artifacts:{},omissions:[]});let first;
 await check('native diagnostics IPC writes exact bytes on Windows',async()=>{const r=await invoke(text,'diagnostics');assert.ok(r.path,r.error);assert.equal(fs.readFileSync(r.path,'utf8'),text);assert.equal(path.basename(path.dirname(r.path)),'Scenivo');first=r.path;return {path:r.path,bytes:fs.statSync(r.path).size}});
 await check('repeated export creates a distinct file without overwriting',async()=>{const r=await invoke(text,'diagnostics');assert.ok(r.path,r.error);assert.notEqual(r.path,first);assert.equal(fs.readFileSync(first,'utf8'),text);assert.equal(fs.readFileSync(r.path,'utf8'),text);return {path:r.path}});
 await check('workspace backup format writes and invalid requests fail',async()=>{const content=JSON.stringify({format:'chat3d-workspace-backup',smokeTest:true});const r=await invoke(content,'workspace');assert.ok(r.path,r.error);assert.equal(fs.readFileSync(r.path,'utf8'),content);for(const [data,kind]of[['not json','diagnostics'],['{"format":"wrong"}','diagnostics'],[text,'../escape']])assert.ok((await invoke(data,kind)).error);return 'valid backup saved; malformed JSON, format mismatch and invalid kind rejected'});
 await check('asset library navigation renders a real screen',async()=>{const clicked=await exec(`const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='资产库');if(!b)return false;b.click();return true`);assert.equal(clicked,true);for(let i=0;i<20;i++){const body=await exec('return document.body.innerText');if(body.includes('新建资产')){fs.writeFileSync(path.join(out,'library.txt'),body);return true}await sleep(500)}throw Error('Library navigation failed')});
 fs.writeFileSync(path.join(out,'library.png'),await page.screenshot());
 report.pass=true;
}catch(e){report.pass=false;report.error=String(e);if(page){try{fs.writeFileSync(path.join(out,'failure.png'),await page.screenshot());fs.writeFileSync(path.join(out,'failure.txt'),await exec('return document.body.innerText'))}catch{}}process.exitCode=1;console.error(e)}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));if(browser)try{await browser.close()}catch{}app.kill();fs.closeSync(logs)}
