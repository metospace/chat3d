import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';
import {validateTeamPayload} from '../dist-team/validator.mjs';
const dir=await mkdtemp(join(tmpdir(),'scenivo-auth-resources-'));
const team=openTeam(join(dir,'test.sqlite'));let server;
try{
 const owner=team.provision('owner','isolated-test-password-owner');team.provision('other','isolated-test-password-other');team.provision('viewer','isolated-test-password-viewer','viewer');
 const login=name=>team.login(name,'isolated-test-password-'+name);
 const a=login('owner'),b=login('other'),v=login('viewer');
 const payload={format:'chat3d-project',version:1,scene:{schemaVersion:1,projectId:'auth-resource-fixture',revision:0,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]}};
 const request={kind:'scene',name:'权限检查场景',description:'',payload,key:crypto.randomUUID(),expectedVersion:0};
 const first=team.publish(owner,request,validateTeamPayload);
 const middleware=teamMiddleware(team,validateTeamPayload,{origins:['http://tauri.localhost']});
 server=createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/api/team/`;
 const call=(path,token,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error'});
 for(const path of ['items?kind=scene',`items/${first.id}/1`]){
  assert.equal((await call(path)).status,401);assert.equal((await call(path,'invalid')).status,401);
  assert.equal((await call(path,v.token)).status,200);
 }
 assert.equal((await call('publish',undefined,request)).status,401);
 assert.equal((await call('publish',v.token,{...request,key:crypto.randomUUID()})).status,403);
 assert.equal((await call('publish',b.token,{...request,itemId:first.id,expectedVersion:1,key:crypto.randomUUID()})).status,403);
 assert.equal(team.list('scene').length,1);assert.equal(team.read(first.id,1).version,1);
 const response=await call(`items/${first.id}/1`,v.token),text=await response.text();assert.ok(!text.includes(a.token));assert.ok(!text.includes('isolated-test-password'));
 team.logout(a.token);assert.equal((await call('items?kind=scene',a.token)).status,401);
 team.disable('viewer');assert.equal((await call(`items/${first.id}/1`,v.token)).status,401);
 console.log('PASS HTTP resource reads require authentication; viewer/nonowner writes denied atomically; logout/disable revoke access');
}finally{if(server)await new Promise(r=>server.close(r));team.close();await rm(dir,{recursive:true,force:true});}
