import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>');installBrowserGlobals(dom);
globalThis.window=dom.window;globalThis.document=dom.window.document;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {exportFile}=await server.ssrLoadModule('/src/util/exportFile.ts');
 let blob,clicked=0;
 URL.createObjectURL=value=>{blob=value;return 'blob:export';};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=function(){assert.ok(document.body.contains(this));assert.equal(this.download,'模型.html');clicked++;};
 assert.match(await exportFile('<html>中文</html>','html','模型.html'),/已发起下载/);
 assert.equal(await blob.text(),'<html>中文</html>');assert.equal(blob.type,'text/html;charset=utf-8');assert.equal(clicked,1);assert.equal(document.querySelector('a'),null);
 let browserGenerated=0;
 assert.match(await exportFile(async()=>{browserGenerated++;return '<html>工厂中文</html>';},'html','模型.html'),/已发起下载/);
 assert.equal(browserGenerated,1);assert.equal(await blob.text(),'<html>工厂中文</html>');assert.equal(clicked,2);
 await assert.rejects(exportFile(async()=>{throw Error('生成失败');},'html','模型.html'),/生成失败/);
 assert.equal(clicked,2);
 console.log('PASS browser direct and lazy exports preserve UTF-8 without claiming a verified save');

 globalThis.isTauri=true;
 let calls=[];
 window.__TAURI_INTERNALS__={invoke:async(command,args,options)=>{calls.push({command,args,options});return null;}};
 let generated=0;
 assert.equal(await exportFile(async()=>{generated++;return '不应生成';},'html','模型.html'),null);
 assert.equal(generated,0);assert.equal(clicked,2);
 assert.deepEqual(calls,[{command:'select_export_destination',args:{kind:'html',filename:'模型.html'},options:undefined}]);
 calls=[];
 assert.equal(await exportFile('项目','json','project.json'),null);
 assert.equal(calls.length,1);assert.equal(calls[0].command,'select_export_destination');
 console.log('PASS native cancellation is silent and never starts expensive generation');

 let resolvePicker;
 const events=[];
 const selectedPath='C:\\用户\\模型.html';
 window.__TAURI_INTERNALS__.invoke=async(command,args,options)=>{
  events.push(command);
  if(command==='select_export_destination'){
   assert.deepEqual(args,{kind:'html',filename:'模型.html'});
   return new Promise(resolve=>{resolvePicker=resolve;});
  }
  assert.equal(command,'commit_export_file');
  assert.equal(Array.isArray(args),false);
  assert.ok(args instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(args),'<html>中文🚀</html>');
  assert.deepEqual(options,{headers:{'x-export-token':'chosen-token'}});
  return selectedPath;
 };
 const saving=exportFile(async()=>{generated++;events.push('generate');return '<html>中文🚀</html>';},'html','模型.html');
 assert.deepEqual(events,['select_export_destination']);assert.equal(generated,0);
 resolvePicker('chosen-token');
 assert.equal(await saving,'已保存到：'+selectedPath);
 assert.equal(generated,1);
 assert.deepEqual(events,['select_export_destination','generate','commit_export_file']);
 console.log('PASS native picker resolves before HTML generation, then raw UTF-8 is saved');

 const binary=new Uint8Array([0,255,1]).buffer;
 for(const [contents,kind,filename]of[[binary,'glb','model.glb'],['项目中文','json','project.json']]){
  const order=[];
  window.__TAURI_INTERNALS__.invoke=async(command,args,options)=>{
   order.push(command);
   if(command==='select_export_destination'){assert.deepEqual(args,{kind,filename});return 'direct-token';}
   assert.equal(command,'commit_export_file');
   assert.deepEqual(options,{headers:{'x-export-token':'direct-token'}});
   if(kind==='glb')assert.equal(args,binary);
   else assert.equal(new TextDecoder().decode(args),'项目中文');
   return selectedPath;
  };
  assert.equal(await exportFile(contents,kind,filename),'已保存到：'+selectedPath);
  assert.deepEqual(order,['select_export_destination','commit_export_file']);
 }
 console.log('PASS existing direct GLB and JSON exports use the same destination-first protocol');

 for(const failAt of ['generate','commit_export_file']){
  const error=Error(failAt==='generate'?'HTML 生成失败':'磁盘已满');
  const order=[];
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   order.push(command);
   if(command==='select_export_destination')return 'failed-token';
   if(command==='commit_export_file')throw error;
   assert.equal(command,'cancel_export_destination');assert.deepEqual(args,{token:'failed-token'});
  };
  await assert.rejects(exportFile(async()=>{order.push('generate');if(failAt==='generate')throw error;return 'html';},'html','模型.html'),actual=>actual===error);
  assert.deepEqual(order,failAt==='generate'?['select_export_destination','generate','cancel_export_destination']:['select_export_destination','generate','commit_export_file','cancel_export_destination']);
 }
 console.log('PASS generation and disk failures release native destination without claiming success');

 const generationError=Error('原始生成错误');
 window.__TAURI_INTERNALS__.invoke=async(command)=>{
  if(command==='select_export_destination')return 'cleanup-token';
  assert.equal(command,'cancel_export_destination');throw Error('窗口已关闭');
 };
 await assert.rejects(exportFile(async()=>{throw generationError;},'html','模型.html'),actual=>actual===generationError);
 window.__TAURI_INTERNALS__.invoke=async(command)=>{assert.equal(command,'select_export_destination');throw Error('无法打开保存对话框');};
 await assert.rejects(exportFile(async()=>{throw Error('不应生成');},'html','模型.html'),/无法打开保存对话框/);
 assert.equal(clicked,2);
 console.log('PASS dialog and cleanup errors never cause a false success or hide generation errors');
}finally{delete globalThis.isTauri;await server.close();dom.window.close();}
