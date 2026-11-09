import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {openPublicationUploads,TEAM_UPLOAD_MAX_BYTES} from '../server/team/publishUploads.mjs';
const vite=await createServer({configFile:false,cacheDir:`node_modules/.vite-team-publish-${process.pid}`,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,ws:false,watch:null},appType:'custom'}),originalFetch=globalThis.fetch,originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
const dir=await mkdtemp(join(tmpdir(),'team-gzip-')),db=new DatabaseSync(':memory:');
try{
 const {sendTeamPublication,compressTeamPublication,readTeamPublication,TEAM_PUBLISH_TIMEOUT_MS,TEAM_PUBLISH_MAX_BYTES}=await vite.ssrLoadModule('/src/domain/teamPublish.ts');
 const chunkBytes=1024*1024,hash=value=>createHash('sha256').update(value).digest('hex');
 const fingerprint=bytes=>hash(Array.from({length:Math.ceil(bytes.length/chunkBytes)},(_,index)=>hash(bytes.subarray(index*chunkBytes,(index+1)*chunkBytes))).join(''));
 const key='gzip-publication-key-0001',body=JSON.stringify({key,payload:'x'.repeat(256*1024-23)+'😀中é文'.repeat(100000),noise:randomBytes(3*1024*1024).toString('base64')}),publication=await compressTeamPublication(body);
 assert.equal(publication.encoding,'gzip');assert.deepEqual(publication,await compressTeamPublication(body));assert.equal(gunzipSync(publication.data).toString('utf8'),body);assert.deepEqual(readTeamPublication(publication),JSON.parse(body));assert.equal(publication.digest,fingerprint(publication.data));assert.ok(publication.data.length>2*chunkBytes);assert.ok(publication.data.length<Buffer.byteLength(body));
 for(const value of ['', 'x'.repeat(256*1024-1)+'😀', '中😀文', '\ud800'])assert.equal(gunzipSync((await compressTeamPublication(value)).data).toString('utf8'),Buffer.from(value).toString('utf8'));
 assert.equal(TEAM_PUBLISH_MAX_BYTES,500*1024*1024);assert.equal(TEAM_UPLOAD_MAX_BYTES,TEAM_PUBLISH_MAX_BYTES);
 await assert.rejects(compressTeamPublication('x'.repeat(TEAM_PUBLISH_MAX_BYTES+1)),/500 MiB/);
 await assert.rejects(sendTeamPublication('https://team.example','token',{encoding:'gzip',data:{byteLength:TEAM_PUBLISH_MAX_BYTES+1},digest:'0'.repeat(64)},undefined,key),/500 MiB/);
 console.log('PASS deterministic gzip, SHA-256 chunk fingerprint, surrogate-safe exact UTF-8 and 500 MiB package bounds');
 let offset=0,failOnce=true,completed=false,calls=0;const stages=[],uploaded=[];
 globalThis.fetch=async(url,init)=>{
  calls++;assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,'Bearer session-token');assert.ok(Buffer.byteLength(init.body)<2*1024*1024);assert.equal(init.signal.aborted,false);
  const data=JSON.parse(init.body),state=()=>({uploadId:'upload-gzip-1',offset,total:publication.data.length,encoding:'gzip',...(completed?{result:{id:'fixed-result',version:1}}:{})});
  if(url.endsWith('/start')){assert.deepEqual(data,{key,total:publication.data.length,digest:publication.digest,encoding:'gzip'});return Response.json(state());}
  if(url.endsWith('/chunk')){const chunk=Buffer.from(data.data,'base64');assert.equal(data.offset,offset);assert.deepEqual(chunk,Buffer.from(publication.data.subarray(offset,offset+chunk.length)));uploaded.push(offset);offset+=chunk.length;if(failOnce){failOnce=false;throw Error('Failed at https://secret.invalid/?token=hidden');}return Response.json(state());}
  assert.ok(url.endsWith('/complete'));assert.equal(offset,publication.data.length);completed=true;return Response.json({id:'fixed-result',version:1});
 };
 await assert.rejects(sendTeamPublication('https://team.example/private?token=hidden','session-token',publication,p=>stages.push(p),key),error=>{assert.match(error.message,/https:\/\/team.example/);assert.match(error.message,/代理/);assert.doesNotMatch(error.message,/hidden|secret\.invalid|private/);return true;});
 assert.equal(calls,2);assert.equal(offset,chunkBytes);assert.equal(stages.filter(p=>p.phase==='uploading').at(-1).loaded,0);
 assert.deepEqual(await (await sendTeamPublication('https://team.example','session-token',publication,p=>stages.push(p),key)).json(),{id:'fixed-result',version:1});assert.deepEqual(uploaded,Array.from({length:Math.ceil(publication.data.length/chunkBytes)},(_,index)=>index*chunkBytes));assert.equal(stages.at(-1).loaded,publication.data.length);
 const before=calls;await sendTeamPublication('https://team.example','session-token',publication,undefined,key);assert.equal(calls,before+1);
 const tiny=await compressTeamPublication(JSON.stringify({key,payload:'小模型'}));let tinyCalls=0;
 globalThis.fetch=async(url,init)=>{tinyCalls++;const data=JSON.parse(init.body);if(url.endsWith('/complete'))return Response.json({id:'tiny-result',version:1});return Response.json({uploadId:'tiny-upload',offset:url.endsWith('/start')?0:tiny.data.length,total:tiny.data.length,encoding:'gzip'});};
 await sendTeamPublication('https://team.example','token',tiny,undefined,key);assert.equal(tinyCalls,3,'small packages use start/chunk/complete too');
 globalThis.fetch=async()=>new Response('not deployed',{status:404});await assert.rejects(sendTeamPublication('https://team.example','token',tiny,undefined,key),/升级.*publish-uploads/);
 globalThis.fetch=async()=>Response.json({error:'团队登录已失效'},{status:401});assert.equal((await sendTeamPublication('https://team.example','bad',tiny,undefined,key)).status,401);
 for(const encoding of [undefined,'json']){globalThis.fetch=async()=>Response.json({uploadId:'wrong-encoding',offset:0,total:tiny.data.length,encoding});await assert.rejects(sendTeamPublication('https://team.example','token',tiny,undefined,key),/状态无效/);}
 globalThis.fetch=async()=>Response.json({uploadId:'invalid-confirmation',offset:0,total:tiny.data.length,encoding:'gzip'});await assert.rejects(sendTeamPublication('https://team.example','token',tiny,undefined,key),/未确认/);
 let expire;const deadlineTimer=Symbol('publication-deadline');globalThis.setTimeout=(fn,ms,...args)=>{if(ms!==TEAM_PUBLISH_TIMEOUT_MS)return originalSetTimeout(fn,ms,...args);expire=fn;return deadlineTimer;};globalThis.clearTimeout=timer=>{if(timer!==deadlineTimer)originalClearTimeout(timer);};
 globalThis.fetch=(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(Error('Request canceled')),{once:true});expire();});
 await assert.rejects(sendTeamPublication('https://team.example','token',tiny,undefined,key),/15 分钟.*https:\/\/team.example/);
 console.log('PASS every-size chunks, confirmed compressed-byte progress, failed-only resume, completed retry, encoding checks, missing deployment and timeout without fallback');
 // Migrate a database containing an unfinished legacy JSON upload, retaining its key binding.
 db.exec('CREATE TABLE publish_uploads(id TEXT PRIMARY KEY,user TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,total INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,result TEXT,UNIQUE(user,key))');
 const legacyKey='legacy-publication-key',legacyBytes=Buffer.from(JSON.stringify({key:legacyKey,payload:'旧上传'}));
 db.prepare('INSERT INTO publish_uploads(id,user,key,digest,total) VALUES(?,?,?,?,?)').run('legacy-upload','alice',legacyKey,fingerprint(legacyBytes),legacyBytes.length);
 const uploads=openPublicationUploads(db,dir),user={id:'alice',role:'member'};
 const upload=async(bytes,encoding='gzip',uploadKey=crypto.randomUUID())=>{
  const start=uploads.start(user,{key:uploadKey,total:bytes.length,digest:fingerprint(bytes),encoding});
  for(let cursor=start.offset;cursor<bytes.length;cursor+=chunkBytes){const part=bytes.subarray(cursor,cursor+chunkBytes);const confirmed=uploads.chunk(user,start.uploadId,{offset:cursor,data:Buffer.from(part).toString('base64')});assert.equal(confirmed.offset,cursor+part.length);assert.equal(confirmed.encoding,encoding);}
  return start;
 };
 const legacy=await upload(legacyBytes,'json',legacyKey);assert.equal(legacy.uploadId,'legacy-upload');assert.deepEqual(await uploads.complete(user,legacy.uploadId,async value=>({id:value.payload,version:1})),{id:'旧上传',version:1});
 const valid=await upload(Buffer.from(tiny.data),'gzip',key);let publishCount=0;const publish=async value=>{publishCount++;assert.equal(value.payload,'小模型');return {id:'server-fixed',version:1};};
 assert.deepEqual(await uploads.complete(user,valid.uploadId,publish),{id:'server-fixed',version:1});await uploads.complete(user,valid.uploadId,publish);assert.equal(publishCount,1);
 assert.throws(()=>uploads.start(user,{key,total:tiny.data.length,digest:tiny.digest,encoding:'json'}),error=>error.status===409);
 assert.throws(()=>uploads.start({id:'alice',role:'viewer'},{key,total:1,digest:'0'.repeat(64),encoding:'gzip'}),error=>error.status===403);
 assert.throws(()=>uploads.start(user,{key:crypto.randomUUID(),total:TEAM_UPLOAD_MAX_BYTES+1,digest:'0'.repeat(64),encoding:'gzip'}),error=>error.status===400);
 assert.equal(uploads.start(user,{key:crypto.randomUUID(),total:TEAM_UPLOAD_MAX_BYTES,digest:'0'.repeat(64),encoding:'gzip'}).total,TEAM_UPLOAD_MAX_BYTES);
 for(const bytes of [Buffer.from('not gzip'),Buffer.from(tiny.data).subarray(0,tiny.data.length-4),gzipSync(Buffer.from('{broken'))]){const invalid=await upload(bytes);await assert.rejects(uploads.complete(user,invalid.uploadId,publish),error=>error.status===400);}
 // Concatenated gzip members expand beyond the cap without allocating an enormous input.
 const member=gzipSync(Buffer.alloc(chunkBytes)),bomb=await upload(Buffer.concat(Array(501).fill(member)));
 await assert.rejects(uploads.complete(user,bomb.uploadId,publish),error=>error.status===400&&/500 MiB/.test(error.message));
 console.log('PASS persisted JSON migration, gzip completion/idempotency, immutable encoding, permissions, declared bounds and corrupt/bomb rejection');
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;db.close();await rm(dir,{recursive:true,force:true});await vite.close();}
