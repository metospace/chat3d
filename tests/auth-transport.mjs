import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
const originalFetch=globalThis.fetch;
try{
 const {createTeamTransport}=await vite.ssrLoadModule('/src/domain/teamTransport.ts');
 const signal=new AbortController().signal;
 const options={method:'POST',headers:{Authorization:'Bearer test-only-token'},body:'{}',credentials:'omit',redirect:'error',signal};
 let browserCalls=0,nativeCalls=0;
 globalThis.fetch=async(input,init)=>{browserCalls++;assert.equal(input,'https://team.example/api/team/me');assert.equal(init,options);return Response.json({browser:true});};
 const browser=createTeamTransport(()=>false,async()=>{throw Error('must not load native in browser');});
 assert.deepEqual(await (await browser('https://team.example/api/team/me',options)).json(),{browser:true});
 const native=createTeamTransport(()=>true,async()=>({fetch:async(input,init)=>{nativeCalls++;assert.equal(input,'https://team.example/api/team/me');assert.equal(init.signal,signal);assert.equal(init.headers,options.headers);assert.equal(init.credentials,'omit');assert.equal(init.maxRedirections,0);assert.equal(init.connectTimeout,15000);assert.equal(init.danger,undefined);return Response.json({native:true});}}));
 assert.deepEqual(await (await native('https://team.example/api/team/me',options)).json(),{native:true});
 await assert.rejects(createTeamTransport(()=>true,async()=>{throw Error('missing');})('https://team.example'),/原生网络插件/);
 await assert.rejects(createTeamTransport(()=>true,async()=>({fetch:async()=>{throw Error('permission denied');}}))('https://team.example'),/permission denied/);
 assert.equal(browserCalls,1);assert.equal(nativeCalls,1);
 console.log('PASS browser preserves request auth boundary; native enforces zero redirects and TLS defaults without browser fallback');
}finally{globalThis.fetch=originalFetch;await vite.close();}
