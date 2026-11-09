import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mockIPC,clearMocks} from '@tauri-apps/api/mocks';
const vite=await createServer({configFile:false,cacheDir:`node_modules/.vite-team-publish-${process.pid}`,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,ws:false,watch:null},appType:'custom'}),originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalTauri=globalThis.isTauri,originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
try{
 const {sendTeamPublication,TEAM_PUBLISH_TIMEOUT_MS}=await vite.ssrLoadModule('/src/domain/teamPublish.ts');
 const body=JSON.stringify({key:'same-publication-key',payload:'中文模型'.repeat(100000)}),expected=new TextEncoder().encode(body),stages=[];let calls=0,channel;
 globalThis.isTauri=true;globalThis.window={crypto:globalThis.crypto};globalThis.fetch=()=>{throw Error('No browser fallback allowed');};
 mockIPC((command,args,options)=>{assert.equal(command,'desktop_team_publish');assert.ok(args instanceof Uint8Array);assert.deepEqual(args,expected);calls++;return {status:200,body:JSON.stringify({id:'remote-fixed',version:1})};});
 const response=await sendTeamPublication('https://team.example','session-token',body,p=>stages.push(p));
 assert.deepEqual(await response.json(),{id:'remote-fixed',version:1});assert.equal(calls,1);assert.equal(stages[0].total,expected.byteLength);
 console.log('PASS desktop publication sends exact UTF-8 bytes without JSON number-array expansion or browser fallback');
 mockIPC(()=>{throw Error('尚未确认是否发布成功。');});await assert.rejects(sendTeamPublication('https://team.example','token',body),/尚未确认/);
 mockIPC(()=>({status:401,body:'{"error":"团队登录已失效"}'}));assert.equal((await sendTeamPublication('https://team.example','token',body)).status,401);
 console.log('PASS native failures do not automatically retry and HTTP session failures remain visible');
 clearMocks();globalThis.isTauri=false;
 let expire,sentSignal;const deadlineTimer=Symbol('publication-deadline');globalThis.setTimeout=(fn,ms,...args)=>{if(ms!==TEAM_PUBLISH_TIMEOUT_MS)return originalSetTimeout(fn,ms,...args);expire=fn;return deadlineTimer;};globalThis.clearTimeout=timer=>{if(timer!==deadlineTimer)originalClearTimeout(timer);};
 globalThis.fetch=async(_url,init)=>{sentSignal=init.signal;assert.equal(init.redirect,'error');assert.equal(init.body,body);assert.equal(sentSignal.aborted,false);return Response.json({id:'remote-fixed',version:1});};
 assert.deepEqual(await (await sendTeamPublication('https://team.example','token',body)).json(),{id:'remote-fixed',version:1});assert.equal(sentSignal.aborted,false);
 globalThis.fetch=(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('Request canceled')),{once:true}));
 const timed=sendTeamPublication('https://team.example','token',body);expire();await assert.rejects(timed,/尚未确认/);
 console.log('PASS publication deadline is distinct from query timeout and explains ambiguous commit without auto retry');
 // Large publications must never cross the raw native IPC boundary.
 globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;
 const {createHash}=await import('node:crypto');
 const largeKey='large-publication-key-0001',largeBody=JSON.stringify({payload:'中😀文'.repeat(950000),key:largeKey}),largeBytes=Buffer.from(largeBody),chunkBytes=1024*1024;
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const fingerprint=hash(Array.from({length:Math.ceil(largeBytes.length/chunkBytes)},(_,index)=>hash(largeBytes.subarray(index*chunkBytes,(index+1)*chunkBytes))).join(''));
 let offset=0,failOnce=true,completed=false,largeCalls=0;const largeStages=[],uploads=[];
 globalThis.isTauri=true;mockIPC(()=>{throw Error('Large upload must not use raw native IPC');});
 globalThis.fetch=async(url,init)=>{
  largeCalls++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer session-token');assert.ok(Buffer.byteLength(init.body)<2*1024*1024);assert.equal(init.signal.aborted,false);
  const data=JSON.parse(init.body);
  if(url.endsWith('/start')){assert.deepEqual(data,{key:largeKey,total:largeBytes.length,digest:fingerprint});return Response.json({uploadId:'upload-large-1',offset,total:largeBytes.length,...(completed?{result:{id:'large-fixed',version:1}}:{})});}
  if(url.endsWith('/chunk')){const chunk=Buffer.from(data.data,'base64');assert.equal(data.offset,offset);assert.deepEqual(chunk,largeBytes.subarray(offset,offset+chunk.length));offset+=chunk.length;uploads.push(data.offset);if(failOnce){failOnce=false;throw Error('Failed to fetch at https://secret.invalid/?token=hidden');}return Response.json({uploadId:'upload-large-1',offset,total:largeBytes.length});}
  assert.ok(url.endsWith('/complete'));assert.equal(offset,largeBytes.length);completed=true;return Response.json({id:'large-fixed',version:1});
 };
 await assert.rejects(sendTeamPublication('https://team.example/private?token=hidden','session-token',largeBody,p=>largeStages.push(p),largeKey),error=>{assert.match(error.message,/https:\/\/team.example/);assert.match(error.message,/代理/);assert.doesNotMatch(error.message,/hidden|secret\.invalid|private/);return true;});
 assert.equal(largeCalls,2,'failed request is not automatically retried');assert.equal(offset,chunkBytes);assert.equal(largeStages.filter(p=>p.phase==='uploading').at(-1).loaded,0,'only server-confirmed progress advances');
 assert.deepEqual(await (await sendTeamPublication('https://team.example','session-token',largeBody,p=>largeStages.push(p))).json(),{id:'large-fixed',version:1});assert.deepEqual(uploads,[0,...Array.from({length:Math.ceil(largeBytes.length/chunkBytes)-1},(_,index)=>(index+1)*chunkBytes)]);
 assert.equal(largeStages.at(-1).phase,'processing');assert.equal(largeStages.at(-1).loaded,largeBytes.length);
 const callsBefore=largeCalls;assert.deepEqual(await (await sendTeamPublication('https://team.example','session-token',largeBody,undefined,largeKey)).json(),{id:'large-fixed',version:1});assert.equal(largeCalls,callsBefore+1,'completed response-loss retry only queries the original upload');
 console.log('PASS large UTF-8 publications chunk, report confirmed bytes, resume after partial failure and skip completed uploads without native number arrays');
 globalThis.fetch=async()=>new Response('not deployed',{status:404});await assert.rejects(sendTeamPublication('https://team.example','session-token',largeBody,undefined,largeKey),/升级.*publish-uploads/);
 globalThis.fetch=async()=>Response.json({error:'团队登录已失效'},{status:401});assert.equal((await sendTeamPublication('https://team.example','bad',largeBody,undefined,largeKey)).status,401);
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms!==TEAM_PUBLISH_TIMEOUT_MS)return originalSetTimeout(fn,ms,...args);expire=fn;return deadlineTimer;};globalThis.clearTimeout=timer=>{if(timer!==deadlineTimer)originalClearTimeout(timer);};
 globalThis.fetch=(_url,init)=>new Promise((resolve,reject)=>{expire();init.signal.addEventListener('abort',()=>reject(Error('Request canceled')),{once:true});if(init.signal.aborted)reject(Error('Request canceled'));});
 await assert.rejects(sendTeamPublication('https://team.example','token',largeBody,undefined,largeKey),/15 分钟.*https:\/\/team.example/);
 console.log('PASS chunk authentication, explicit deployment requirement and overall cancellation deadline without fallback');
}finally{clearMocks();globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;if(originalTauri===undefined)delete globalThis.isTauri;else globalThis.isTauri=originalTauri;await vite.close();}
