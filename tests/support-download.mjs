import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>');installBrowserGlobals(dom);globalThis.window=dom.window;globalThis.document=dom.window.document;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {downloadJson,downloadDiagnosticBlob}=await server.ssrLoadModule('/src/util/downloadJson.ts');let attached=false,receivedBlob;
 URL.createObjectURL=blob=>{receivedBlob=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
 dom.window.HTMLAnchorElement.prototype.click=function(){attached=document.body.contains(this);assert.equal(this.download,'scenivo-diagnostics.json');};
 assert.match(await downloadJson('{"format":"chat3d-diagnostics-v1"}','diagnostics'),/尚未确认/);assert.equal(attached,true);assert.equal(document.querySelectorAll('a').length,0);
 console.log('PASS browser export attaches and removes download link without claiming file persistence');
 const diagnosticBlob=new Blob(['{"format":"chat3d-diagnostics-v2","data":{"ok":true}}'],{type:'application/json'});
 assert.match(await downloadDiagnosticBlob(diagnosticBlob),/尚未确认/);assert.equal(receivedBlob,diagnosticBlob);assert.equal(document.querySelectorAll('a').length,0);
 console.log('PASS diagnostic browser download uses the original worker Blob without re-encoding');
 dom.window.HTMLAnchorElement.prototype.click=function(){assert.equal(this.download,'scenivo-workspace.backup.json');};
 assert.match(await downloadJson('workspace payload','workspace'),/尚未确认/);assert.equal(await receivedBlob.text(),'workspace payload');
 console.log('PASS workspace browser backup filename and payload are unchanged');
 globalThis.isTauri=true;let args;window.__TAURI_INTERNALS__={invoke:async(cmd,input)=>{assert.equal(cmd,'save_support_json');args=input;return 'C:\\Downloads\\Scenivo\\report.json';}};
 assert.match(await downloadJson('workspace payload','workspace'),/已保存到/);assert.deepEqual(args,{contents:'workspace payload',kind:'workspace'});
 console.log('PASS desktop export uses native command and returns confirmed path');
 assert.match(await downloadDiagnosticBlob(diagnosticBlob),/已保存到/);assert.deepEqual(args,{contents:await diagnosticBlob.text(),kind:'diagnostics'});
 console.log('PASS diagnostic desktop save sends decoded JSON text, not a quoted JSON string');
 window.__TAURI_INTERNALS__.invoke=async()=>{throw Error('磁盘已满')};await assert.rejects(downloadJson('x','diagnostics'),/磁盘已满/);
 await assert.rejects(downloadDiagnosticBlob(diagnosticBlob),/磁盘已满/);
 console.log('PASS desktop save failures propagate instead of claiming a download');
}finally{delete globalThis.isTauri;await server.close();dom.window.close();}
