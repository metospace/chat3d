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
 console.log('PASS browser exports UTF-8 HTML without claiming a verified save');
 globalThis.isTauri=true;
 window.__TAURI_INTERNALS__={invoke:async()=>null};
 assert.equal(await exportFile('项目','json','project.json'),null);assert.equal(clicked,1);
 window.__TAURI_INTERNALS__.invoke=async()=>{throw Error('磁盘已满');};
 await assert.rejects(exportFile(new Uint8Array([0,255]).buffer,'glb','model.glb'),/磁盘已满/);
 console.log('PASS cancellation is silent and write failures cannot claim success');
}finally{delete globalThis.isTauri;await server.close();dom.window.close();}
