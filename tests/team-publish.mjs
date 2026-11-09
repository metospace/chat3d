import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mockIPC,clearMocks} from '@tauri-apps/api/mocks';
const vite=await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom'}),originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalTauri=globalThis.isTauri,originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
try{
 const {sendTeamPublication,TEAM_PUBLISH_TIMEOUT_MS}=await vite.ssrLoadModule('/src/domain/teamPublish.ts');
 const body=JSON.stringify({key:'same-publication-key',payload:'中文模型'.repeat(100000)}),expected=new TextEncoder().encode(body),stages=[];let calls=0,channel;
 globalThis.isTauri=true;globalThis.window={crypto:globalThis.crypto};globalThis.fetch=()=>{throw Error('No browser fallback allowed');};
 mockIPC((command,args,options)=>{assert.equal(command,'desktop_team_publish');assert.ok(args instanceof Uint8Array);assert.deepEqual(args,expected);calls++;return {status:200,body:JSON.stringify({id:'remote-fixed',version:1})};});
 const response=await sendTeamPublication('https://team.example','session-token',body,p=>stages.push(p));
 assert.deepEqual(await response.json(),{id:'remote-fixed',version:1});assert.equal(calls,1);assert.equal(stages[0].total,expected.byteLength);
 console.log('PASS desktop publication sends exact UTF-8 bytes without JSON number-array expansion or browser fallback');
 mockIPC(()=>{throw Error('上传等待超过 5 分钟，尚未确认是否发布成功。');});await assert.rejects(sendTeamPublication('https://team.example','token',body),/尚未确认/);
 mockIPC(()=>({status:401,body:'{"error":"团队登录已失效"}'}));assert.equal((await sendTeamPublication('https://team.example','token',body)).status,401);
 console.log('PASS native failures do not automatically retry and HTTP session failures remain visible');
 clearMocks();globalThis.isTauri=false;
 let expire,sentSignal;globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,TEAM_PUBLISH_TIMEOUT_MS);expire=fn;return 1;};globalThis.clearTimeout=()=>{};
 globalThis.fetch=async(_url,init)=>{sentSignal=init.signal;assert.equal(init.redirect,'error');assert.equal(init.body,body);assert.equal(sentSignal.aborted,false);return Response.json({id:'remote-fixed',version:1});};
 assert.deepEqual(await (await sendTeamPublication('https://team.example','token',body)).json(),{id:'remote-fixed',version:1});assert.equal(sentSignal.aborted,false);
 globalThis.fetch=(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('Request canceled')),{once:true}));
 const timed=sendTeamPublication('https://team.example','token',body);expire();await assert.rejects(timed,/5 分钟.*尚未确认/);
 console.log('PASS publication deadline is distinct from query timeout and explains ambiguous commit without auto retry');
}finally{clearMocks();globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalTauri===undefined)delete globalThis.isTauri;else globalThis.isTauri=originalTauri;await vite.close();}
