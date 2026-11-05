import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';
import {validateTeamPayload} from '../dist-team/validator.mjs';
const dir=await mkdtemp(join(tmpdir(),'chat3d-team-'));let team=openTeam(join(dir,'test.sqlite'));let server,platform,ssoTeam;
const scene={format:'chat3d-project',version:1,scene:{schemaVersion:1,projectId:'test-scene',revision:0,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]}};
const check=(label,fn)=>{fn();console.log('PASS '+label);};
try{
 const alice=team.provision('alice','isolated-test-password-a'),bob=team.provision('bob','isolated-test-password-b'),viewer=team.provision('viewer','isolated-test-password-v','viewer'),admin=team.provision('admin','isolated-test-password-x','admin');
 check('password hashes only, no plaintext',()=>{assert.notEqual(team.db.prepare('SELECT password FROM users WHERE id=?').get(alice.id).password,'isolated-test-password-a');});
 check('anonymous and invalid password denied',()=>{assert.throws(()=>team.authenticate('bad'),e=>e.status===401);assert.throws(()=>team.login('alice','incorrect'),e=>e.status===401);});
 const a=team.login('alice','isolated-test-password-a'),b=team.login('bob','isolated-test-password-b');
 const request={kind:'scene',name:'装配线',description:'测试场景',payload:scene,key:crypto.randomUUID(),expectedVersion:0};
 check('unpublished draft is invisible',()=>assert.deepEqual(team.list('scene'),[]));
 const first=team.publish(alice,request,validateTeamPayload);
 check('two members can read/search the same published scene',()=>{assert.equal(team.authenticate(b.token).id,bob.id);assert.equal(team.list('scene','装配')[0].id,first.id);assert.deepEqual(team.read(first.id,1).payload,scene);});
 check('duplicate clicks and lost-response retry are idempotent',()=>{assert.deepEqual(team.publish(alice,request,validateTeamPayload),first);assert.equal(team.list('scene').length,1);assert.throws(()=>team.publish(alice,{...request,name:'changed'},validateTeamPayload),e=>e.status===409);});
 const update={...request,itemId:first.id,expectedVersion:1,key:crypto.randomUUID(),name:'装配线新版'};
 check('non-owner and viewer writes denied',()=>{assert.throws(()=>team.publish(bob,update,validateTeamPayload),e=>e.status===403);assert.throws(()=>team.publish(viewer,{...request,key:crypto.randomUUID()},validateTeamPayload),e=>e.status===403);});
 const second=team.publish(alice,update,validateTeamPayload);
 check('immutable previous version and stale update conflict',()=>{assert.equal(second.version,2);assert.equal(team.read(first.id,1).name,request.name);assert.throws(()=>team.publish(alice,{...update,key:crypto.randomUUID()},validateTeamPayload),e=>e.status===409);});
 check('admin may append, never overwrite versions',()=>assert.equal(team.publish(admin,{...update,expectedVersion:2,key:crypto.randomUUID()},validateTeamPayload).version,3));
 check('invalid payload is rejected without partial publication',()=>{assert.throws(()=>team.publish(alice,{...request,key:crypto.randomUUID(),payload:{}},validateTeamPayload),e=>e.status===400);assert.equal(team.list('scene').length,1);});
 team.db.exec("CREATE TRIGGER simulated_failure BEFORE INSERT ON versions WHEN NEW.name='storage-failure' BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;");
 const retry={...request,name:'storage-failure',key:crypto.randomUUID()};const count=team.list('scene').length;
 assert.throws(()=>team.publish(alice,retry,validateTeamPayload),/simulated storage failure/);assert.equal(team.list('scene').length,count);
 team.db.exec('DROP TRIGGER simulated_failure');team.publish(alice,retry,validateTeamPayload);assert.equal(team.list('scene').length,count+1);console.log('PASS storage failure rolls back all writes and retry succeeds');
 team.close();team=openTeam(join(dir,'test.sqlite'));
 check('restart retains identities, sessions and immutable publications',()=>{assert.equal(team.authenticate(a.token).id,alice.id);assert.deepEqual(team.read(first.id,1).payload,scene);assert.equal(team.list('scene').find(x=>x.id===first.id).version,3);assert.deepEqual(team.publish(alice,request,validateTeamPayload),first);});
 const middleware=teamMiddleware(team,validateTeamPayload,{origins:['http://tauri.localhost']});server=createServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/team/`;
 const call=(path,options={})=>fetch(base+path,options);
 assert.equal((await call('items?kind=scene')).status,401);
 assert.equal((await call('items?kind=scene',{headers:{Origin:'https://evil.invalid',Authorization:`Bearer ${a.token}`}})).status,403);
 const cors=await call('publish',{method:'OPTIONS',headers:{Origin:'http://tauri.localhost'}});assert.equal(cors.status,204);assert.equal(cors.headers.get('access-control-allow-origin'),'http://tauri.localhost');
 assert.equal((await call('publish',{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:'null'})).status,400);
 const paddedRequest=bytes=>'{"padding":"'+'x'.repeat(bytes-14)+'"}';
 const withinHttpCap=await call('login',{method:'POST',headers:{'Content-Type':'application/json'},body:paddedRequest(55*1024*1024)});
 assert.equal(withinHttpCap.status,400,'55 MiB body reaches login validation');
 const beyondHttpCap=await call('login',{method:'POST',headers:{'Content-Type':'application/json'},body:paddedRequest(55*1024*1024+1)});
 assert.equal(beyondHttpCap.status,413);assert.match(await beyondHttpCap.text(),/55 MiB/);
 console.log('PASS HTTP body accepts 55 MiB and rejects overflow');
 const result=await call('items?kind=scene',{headers:{Authorization:`Bearer ${b.token}`}});assert.equal(result.status,200);assert.equal((await result.json()).length,2);
 console.log('PASS HTTP auth, origin allowlist, preflight and malformed request checks');
 team.logout(a.token);assert.throws(()=>team.authenticate(a.token),e=>e.status===401);team.disable('bob');assert.throws(()=>team.authenticate(b.token),e=>e.status===401);console.log('PASS logout and account disable revoke access');
const platformUsers=new Map([['pat-new',{username:'carol',disabled:false}],['pat-admin',{username:'admin',disabled:false}],['pat-off',{username:'carol',disabled:true}],['pat-dead',null]]);
let oauthResponse={code:0,data:{access_token:'pat-admin',refresh_token:'refresh-snake',expires_in:3600}};
platform=createServer((req,res)=>{if(req.url==='/admin-api/system/oauth2/token'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(oauthResponse));return;}const token=(req.headers.authorization??'').replace(/^Bearer /,'');const user=platformUsers.get(token);if(!user){res.writeHead(401,{'Content-Type':'application/json'}).end(JSON.stringify({code:401}));return;}if(user.disabled){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:401}));return;}res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:0,data:{user:{username:user.username}}}));});
await new Promise(resolve=>platform.listen(0,'127.0.0.1',resolve));const platformBase=`http://127.0.0.1:${platform.address().port}`;
ssoTeam=openTeam(join(dir,'sso.sqlite'),{platformAuthBase:platformBase,platformTenantId:'1',passwordLogin:true});
ssoTeam.provision('admin','isolated-test-password-x','admin');
const created=await ssoTeam.loginSso('pat-new','1');assert.equal(created.user.name,'carol');assert.equal(created.user.role,'member');assert.notEqual(ssoTeam.db.prepare('SELECT password FROM users WHERE name=?').get('carol').password,'pat-new');
const kept=await ssoTeam.loginSso('pat-admin','1');assert.equal(kept.user.role,'admin');
const freshAdmin=ssoTeam.db.prepare('SELECT role FROM users WHERE name=?').get('admin');assert.equal(freshAdmin.role,'admin');
await assert.rejects(ssoTeam.loginSso('pat-off','1'),e=>e.status===401);
await assert.rejects(ssoTeam.loginSso('pat-dead','1'),e=>e.status===401);
const locked=openTeam(join(dir,'locked.sqlite'),{platformAuthBase:platformBase,passwordLogin:false});
assert.throws(()=>locked.login('nobody','isolated-test-password-a'),e=>e.status===403);locked.close();
const session=await ssoTeam.loginSso('pat-new','1');ssoTeam.db.prepare('UPDATE sessions SET platform_checked=? WHERE token=?').run(0,ssoTeam.db.prepare('SELECT token FROM sessions WHERE user=?').get(session.user.id).token);
platformUsers.set('pat-new',null);await assert.rejects(ssoTeam.authenticate(session.token,{force:true}),e=>e.status===401);assert.throws(()=>ssoTeam.authenticate(session.token),e=>e.status===401);
platformUsers.set('pat-admin',{username:'admin',disabled:false});const adminSession=await ssoTeam.loginSso('pat-admin','1');platformUsers.set('pat-admin',null);
const sceneRequest={kind:'scene',name:'协同发布',description:'',payload:scene,key:crypto.randomUUID(),expectedVersion:0};
await assert.rejects(ssoTeam.publish(adminSession.user,sceneRequest,validateTeamPayload,adminSession.token),e=>e.status===401);
await assert.rejects(ssoTeam.loginSsoCode('code','https://portal.jiezi-ai.com/team/oauth/callback','1'),e=>e.status===503);
const oauthTeam=openTeam(join(dir,'oauth.sqlite'),{platformAuthBase:platformBase,oauthClientSecret:'test-only-secret'});
try{
 const exchange=()=>oauthTeam.loginSsoCode('code','https://portal.jiezi-ai.com/team/oauth/callback','1','test-state');
 platformUsers.set('pat-admin',{username:'admin',disabled:false});
 const before=Date.now(),result=await exchange(),after=Date.now();
 assert.equal(result.platform.accessToken,'pat-admin');assert.equal(result.platform.refreshToken,'refresh-snake');assert.equal(result.user.name,'admin');assert.equal((await oauthTeam.authenticate(result.token)).name,'admin');
 assert.ok(result.platform.expiresTime>=before+3600000&&result.platform.expiresTime<=after+3600000);
 for(const [response,expected] of [
  [{code:0,data:{access_token:'pat-admin',accessToken:'wrong',refresh_token:'snake',refreshToken:'wrong',expiresTime:123,expires_time:456,expires_in:3600}},['snake',123]],
  [{code:0,data:{access_token:'pat-admin',expires_time:456,expires_in:3600}},['',456]],
  [{code:0,data:{accessToken:'pat-admin',refreshToken:'camel',expiresTime:789}},['camel',789]],
  [{access_token:'pat-admin',refresh_token:'top'},['top',0]],
 ]){oauthResponse=response;const session=await exchange();assert.equal(session.platform.accessToken,'pat-admin');assert.deepEqual([session.platform.refreshToken,session.platform.expiresTime],expected);}
 oauthResponse={access_token:'pat-admin',expires_in:60};const start=Date.now(),top=await exchange();assert.ok(top.platform.expiresTime>=start+60000&&top.platform.expiresTime<=Date.now()+60000);
 oauthResponse={code:0,data:{access_token:'pat-admin',refresh_token:'claim-refresh',expiresTime:1_700_000_000_000}};
 const claimedLogin=await oauthTeam.loginSsoCode('code','https://portal.jiezi-ai.com/team/oauth/callback','1','claim-state');
 assert.equal(claimedLogin.platform.accessToken,'pat-admin');
 const claimed=oauthTeam.claimPending('claim-state');
 assert.deepEqual(claimed.platform,{accessToken:'pat-admin',refreshToken:'claim-refresh',expiresTime:1_700_000_000_000});
 assert.throws(()=>oauthTeam.claimPending('claim-state'),e=>e.status===404);
 assert.throws(()=>oauthTeam.claimPending(''),e=>e.status===400);
 assert.throws(()=>oauthTeam.claimPending('missing'),e=>e.status===404);
 console.log('PASS OAuth snake_case exchange, authenticated session, expiry precedence, legacy fallbacks and one-time claim-by-state');
}finally{oauthTeam.close();}
console.log('PASS platform SSO upsert, role keep, disabled, 401, password lock, publish recheck and OAuth secret requirement');

ssoTeam.close();ssoTeam=undefined;await new Promise(resolve=>platform.close(resolve));platform=undefined;
}finally{if(server)await new Promise(resolve=>server.close(resolve));if(platform)await new Promise(resolve=>platform.close(resolve));team.close();ssoTeam?.close();await rm(dir,{recursive:true,force:true});}
