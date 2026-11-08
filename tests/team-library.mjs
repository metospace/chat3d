import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';
import {validateTeamPayload} from '../dist-team/validator.mjs';
const dir=await mkdtemp(join(tmpdir(),'chat3d-team-'));let team=openTeam(join(dir,'test.sqlite'));let server,platform,ssoTeam,legacyTeam,categoryTeam;
const scene={format:'chat3d-project',version:1,scene:{schemaVersion:1,projectId:'test-scene',revision:0,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]}};
const asset={format:'chat3d-model-asset',schemaVersion:1,id:'test-asset',version:1,name:'测试设备',category:'设备',createdAt:'2026-01-01T00:00:00.000Z',unit:'m',upAxis:'Y',front:'+Z',quality:'unreviewed',size:[1,1,1],externalConnectionsRemoved:0,nodes:[{id:'part',name:'部件',kind:'primitive',parentId:null,visible:true,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform:{position:[0,.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}],materials:[{id:'mat_gray',name:'灰色',baseColor:'#9099A4',roughness:.5,metalness:0}]};
const check=(label,fn)=>{fn();console.log('PASS '+label);};
try{
 const legacyPath=join(dir,'legacy.sqlite'),legacyUser={id:'legacy-user',name:'legacy',role:'member'};
 const legacyRequest={kind:'asset',name:'旧资产',description:'旧分类',payload:{...asset,category:'旧设备'},key:crypto.randomUUID(),expectedVersion:0};
 const legacyResult={id:'legacy-human',version:1},legacyDigest=createHash('sha256').update(JSON.stringify(legacyRequest)).digest('hex');
 const legacyCases=[
  ['legacy-human','asset',legacyRequest.payload,['旧设备']],
  ['legacy-uuid','asset',{...asset,category:'category-'+crypto.randomUUID()},[]],
  ['legacy-reserved','asset',{...asset,category:'未分类'},[]],
  ['legacy-control','asset',{...asset,category:'设备\u007f'},[]],
  ['legacy-long','asset',{...asset,category:'类'.repeat(81)},[]],
  ['legacy-empty','asset',{...asset,category:'  '},[]],
  ['legacy-missing','asset',{...asset,category:undefined},[]],
  ['legacy-trim','asset',{...asset,category:'  保留标签  '},['保留标签']],
  ['legacy-scene','scene',{...scene,category:'不能推断场景分类'},[]],
 ];
 const oldDb=new DatabaseSync(legacyPath);
 try{
  oldDb.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
   CREATE TABLE items(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,head INTEGER NOT NULL);
   CREATE TABLE versions(item TEXT NOT NULL REFERENCES items(id),version INTEGER NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(item,version));
   CREATE TABLE requests(user TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));`);
  oldDb.prepare('INSERT INTO users VALUES(?,?,?,?,?,0)').run(legacyUser.id,legacyUser.name,'old-salt','old-hash',legacyUser.role);
  for(const [id,kind,payload] of legacyCases){oldDb.prepare('INSERT INTO items VALUES(?,?,?,1)').run(id,legacyUser.id,kind);oldDb.prepare('INSERT INTO versions VALUES(?,1,?,?,?,?)').run(id,legacyRequest.name,legacyRequest.description,asset.createdAt,JSON.stringify(payload,null,2));}
  oldDb.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(legacyUser.id,legacyRequest.key,legacyDigest,JSON.stringify(legacyResult));
  assert.equal(oldDb.prepare('PRAGMA table_info(versions)').all().some(row=>row.name==='category_path'),false,'fixture is the actual pre-category schema');
 }finally{oldDb.close();}
 legacyTeam=openTeam(legacyPath);
 check('pre-category database migration backfills only human asset labels without rewriting payloads or retry records',()=>{
  for(const [id,kind,payload,path] of legacyCases){assert.deepEqual(legacyTeam.read(id,1).categoryPath,path);assert.deepEqual(legacyTeam.list(kind).find(row=>row.id===id).categoryPath,path);assert.equal(legacyTeam.db.prepare('SELECT payload FROM versions WHERE item=?').get(id).payload,JSON.stringify(payload,null,2));}
  assert.deepEqual({...legacyTeam.db.prepare('SELECT * FROM requests').get()},{user:legacyUser.id,key:legacyRequest.key,digest:legacyDigest,result:JSON.stringify(legacyResult)});
  assert.deepEqual(legacyTeam.publish(legacyUser,legacyRequest,validateTeamPayload),legacyResult);
  assert.equal(legacyTeam.db.prepare('SELECT count(*) AS n FROM versions').get().n,legacyCases.length);
 });
 const clearedRequest={...legacyRequest,itemId:legacyResult.id,expectedVersion:1,key:crypto.randomUUID(),categoryPath:[]};
 const cleared=legacyTeam.publish(legacyUser,clearedRequest,validateTeamPayload);
 legacyTeam.close();legacyTeam=undefined;legacyTeam=openTeam(legacyPath);
 check('migration reopens idempotently and never re-infers deliberately unclassified versions',()=>{
  assert.equal(legacyTeam.db.prepare('PRAGMA table_info(versions)').all().filter(row=>row.name==='category_path').length,1);
  assert.deepEqual(legacyTeam.read(legacyResult.id,1).categoryPath,['旧设备']);assert.deepEqual(legacyTeam.read(cleared.id,cleared.version).categoryPath,[]);
  assert.deepEqual(legacyTeam.list('asset').find(row=>row.id===cleared.id).categoryPath,[]);
  assert.deepEqual(legacyTeam.publish(legacyUser,legacyRequest,validateTeamPayload),legacyResult);assert.deepEqual(legacyTeam.publish(legacyUser,clearedRequest,validateTeamPayload),cleared);
  assert.equal(legacyTeam.db.prepare('SELECT payload FROM versions WHERE item=? AND version=1').get(legacyResult.id).payload,JSON.stringify(legacyRequest.payload,null,2));
  assert.equal(legacyTeam.db.prepare('SELECT digest FROM requests WHERE key=?').get(legacyRequest.key).digest,legacyDigest);
 });
 legacyTeam.close();legacyTeam=undefined;
 categoryTeam=openTeam(join(dir,'categories.sqlite'));const publisher=categoryTeam.provision('publisher','isolated-category-password');
 const categoryRequest={kind:'asset',name:'层级资产',description:'固定分类',payload:asset,key:crypto.randomUUID(),expectedVersion:0,categoryPath:['  设备  ']};
 const categoryFirst=categoryTeam.publish(publisher,categoryRequest,validateTeamPayload);
 const categorySecond=categoryTeam.publish(publisher,{...categoryRequest,itemId:categoryFirst.id,expectedVersion:1,key:crypto.randomUUID(),categoryPath:['设备','  检测设备  ']},validateTeamPayload);
 const sceneCategory=categoryTeam.publish(publisher,{kind:'scene',name:'层级场景',payload:scene,key:crypto.randomUUID(),categoryPath:['设备','场景专属']},validateTeamPayload);
 check('category snapshots expose latest root/child labels while fixed old reads and kinds stay independent',()=>{
  assert.deepEqual(categoryTeam.read(categoryFirst.id,1).categoryPath,['设备']);assert.deepEqual(categoryTeam.read(categorySecond.id,2).categoryPath,['设备','检测设备']);
  assert.deepEqual(categoryTeam.list('asset').map(row=>[row.id,row.version,row.categoryPath]),[[categoryFirst.id,2,['设备','检测设备']]]);
  assert.deepEqual(categoryTeam.list('scene').map(row=>[row.id,row.categoryPath]),[[sceneCategory.id,['设备','场景专属']]]);
  assert.deepEqual(categoryTeam.read(categoryFirst.id,1).payload,asset);assert.deepEqual(categoryTeam.read(categorySecond.id,2).payload,asset);
  assert.deepEqual(categoryRequest.categoryPath,['  设备  '],'normalization does not mutate the retry body');assert.deepEqual(categoryTeam.publish(publisher,categoryRequest,validateTeamPayload),categoryFirst);
  assert.throws(()=>categoryTeam.publish(publisher,{...categoryRequest,categoryPath:['设备']},validateTeamPayload),e=>e.status===409,'digest still covers the unmodified request');
 });
 check('omitted paths infer only legacy asset labels and explicit empty paths override inference',()=>{
  for(const [kind,payload,explicit,expected] of [['asset',asset,undefined,['设备']],['asset',{...asset,category:'category-'+crypto.randomUUID()},undefined,[]],['scene',scene,undefined,[]],['asset',asset,[],[]],['scene',scene,['类'.repeat(80)],['类'.repeat(80)]]]){
   const body={kind,name:'分类兼容',payload,key:crypto.randomUUID(),...(explicit===undefined?{}:{categoryPath:explicit})};const result=categoryTeam.publish(publisher,body,validateTeamPayload);assert.deepEqual(categoryTeam.read(result.id,1).categoryPath,expected);
  }
 });
 check('invalid category paths reject atomically for new items and updates without consuming retry keys',()=>{
  const snapshot=()=>({items:categoryTeam.db.prepare('SELECT * FROM items ORDER BY id').all(),versions:categoryTeam.db.prepare('SELECT * FROM versions ORDER BY item,version').all(),requests:categoryTeam.db.prepare('SELECT * FROM requests ORDER BY user,key').all()});
  const before=snapshot(),invalid=[null,'设备',{},['设备','检测','三级'],[''],['  '],[17],[null],['设备',false],['全部'],[' 未分类 '],['类'.repeat(81)],['前\u0000后'],['前\n后'],['\t设备'],['前\u007f后'],['前\u0085后'],['category-'+crypto.randomUUID()]];
  const reusableKey=crypto.randomUUID();
  for(const categoryPath of invalid){for(const target of [{},{itemId:categoryFirst.id,expectedVersion:2}])assert.throws(()=>categoryTeam.publish(publisher,{...categoryRequest,...target,key:reusableKey,categoryPath},validateTeamPayload),e=>e.status===400);assert.deepEqual(snapshot(),before);}
  assert.equal(categoryTeam.publish(publisher,{...categoryRequest,key:reusableKey,categoryPath:['有效分类']},validateTeamPayload).version,1);
 });
 categoryTeam.close();categoryTeam=undefined;
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
 const httpCategoryRequest={...request,itemId:first.id,expectedVersion:3,key:crypto.randomUUID(),categoryPath:['  场景目录  ','装配车间']};
 const httpCategory=await call('publish',{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify(httpCategoryRequest)});assert.equal(httpCategory.status,200);assert.deepEqual(await httpCategory.json(),{id:first.id,version:4});
 const httpHeads=await call('items?kind=scene',{headers:{Authorization:`Bearer ${b.token}`}}),httpHead=(await httpHeads.json()).find(row=>row.id===first.id);assert.equal(httpHead.version,4);assert.deepEqual(httpHead.categoryPath,['场景目录','装配车间']);assert.equal('category_path' in httpHead,false);
 const httpOld=await call(`items/${first.id}/1`,{headers:{Authorization:`Bearer ${b.token}`}}),httpNew=await call(`items/${first.id}/4`,{headers:{Authorization:`Bearer ${b.token}`}});assert.deepEqual((await httpOld.json()).categoryPath,[]);assert.deepEqual((await httpNew.json()).categoryPath,['场景目录','装配车间']);
 const httpBad=await call('publish',{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify({...httpCategoryRequest,expectedVersion:4,key:crypto.randomUUID(),categoryPath:['未分类']})});assert.equal(httpBad.status,400);assert.equal(team.list('scene').find(row=>row.id===first.id).version,4);
 console.log('PASS HTTP category snapshots roundtrip without altering fixed old versions or accepting invalid paths');
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
}finally{if(server)await new Promise(resolve=>server.close(resolve));if(platform)await new Promise(resolve=>platform.close(resolve));team.close();ssoTeam?.close();legacyTeam?.close();categoryTeam?.close();await rm(dir,{recursive:true,force:true});}
