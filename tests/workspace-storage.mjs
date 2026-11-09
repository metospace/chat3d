import assert from 'node:assert/strict';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {createServer} from 'vite';
globalThis.indexedDB=indexedDB;
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let count=0;const test=async(name,f)=>{await f();console.log('PASS',name);count++};
const dbname='chat3d.workspace.v1';
const seed=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbname,1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({version:1,revision:4,activeId:'a',sessions:[{id:'a',title:'existing',snapshot:{doc:{nodes:[{id:'preserved'}]},messages:[],lastRun:null,pendingBatch:null,pendingResult:null,extra:undefined}}]},'current');tx.oncomplete=()=>{db.close();resolve()}}});
const fieldKey=(id,field)=>JSON.stringify(['session',id,field]);
const withStore=(mode,run)=>new Promise((resolve,reject)=>{const r=indexedDB.open(dbname,2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspace',mode);let result;tx.oncomplete=()=>{db.close();resolve(result)};tx.onabort=()=>{db.close();reject(tx.error??Error('transaction aborted'))};run(tx.objectStore('workspace'),value=>{result=value})}});
const records=()=>withStore('readonly',(store,done)=>{const keys=store.getAllKeys(),values=store.getAll();values.onsuccess=()=>done(keys.result.map((key,i)=>[key,values.result[i]]))});
try{
 await seed();const storage=await server.ssrLoadModule('/src/domain/workspaceStorage.ts');let pack=await storage.readWorkspace();
 await test('legacy data migrates atomically without dropping geometry or undefined fields',async()=>{assert.equal(pack.revision,4);await storage.writeWorkspace(pack,4);pack=await storage.readWorkspace();assert.equal(pack.revision,5);assert.equal(pack.sessions[0].snapshot.doc.nodes[0].id,'preserved');assert.ok('extra' in pack.sessions[0].snapshot)});
 await test('progress update leaves committed geometry and history records untouched',async()=>{const writes=[];const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){writes.push(key);return original.call(this,value,key)};try{const session=pack.sessions[0];const next={...pack,sessions:[{...session,snapshot:{...session.snapshot,lastRun:{turn:2}}}]};await storage.writeWorkspace(next,pack.revision);assert.ok(writes.includes('current'));assert.ok(writes.includes(fieldKey('a','lastRun')));for(const key of writes){if(key==='current')continue;const tuple=JSON.parse(key);assert.ok(tuple[2]===null||tuple[2]==='lastRun',`unchanged field rewritten: ${key}`)}pack=await storage.readWorkspace();assert.equal(pack.sessions[0].snapshot.lastRun.turn,2)}finally{IDBObjectStore.prototype.put=original}});
 await test('new geometry and checkpoint persist together and read back unchanged',async()=>{const session=pack.sessions[0];const snap={...session.snapshot,doc:{nodes:[{id:'edited'}]},pendingBatch:{baseRevision:1},pendingResult:{doc:{nodes:[{id:'draft'}]}}};await storage.writeWorkspace({...pack,sessions:[{...session,snapshot:snap}]},pack.revision);pack=await storage.readWorkspace();assert.deepEqual(pack.sessions[0].snapshot,snap)});
 await test('removing sessions and fields reclaims records and preserves every remaining field',async()=>{
  const session=pack.sessions[0],removed={id:'removed',title:'temporary',snapshot:{doc:{nodes:[{id:'remove-me'}]},messages:[{text:'temporary'}],extra:undefined}};
  await storage.writeWorkspace({...pack,sessions:[session,removed]},pack.revision);pack=await storage.readWorkspace();
  const {extra,...snapshot}=pack.sessions[0].snapshot;const remaining={...pack.sessions[0],snapshot};
  await storage.writeWorkspace({...pack,sessions:[remaining]},pack.revision);pack=await storage.readWorkspace();
  assert.deepEqual(pack.sessions,[remaining]);const keys=(await records()).map(([key])=>key);
  for(const key of keys){if(key==='current')continue;const tuple=JSON.parse(key);assert.equal(tuple[1],remaining.id);assert.ok(tuple[2]===null||Object.hasOwn(snapshot,tuple[2]))}
 });
 await test('the next write sweeps legacy orphans while preserving referenced geometry',async()=>{
  const orphans=[fieldKey('forgotten','doc'),fieldKey('a','obsolete')];
  await withStore('readwrite',store=>{for(const key of orphans)store.put({value:{nodes:[{id:'orphan'}]}},key)});
  const revision=await storage.writeWorkspace(pack,pack.revision);pack={...pack,revision};
  const keys=(await records()).map(([key])=>key);for(const key of orphans)assert.ok(!keys.includes(key));
  assert.deepEqual(await storage.readWorkspace(),pack);
 });
 await test('soft-deleted sessions retain their full snapshots through reclamation',async()=>{
  const recycled={id:'recycled',title:'in trash',deletedAt:123,snapshot:{doc:{nodes:[{id:'restorable'}]},messages:[{text:'keep history'}],lastRun:{turn:3},pendingBatch:{baseRevision:2},pendingResult:{doc:{nodes:[{id:'keep draft'}]}},extra:undefined}};
  await storage.writeWorkspace({...pack,sessions:[...pack.sessions,recycled]},pack.revision);pack=await storage.readWorkspace();
  const active=pack.sessions[0];await storage.writeWorkspace({...pack,sessions:[{...active,snapshot:{...active.snapshot,lastRun:{turn:4}}},pack.sessions[1]]},pack.revision);pack=await storage.readWorkspace();
  assert.deepEqual(pack.sessions[1],recycled);
  // Read behavior, not the former unchunked {value} representation, is the contract.
  assert.ok('extra' in pack.sessions[1].snapshot);
 });
 await test('stale revisions cannot remove or overwrite newer records',async()=>{const before=await records();await assert.rejects(()=>storage.writeWorkspace({...pack,sessions:[{id:'stale',snapshot:{doc:{nodes:[{id:'wrong'}]}}}]},pack.revision-1),/另一个标签页/);assert.deepEqual(await records(),before);assert.deepEqual(await storage.readWorkspace(),pack)});
 await test('older app database version cannot overwrite upgraded storage',async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open(dbname,1);r.onerror=()=>{assert.equal(r.error.name,'VersionError');resolve()};r.onsuccess=()=>{r.result.close();reject(Error('old database reopened'))}})});
 await test('aborted serialization leaves previous revision and data intact',async()=>{const bad={...pack,sessions:[{...pack.sessions[0],snapshot:{...pack.sessions[0].snapshot,lastRun:()=>{}}}]};await assert.rejects(()=>storage.writeWorkspace(bad,pack.revision));const restored=await storage.readWorkspace();assert.equal(restored.revision,pack.revision);assert.deepEqual(restored.sessions,pack.sessions)});
 await test('aborted reclamation rolls back fields and manifest without advancing the identity cache',async()=>{
  const before=await records(),session=pack.sessions[0],{messages,...snapshot}=session.snapshot;
  const next={...pack,sessions:[{...session,snapshot:{...snapshot,doc:{nodes:[{id:'committed-only-on-retry'}]},newField:{saved:true}}}]};
  const original=IDBObjectStore.prototype.delete;let deletes=0;
  IDBObjectStore.prototype.delete=function(key){const request=original.call(this,key);deletes++;request.onsuccess=()=>this.transaction.abort();return request};
  try{await assert.rejects(()=>storage.writeWorkspace(next,pack.revision),/会话保存失败/)}finally{IDBObjectStore.prototype.delete=original}
  assert.equal(deletes,1);assert.deepEqual(await records(),before);
  // Retry the exact same object identities without a read resetting the cache.
  const revision=await storage.writeWorkspace(next,pack.revision);pack=await storage.readWorkspace();
  assert.equal(pack.revision,revision);assert.deepEqual(pack.sessions,next.sessions);
  const keys=(await records()).map(([key])=>key);assert.ok(!keys.some(key=>key!=='current'&&JSON.parse(key)[2]==='messages'));
 });
 await test('v2 field wrappers remain readable and migrate with undefined intact',async()=>{
  const legacy={storageVersion:2,version:1,revision:pack.revision+1,activeId:'v2',sessions:[{metadata:{id:'v2',title:'legacy fields'},fields:['doc','extra']}]};
  await withStore('readwrite',store=>{store.put(legacy,'current');store.put({value:{nodes:[{id:'legacy-v2'}]}},fieldKey('v2','doc'));store.put({value:undefined},fieldKey('v2','extra'))});
  pack=await storage.readWorkspace();assert.equal(pack.sessions[0].snapshot.doc.nodes[0].id,'legacy-v2');assert.ok(Object.hasOwn(pack.sessions[0].snapshot,'extra'));
  await storage.writeWorkspace(pack,pack.revision);assert.deepEqual(await storage.readWorkspace(),{...pack,revision:pack.revision+1});pack=await storage.readWorkspace();
 });
 await test('bounded records preserve nested meshes, long strings, aliases, holes and own prototype-named fields',async()=>{
  const {IDB_GRAPH_ARRAY_CHUNK,IDB_GRAPH_STRING_CHUNK}=await server.ssrLoadModule('/src/domain/idbChunks.ts');
  const positions=Array.from({length:IDB_GRAPH_ARRAY_CHUNK*5+7},(_,i)=>i%97/13),indices=Array.from({length:IDB_GRAPH_ARRAY_CHUNK*3+1},(_,i)=>i%Math.floor(positions.length/3));
  const sparse=new Array(8);sparse[2]=undefined;sparse[5]=positions;sparse.note='array property';
  const ownNames={};Object.defineProperty(ownNames,'__proto__',{value:{safe:true},enumerable:true});ownNames.constructor={prototype:{safe:true}};
  const doc={nodes:[{id:'large-mesh',geometry:{type:'mesh',params:{positions,indices,normals:positions,optional:undefined}}}],source:'雪😀'.repeat(IDB_GRAPH_STRING_CHUNK),sparse,ownNames};doc.self=doc;
  const next={...pack,sessions:[{id:'bounded',title:'large model',snapshot:{doc,pendingResult:{doc},extra:undefined}}]};
  const put=IDBObjectStore.prototype.put,stringify=JSON.stringify,slice=Array.prototype.slice;let checked=0,maxArray=0,maxString=0;
  IDBObjectStore.prototype.put=function(value,key){
   const pending=[value],seen=new Set();
   while(pending.length){const item=pending.pop();if(typeof item==='string'){maxString=Math.max(maxString,item.length);if(item.length>IDB_GRAPH_STRING_CHUNK)throw new DOMException('simulated single-record string limit','QuotaExceededError');continue}if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);if(Array.isArray(item)){maxArray=Math.max(maxArray,item.length);if(item.length>IDB_GRAPH_ARRAY_CHUNK)throw new DOMException('simulated single-record array limit','QuotaExceededError')}for(const property in item)if(Object.hasOwn(item,property))pending.push(item[property]);}
   checked++;return put.call(this,value,key);
  };
  JSON.stringify=function(value,...args){assert.ok(Array.isArray(value)&&value.length<=5,'whole document serialization is forbidden');return stringify.call(this,value,...args)};
  Array.prototype.slice=function(start,end){assert.ok(this.length<=IDB_GRAPH_ARRAY_CHUNK||(end!==undefined&&end-(start??0)<=IDB_GRAPH_ARRAY_CHUNK),'unbounded array clone is forbidden');return slice.call(this,start,end)};
  try{await storage.writeWorkspace(next,pack.revision)}finally{IDBObjectStore.prototype.put=put;JSON.stringify=stringify;Array.prototype.slice=slice}
  assert.ok(checked>10);assert.ok(maxArray<=IDB_GRAPH_ARRAY_CHUNK);assert.ok(maxString<=IDB_GRAPH_STRING_CHUNK);
  pack=await storage.readWorkspace();assert.deepEqual(pack.sessions,next.sessions);
  const restored=pack.sessions[0].snapshot.doc;assert.equal(restored.self,restored);assert.equal(restored.nodes[0].geometry.params.positions,restored.nodes[0].geometry.params.normals);
  assert.equal(0 in restored.sparse,false);assert.equal(2 in restored.sparse,true);assert.equal(restored.sparse.note,'array property');
  assert.equal(Object.getPrototypeOf(restored.ownNames),Object.prototype);assert.deepEqual(restored.ownNames.__proto__,{safe:true});assert.equal({}.safe,undefined);
 });
 await test('mid-chunk failure rolls back revision, fragments and cache and retries the same graph identities',async()=>{
  const before=await records(),session=pack.sessions[0],oldDoc=session.snapshot.doc;
  const doc={...oldDoc,nodes:[{...oldDoc.nodes[0],geometry:{type:'mesh',params:{positions:Array.from({length:100003},(_,i)=>i/10),indices:[0,1,2]}}}]};
  const next={...pack,sessions:[{...session,snapshot:{...session.snapshot,doc}}]},original=IDBObjectStore.prototype.put;let chunks=0;
  IDBObjectStore.prototype.put=function(value,key){if(typeof key==='string'&&key!=='current'&&JSON.parse(key)[2]==='doc'&&value?.parts&&++chunks===3)throw new DOMException('simulated record failure','QuotaExceededError');return original.call(this,value,key)};
  try{await assert.rejects(()=>storage.writeWorkspace(next,pack.revision),/存储空间已满/)}finally{IDBObjectStore.prototype.put=original}
  assert.equal(chunks,3);assert.deepEqual(await records(),before);
  // Do not read before retry: the failed write must not cache these new identities.
  const revision=await storage.writeWorkspace(next,pack.revision);pack=await storage.readWorkspace();assert.equal(pack.revision,revision);assert.deepEqual(pack.sessions,next.sessions);
 });
 await test('missing graph fragments fail closed without replacing committed workspace',async()=>{
  const before=await records(),chunk=before.find(([key])=>key!=='current'&&JSON.parse(key)[2]==='doc'&&JSON.parse(key)[3]==='chunk');assert.ok(chunk);
  await withStore('readwrite',store=>store.delete(chunk[0]));await assert.rejects(()=>storage.readWorkspace(),/数据不完整/);
  await withStore('readwrite',store=>store.put(chunk[1],chunk[0]));assert.deepEqual(await storage.readWorkspace(),pack);
 });
 console.log(`${count} workspace storage checks passed`);
}finally{await server.close()}
