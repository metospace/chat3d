import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
try{
 const {fullRunDiagnostics,expandDiagnosticBundle}=await server.ssrLoadModule('/src/domain/runDiagnostics.ts');
 const roundtrip=snapshot=>{const bundle=JSON.parse(JSON.stringify(fullRunDiagnostics(snapshot)));return {bundle,data:expandDiagnosticBundle(bundle)};};
 check('geometry, images, prompts and request history are interned exactly once',()=>{
  const positions=Array.from({length:4096},(_,i)=>i/17),image='data:image/png;base64,'+'QUJD'.repeat(4096),system='shared system prompt '.repeat(500);
  const requests=Array.from({length:12},(_,i)=>({at:i,kind:'model_request',data:{model:'fixture',temperature:0,messages:[{role:'system',content:system},{role:'user',content:[{type:'text',text:'build machine'},{type:'image_url',image_url:{url:image}}]},...Array.from({length:i},(_,turn)=>({role:'assistant',content:'reply '+turn}))]}}));
  const snapshot={messages:[{id:'u1',role:'user',text:'build machine',images:[image]},{id:'a1',role:'assistant',text:'done',run:{activity:{diagnostics:requests}}}],lastRun:{diagnostics:structuredClone(requests)},doc:{nodes:Array.from({length:24},(_,i)=>({id:'n'+i,geometry:{positions:[...positions],normals:[...positions]}}))}};
  const {bundle,data}=roundtrip(snapshot),text=JSON.stringify(bundle);
  assert.deepEqual(data,snapshot);assert.equal(text.split(image).length-1,1);assert.equal(text.split(system).length-1,1);
  assert.equal(Object.values(bundle.artifacts).filter(value=>Array.isArray(value)&&value.length===positions.length&&value.every((n,i)=>n===positions[i])).length,1);
  assert.ok(text.length<JSON.stringify(snapshot).length/5);assert.ok(bundle.stats.deduplicatedValues>20);assert.equal(bundle.stats.retainedTasks,1);assert.equal(bundle.stats.uniqueImages,1);
  assert.equal(data.lastRun.diagnostics.length,12);assert.equal(data.lastRun.diagnostics[11].data.messages.length,13);assert.equal(bundle.index.tasks[0].path,'$.messages[0]');
 });
 check('embedded tool JSON becomes structured and deduplicates against scene geometry',()=>{
  const geometry={positions:Array.from({length:1200},(_,i)=>i*.125)},payload={mesh:geometry,ok:true};
  const json=JSON.stringify(payload,null,2),snapshot={doc:{geometry},lastRun:{diagnostics:[{at:1,kind:'tool_end',data:{result:{content:[{type:'text',text:json}]}}}]}};
  const {bundle,data}=roundtrip(snapshot);assert.deepEqual(JSON.parse(data.lastRun.diagnostics[0].data.result.content[0].text),payload);assert.deepEqual(data.doc.geometry,geometry);
  assert.ok(JSON.stringify(bundle).includes('$diagnosticEncoding'));assert.equal(Object.values(bundle.artifacts).filter(value=>Array.isArray(value)&&value.length===1200).length,1);
  assert.ok(bundle.omissions.some(item=>/Embedded JSON/.test(item.reason)));
 });
 check('privacy filters credentials in errors, nested JSON and shared references without deleting task content',()=>{
  const apiKey='configured-private-credential',image='data:image/png;base64,QUJD',script='bpy.ops.mesh.primitive_cube_add()';
  const failure=new Error('RuntimeError: network '+apiKey+' Bearer abcdef123456 sk-1234567890');failure.cause={Authorization:'private-header',password:'private-password',details:JSON.stringify({api_key:apiKey,script})};
  const {bundle,data}=roundtrip({diagnosticApiKey:apiKey,aiConfig:{apiKey,baseURL:'https://machine-config.example'},aiError:'HTTP 401 '+apiKey,messages:[{role:'user',text:'secret compartment; token of appreciation',images:[image]}],lastRun:{diagnostics:[{at:1,kind:'tool_end',data:{error:true,result:failure}}]}});
  const text=JSON.stringify(bundle);assert.doesNotMatch(text,/configured-private-credential|private-header|private-password|machine-config|abcdef123456|sk-1234567890/);assert.equal(data.aiConfig,undefined);assert.equal(data.diagnosticApiKey,undefined);
  assert.equal(data.messages[0].text,'secret compartment; token of appreciation');assert.equal(data.messages[0].images[0],image);
  assert.match(data.lastRun.diagnostics[0].data.result.message,/RuntimeError/);assert.equal(JSON.parse(data.lastRun.diagnostics[0].data.result.cause.details).script,script);assert.ok(bundle.omissions.some(item=>/Credential/.test(item.reason)));
 });
 check('successful stream deltas are summarized only with a following complete assistant message',()=>{
  const diagnostics=[{at:1,kind:'model_request',data:{messages:[{role:'user',content:'hello'}]}},{at:2,kind:'provider_event',data:[{choices:[{delta:{content:'hel'}}]},{choices:[{delta:{content:'lo'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2}}]},{at:3,kind:'message',data:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'hello'}]}}];
  const {bundle,data}=roundtrip({lastRun:{diagnostics}}),summary=data.lastRun.diagnostics[1].data;
  assert.equal(summary.eventCount,2);assert.deepEqual(summary.usage,[{prompt_tokens:5,completion_tokens:2}]);assert.deepEqual(summary.finishReasons,['stop']);assert.equal(summary.completeMessage.path,'$.lastRun.diagnostics[2].data');assert.equal(bundle.stats.providerEventsSummarized,2);assert.deepEqual(data.lastRun.diagnostics[2],diagnostics[2]);
 });
 check('failed, truncated and incomplete streams retain every provider event and request',()=>{
  for(const stop of ['length','content_filter','error',undefined]){
   const provider={at:2,kind:'provider_event',data:[{choices:[{delta:{content:'partial'},...(stop?{finish_reason:stop}:{})}]},...(stop==='error'?[{error:{code:'fixture',message:'network failure'}}]:[])]};
   const diagnostics=[{at:1,kind:'model_request',data:{messages:[{role:'user',content:'original task'}]}},provider,...(stop?[{at:3,kind:'message',data:{role:'assistant',stopReason:stop,content:[{type:'text',text:'partial'}]}}]:[])];
   const {bundle,data}=roundtrip({lastRun:{diagnostics}});assert.deepEqual(data.lastRun.diagnostics,diagnostics);assert.equal(bundle.stats.providerEventsSummarized,0);
  }
  const diagnostics=[{at:1,kind:'model_request',data:{}},{at:2,kind:'provider_event',data:[{error:{message:'failed'}}]},{at:3,kind:'message',data:{role:'assistant',stopReason:'stop',content:'answer'}}];
  assert.deepEqual(roundtrip({lastRun:{diagnostics}}).data.lastRun.diagnostics,diagnostics);
 });
 check('pending and history keep final document, commands, counts and errors but not intermediate snapshots',()=>{
  const command={op:'translate',targetId:'part',delta:[1,0,0]},doc={revision:3,nodes:[{id:'part'}]},step={command,before:{nodes:[{id:'part',name:'before'}],materialIds:['mat']},after:{nodes:[{id:'part',name:'after'}],materialIds:['mat']}};
  const snapshot={doc,pendingBatch:{operations:[command]},pendingResult:{doc,applied:[step],errors:[new Error('invalid geometry')]},past:[{summary:'move',bytes:10,docAfter:doc,applied:[step]}],future:[]};
  const {bundle,data}=roundtrip(snapshot);assert.deepEqual(data.doc,doc);assert.deepEqual(data.pendingResult.doc,doc);assert.equal(data.pendingResult.applied.count,1);assert.deepEqual(data.pendingResult.applied.operations[0].command,command);assert.equal(data.pendingResult.applied.operations[0].beforeNodeCount,1);assert.equal(data.pendingResult.applied.operations[0].beforeMaterialCount,1);assert.equal(data.past[0].docAfter,undefined);assert.equal(data.past[0].applied.operations[0].before,undefined);assert.equal(data.pendingResult.errors[0].message,'invalid geometry');assert.ok(bundle.omissions.some(item=>item.path==='$.past[0]'));
  assert.deepEqual(snapshot.pendingResult.applied[0].before,step.before);assert.equal(snapshot.past[0].docAfter,doc);
 });
 check('caller projected summaries and omission records remain accepted',()=>{
  const diagnosticOmissions=[{path:'$.past[0].docAfter',reason:'Projected away undo document before transfer.'}],snapshot={past:[{summary:'change',applied:[{command:{op:'rename',name:'fixture'},beforeNodeCount:1,afterNodeCount:1}]}],pendingResult:{doc:{nodes:[]},applied:{count:0,operations:[]}},diagnosticOmissions};
  const {bundle,data}=roundtrip(snapshot);assert.equal(data.past[0].applied.operations[0].beforeNodeCount,1);assert.ok(bundle.omissions.some(item=>item.reason===diagnosticOmissions[0].reason));assert.equal(data.diagnosticOmissions,undefined);
 });
 check('all reserved marker shapes remain literal user data, including nested encoded JSON',()=>{
  const fixtures=[{$diagnosticRef:'not-an-artifact'},{$diagnosticEncoding:'json',value:{a:1}},{$diagnosticLiteral:{hello:'world'}},{$diagnosticCycle:true}];
  const {data}=roundtrip({doc:{fixtures,encoded:JSON.stringify(fixtures)}});assert.deepEqual(data.doc.fixtures,fixtures);assert.deepEqual(JSON.parse(data.doc.encoded),fixtures);
  const object=JSON.parse('{"__proto__":{"polluted":true},"constructor":{"name":"literal"}}');assert.deepEqual(roundtrip({doc:object}).data.doc,object);assert.equal({}.polluted,undefined);
 });
 check('deep graphs and circular runtime edges cannot overflow or create cyclic output',()=>{
  const root={};let cursor=root;for(let i=0;i<12000;i++){cursor.child={};cursor=cursor.child;}cursor.value='end';
  const {bundle,data}=roundtrip({doc:root});cursor=data.doc;for(let i=0;i<12000;i++)cursor=cursor.child;assert.equal(cursor.value,'end');assert.ok(bundle.stats.artifacts>100);
  const cycle={name:'cycle'};cycle.self=cycle;const circular=roundtrip({doc:cycle});assert.deepEqual(circular.data.doc.self,{$diagnosticCycle:true});assert.ok(circular.bundle.omissions.some(item=>/Circular/.test(item.reason)));
 });
 check('expansion rejects missing and cyclic external artifact references deterministically',()=>{
  const base={format:'chat3d-diagnostics-v2',data:{$diagnosticRef:'a'},artifacts:{},omissions:[],stats:{}};
  assert.throws(()=>expandDiagnosticBundle(base),/Missing diagnostic artifact/);assert.throws(()=>expandDiagnosticBundle({...base,artifacts:{a:{$diagnosticRef:'a'}}}),/Cyclic diagnostic artifact/);
 });
 console.log(passed+' diagnostic bundle checks passed');
}finally{await server.close();}
