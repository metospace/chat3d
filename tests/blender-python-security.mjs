import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {pythonMiddleware} from '../server/blender/python-http.mjs';
import {runBlenderPython,validatePython} from '../server/blender/python.mjs';

async function check(bindHost, fn, publicOrigin) {
  const middleware = pythonMiddleware({bindHost,publicOrigin,executable:process.execPath});
  const server = createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try {await fn('http://127.0.0.1:'+server.address().port);}
  finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
}
const root = '/api/blender/python';
const statusHeaders = {'x-chat3d-python':'1'};
const status = (origin,headers=statusHeaders) => new Promise((resolve,reject)=>request(origin+root+'/status',{headers},res=>{const chunks=[]; res.on('data',part=>chunks.push(part)); res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(Buffer.concat(chunks))}));}).on('error',reject).end());
const post = (origin,token,body,headers={}) => fetch(origin+root,{method:'POST',headers:{origin,'x-chat3d-python':token,'content-type':'application/json',...headers},body});
delete process.env.CHAT3D_BLENDER_ALLOW_PYTHON;
await assert.rejects(runBlenderPython({script:'pass'}),{status:503});
await check('127.0.0.1',async origin=>assert.deepEqual(await (await status(origin)).json(),{available:false}));
process.env.CHAT3D_BLENDER_ALLOW_PYTHON = '1';
await check('0.0.0.0',async origin=>assert.deepEqual(await (await status(origin)).json(),{available:false}));
await check('127.0.0.1',async origin=>assert.deepEqual(await (await status(origin)).json(),{available:false}),'https://example.test');
await check('127.0.0.1',async origin=>{
  for(const extra of [{host:'evil.test:'+new URL(origin).port},{host:'localhost:123'},{origin:'https://evil.test'},{forwarded:'for=127.0.0.1'},{'x-forwarded-for':'127.0.0.1'},{'sec-fetch-site':'cross-site'}]) {
    assert.equal((await status(origin,{...statusHeaders,...extra})).status,403);
  }
  const {available,token} = await (await status(origin)).json();
  assert.equal(available,true);
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal((await post(origin,'1','{}')).status,403);
  assert.equal((await post(origin,token,'{}',{origin:'https://evil.test'})).status,403);
  assert.equal((await post(origin,token,JSON.stringify({script:'😀'.repeat(65537)}))).status,413);
  assert.equal((await post(origin,token,JSON.stringify({script:'pass',baseGlb:'x'}))).status,422);
});
assert.deepEqual(validatePython({script:'x'.repeat(262144)}),{script:'x'.repeat(262144)});
console.log('PASS Blender Python gate, loopback checks, token, and UTF-8 budget');
