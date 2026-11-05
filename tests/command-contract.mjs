import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const clone=value=>structuredClone(value);
const transform={position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]};
const geometry={type:'box',params:{width:1,height:1,depth:1}};
const part={name:'body',geometry,transform,materialId:'mat_gray'};
const animation={version:1,name:'move',duration:2,loop:true,tracks:[{id:'move',name:'move',targetIds:['n1'],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:2,value:[1,0,0]}]}]};
const samples={
 setAnimation:{op:'setAnimation',animation},
 clearAnimation:{op:'clearAnimation'},
 transformAssembly:{op:'transformAssembly',targetId:'n1',rotationDegrees:[0,45,0]},
 appendAssemblyParts:{op:'appendAssemblyParts',targetId:'n1',parts:[part]},
 replaceAssemblyParts:{op:'replaceAssemblyParts',targetId:'n1',partIds:['n1'],parts:[part]},
 createPrimitive:{op:'createPrimitive',name:'body',parentId:null,tempId:'body',geometry,transform,materialId:'mat_gray'},
 createAssembly:{op:'createAssembly',name:'assembly',parts:[part]},
 duplicateAssembly:{op:'duplicateAssembly',targetId:'n1',offset:[2,0,0]},
 translateAssembly:{op:'translateAssembly',targetId:'n1',value:[1,0,0]},
 updateParameters:{op:'updateParameters',targetId:'n1',geometry},
 setTransform:{op:'setTransform',targetId:'n1',transform:{position:[1,2,3]}},
 translate:{op:'translate',targetId:'n1',space:'world',mode:'delta',value:[1,0,0]},
 rename:{op:'rename',targetId:'n1',name:'renamed'},
 setVisibility:{op:'setVisibility',targetId:'n1',visible:false},
 delete:{op:'delete',targetId:'n1'},
 setMaterial:{op:'setMaterial',targetId:'n1',materialId:'mat_blue'},
 setAppearance:{op:'setAppearance',targetId:'n1',baseColor:'#123456'},
 setAssemblyMetadata:{op:'setAssemblyMetadata',targetId:'n1',sceneRole:'equipment'},
};
const without=(value,...keys)=>{const result=clone(value);for(const key of keys)delete result[key];return result;};
const missingFields={
 setAnimation:['animation'],clearAnimation:[],transformAssembly:['targetId'],
 appendAssemblyParts:['targetId','parts'],replaceAssemblyParts:['targetId','partIds','parts'],
 createPrimitive:['geometry'],createAssembly:['name','parts'],duplicateAssembly:['targetId','offset'],
 translateAssembly:['targetId','value'],updateParameters:['targetId'],setTransform:['targetId','transform'],
 translate:['targetId','value'],rename:['targetId','name'],setVisibility:['targetId','visible'],
 delete:['targetId'],setMaterial:['targetId','materialId'],setAppearance:['targetId'],setAssemblyMetadata:['targetId'],
};
const fakeTransport=steps=>{
 let calls=0;
 const contexts=[];
 const fn=async(_model,context)=>{
  contexts.push(clone(context));
  const step=steps[calls++]??'保留未验收数据草稿';
  const actions=typeof step==='function'?step(context):step;
  const content=Array.isArray(actions)?actions.map((action,index)=>({type:'toolCall',id:`call_${calls}_${index}`,name:action.name,arguments:action.args})):[{type:'text',text:actions}];
  const message={role:'assistant',content,api:'openai-completions',provider:'mock',model:'mock',stopReason:Array.isArray(actions)?'toolUse':'stop',timestamp:Date.now(),usage:{input:20,output:10,cacheRead:0,cacheWrite:0,totalTokens:30,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const stream=createAssistantMessageEventStream();
  queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:message.stopReason,message});});
  return stream;
 };
 return {fn,contexts,get calls(){return calls;}};
};

try{
 const {commandContracts,commandNames,commandSchema,commandEnvelopeSchema,validateCommandOperations}=await server.ssrLoadModule('/src/ai/commandContract.ts');
 const {parseModelResponse}=await server.ssrLoadModule('/src/ai/provider.ts');
 const {runModelingAgent}=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const {createInitialDoc,useEditorStore:store}=await server.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const parse=operations=>parseModelResponse(JSON.stringify({summary:'contract test',operations}));
 const assertIssues=(operations,path)=>{
  const issues=validateCommandOperations(operations);
  assert.ok(issues.length,'invalid operations must produce diagnostics');
  for(const issue of issues){
   assert.ok(Array.isArray(issue.path));
   assert.equal(issue.path[0],'operations');
   assert.equal(typeof issue.code,'string');assert.ok(issue.code.length);
   assert.equal(typeof issue.message,'string');assert.ok(issue.message.length);
  }
  if(path)assert.ok(issues.some(issue=>path.every((segment,index)=>issue.path[index]===segment)),`missing diagnostic at ${JSON.stringify(path)}: ${JSON.stringify(issues)}`);
  return issues;
 };
 const assertRejected=(operation,path)=>{
  assertIssues([operation],path);
  assert.throws(()=>parse([operation]),undefined,'a bad command must not be normalized into success');
  assert.throws(()=>parse([clone(samples.createPrimitive),operation]),undefined,'a valid sibling must not survive a rejected command');
 };
 const assertReportedPath=(error,path)=>{
  const report=JSON.stringify(error);
  for(const segment of path.filter(segment=>typeof segment==='string'))assert.ok(report.includes(segment),`report must identify ${path.join('.')}: ${report}`);
 };

 await test('all public AI commands have valid parser fixtures and one schema registry',()=>{
  const names=Object.keys(samples).sort();
  assert.deepEqual([...commandNames].sort(),names);
  assert.deepEqual(Object.keys(commandContracts).sort(),names);
  assert.deepEqual(Object.keys(missingFields).sort(),names);
  assert.deepEqual(commandSchema.anyOf.map(schema=>schema.properties.op.const).sort(),names);
  for(const name of names){
   const operation=clone(samples[name]);
   assert.deepEqual(validateCommandOperations([operation]),[],name);
   const before=clone(operation),parsed=parse([operation]);
   assert.equal(parsed.operations.length,1,name);assert.equal(parsed.operations[0].op,name);
   assert.deepEqual(operation,before,'validation must not mutate model input');
  }
  assert.deepEqual(validateCommandOperations([]),[]);
  assert.deepEqual(parse([]).operations,[]);
 });

 await test('every mandatory command field has a path-aware rejection instead of a fallback',()=>{
  for(const [name,fields] of Object.entries(missingFields))for(const field of fields){
   assertRejected(without(samples[name],field),['operations',0,field]);
  }
  for(const name of Object.keys(samples))assertRejected(without(samples[name],'op'),['operations',0,'op']);
  for(const [name,fields] of [
   ['transformAssembly',['rotationDegrees']],['updateParameters',['geometry']],
   ['setAppearance',['baseColor']],['setAssemblyMetadata',['sceneRole']],
  ])assertRejected(without(samples[name],...fields),['operations',0]);
 });

 await test('nested assembly and geometry required fields report their complete paths',()=>{
  for(const op of ['createAssembly','appendAssemblyParts','replaceAssemblyParts']){
   for(const field of ['name','geometry']){
    const operation=clone(samples[op]);delete operation.parts[0][field];
    assertRejected(operation,['operations',0,'parts',0,field]);
   }
   const operation=clone(samples[op]);delete operation.parts[0].geometry.params.height;
   assertRejected(operation,['operations',0,'parts',0,'geometry','params','height']);
  }
  const primitive=clone(samples.createPrimitive);delete primitive.geometry.params.width;
  assertRejected(primitive,['operations',0,'geometry','params','width']);
  for(const field of ['type','params']){
   const operation=clone(samples.createPrimitive);delete operation.geometry[field];
   assertRejected(operation,['operations',0,'geometry',field]);
  }
  for(const field of ['count','step']){
   const operation=clone(samples.createAssembly);operation.parts[0].repeat={count:2,step:[1,0,0]};delete operation.parts[0].repeat[field];
   assertRejected(operation,['operations',0,'parts',0,'repeat',field]);
  }
  for(const field of ['version','name','duration','loop','tracks']){
   const operation=clone(samples.setAnimation);delete operation.animation[field];
   assertRejected(operation,['operations',0,'animation',field]);
  }
  for(const field of ['id','name','targetIds','channel']){
   const operation=clone(samples.setAnimation);delete operation.animation.tracks[0][field];
   assertRejected(operation,['operations',0,'animation','tracks',0,field]);
  }
  for(const field of ['time','value']){
   const operation=clone(samples.setAnimation);delete operation.animation.tracks[0].keyframes[0][field];
   assertRejected(operation,['operations',0,'animation','tracks',0,'keyframes',0,field]);
  }
 });

 await test('unknown commands, unknown fields and malformed operation containers cannot be skipped',()=>{
  for(const operation of [null,7,'rename',[],{}, {op:'execute_shell',command:'bad'},{op:'editSelection',targetIds:['n1'],change:{kind:'color',value:'#123456'}}])assertRejected(operation,['operations',0]);
  for(const operation of [undefined,null,{},'[]'])assertIssues(operation,['operations']);
  for(const name of Object.keys(samples))assertRejected({...clone(samples[name]),unexpected:true},['operations',0,'unexpected']);
  const nestedCases=[
   [{...clone(samples.createPrimitive),transform:{...transform,unexpected:true}},['transform','unexpected']],
   [{...clone(samples.createPrimitive),geometry:{...geometry,unexpected:true}},['geometry','unexpected']],
   [{...clone(samples.createPrimitive),geometry:{type:'box',params:{...geometry.params,unexpected:1}}},['geometry','params','unexpected']],
   [{...clone(samples.createAssembly),parts:[{...part,unexpected:true}]},['parts',0,'unexpected']],
  ];
  for(const [operation,path] of nestedCases)assertRejected(operation,['operations',0,...path]);
 });

 await test('explicit invalid enums, vectors, booleans, material and transforms never become defaults',()=>{
  const cases=[
   [{...samples.translate,space:'camera'},['space']],
   [{...samples.translate,mode:'relative'},['mode']],
   [{...samples.translate,value:[1,2]},['value']],
   [{...samples.translate,value:[1,2,3,4]},['value']],
   [{...samples.translate,value:['1',2,3]},['value']],
   [{...samples.setVisibility,visible:'false'},['visible']],
   [{...samples.rename,name:''},['name']],
   [{...samples.createPrimitive,materialId:null},['materialId']],
   [{...samples.createPrimitive,name:27},['name']],
   [{...samples.createPrimitive,transform:null},['transform']],
   [{...samples.createPrimitive,transform:{position:[1,2]}},['transform','position']],
   [{...samples.createPrimitive,transform:{...transform,scale:[0,1,1]}},['transform','scale']],
   [{...samples.createPrimitive,transform:{...transform,rotationQuaternion:[0,0,0,0]}},['transform','rotationQuaternion']],
   [{...samples.setTransform,transform:{}},['transform']],
   [{...samples.createAssembly,sceneRole:'not-a-role'},['sceneRole']],
   [{...samples.delete,scope:'scene'},['scope']],
   [{...samples.setAppearance,baseColor:'red'},['baseColor']],
   [{...samples.createAssembly,parts:[{...part,transform:{position:[1,2]}}]},['parts',0,'transform','position']],
   [{...samples.createAssembly,parts:[{...part,geometry:{type:'box',params:{width:1,height:-1,depth:1}}}]},['parts',0,'geometry']],
   [{...samples.delete,targetIds:['n1']},[]],
   [{...samples.setAnimation,animation:{...animation,loop:'true'}},['animation','loop']],
   [{...samples.setAnimation,animation:{...animation,tracks:[{...animation.tracks[0],channel:'teleport'}]}},['animation','tracks',0,'channel']],
   [{...samples.createAssembly,parts:[{...part,repeat:{count:2,step:[1,2]}}]},['parts',0,'repeat','step']],
   [{...samples.createAssembly,parts:[{...part,repeat:{count:1.5,step:[1,0,0]}}]},['parts',0,'repeat','count']],
  ];
  for(const [operation,path] of cases)assertRejected(operation,['operations',0,...path]);
  for(const value of [NaN,Infinity,-Infinity])assertIssues([{...samples.translate,value:[value,0,0]}],['operations',0,'value']);
 });

 await test('optional creation and translate defaults survive while partial transforms remain patches',()=>{
  const primitive=parse([{op:'createPrimitive',geometry:clone(geometry)}]).operations[0];
  assert.equal(primitive.name,'未命名');assert.equal(primitive.materialId,'mat_gray');assert.deepEqual(primitive.transform,transform);
  const assembly=parse([{op:'createAssembly',name:'assembly',parts:[{name:'body',geometry:clone(geometry)}]}]).operations[0];
  assert.deepEqual(assembly.position,[0,0,0]);assert.equal(assembly.yaw,0);assert.deepEqual(assembly.parts[0].transform,transform);
  assert.equal(assembly.parts[0].materialId,'mat_gray');
  const translated=parse([{op:'translate',targetId:'n1',value:[1,0,0]}]).operations[0];
  assert.equal(translated.space,'world');assert.equal(translated.mode,'delta');
  const patched=parse([samples.setTransform]).operations[0];
  assert.deepEqual(patched.transform,{position:[1,2,3]});
 });

 await test('one validation pass and parser error report every independent bad operation',()=>{
  const operations=[
   {op:'rename',targetId:'n1'},
   {op:'setVisibility',targetId:'n1'},
   {op:'setMaterial',targetId:'n1'},
   {op:'translate',value:[1,0,0]},
   {op:'createAssembly',name:'bad parts',parts:[{name:'body',geometry:{type:'box',params:{width:1,depth:1}}}]},
  ];
  const paths=[['operations',0,'name'],['operations',1,'visible'],['operations',2,'materialId'],['operations',3,'targetId'],['operations',4,'parts',0,'geometry','params','height']];
  for(const path of paths)assertIssues(operations,path);
  assert.throws(()=>parse(operations),error=>{
   for(const field of ['name','visible','materialId','targetId','height'])assert.ok(error.message.includes(field),error.message);
   return true;
  });
 });

 await test('delete and motion tracks require exactly one selector',()=>{
  const single={op:'delete',targetId:'n1'},multiple={op:'delete',targetIds:['n1']};
  for(const operation of [single,multiple]){
   assert.deepEqual(validateCommandOperations([operation]),[]);
   assert.deepEqual(parse([operation]).operations,[operation]);
  }
  assertRejected({op:'delete'},['operations',0,'targetId']);
  assertRejected({...single,...multiple},['operations',0]);
  for(const channel of ['position','scale','rotation']){
   const {keyframes:originalKeys,...track}=animation.tracks[0];
   const keyframes=channel==='rotation'?[{time:0,value:0},{time:2,value:1}]:channel==='scale'?[{time:0,value:[1,1,1]},{time:2,value:[2,1,1]}]:originalKeys;
   const expression=channel==='rotation'?'t':channel==='scale'?[1,1,1]:['t',0,0];
   const motion=fields=>({op:'setAnimation',animation:{...animation,tracks:[{...track,channel,...(channel==='rotation'?{axis:[0,1,0],pivot:[0,0,0]}:{}),...fields}]}});
   for(const operation of [motion({keyframes}),motion({expression})]){
    assert.deepEqual(validateCommandOperations([operation]),[]);
    assert.deepEqual(parse([operation]).operations,[operation]);
   }
   assertRejected(motion({}),['operations',0,'animation','tracks',0]);
   assertRejected(motion({keyframes,expression}),['operations',0,'animation','tracks',0]);
  }
 });

 const config={baseURL:'https://mock.invalid/v1',apiKey:'mock-only',model:'mock-tools',useMock:false};
 const agentOptions=(transport,document)=>({text:'只修改选中主体，不改其他对象',config,document,selection:[],images:[],streamFn:transport.fn,captureAvailable:()=>false});
 const baseDocument=()=>{
  const result=applyBatch(createInitialDoc(),{operations:[{...clone(samples.createPrimitive),name:'selected'},{...clone(samples.createPrimitive),tempId:'other',name:'untouched',transform:{...clone(transform),position:[5,0,0]}}]});
  assert.deepEqual(result.errors,[]);return result.doc;
 };

 await test('strict tool schemas omit oneOf and uniqueItems',()=>{
  for(const schema of [commandSchema,commandContracts,commandEnvelopeSchema])assert.doesNotMatch(JSON.stringify(schema),/"(?:oneOf|uniqueItems)"\s*:/);
 });

 await test('animation targets dedupe before apply',()=>{
  const document=baseDocument(),ids=document.nodes.map(node=>node.id),operation=clone(samples.setAnimation);
  operation.animation.tracks[0].targetIds=[ids[0],ids[1],ids[0],ids[1]];
  const before=clone(operation);
  assert.deepEqual(validateCommandOperations([operation]),[]);
  const parsed=parse([operation]);
  assert.deepEqual(parsed.operations[0].animation.tracks[0].targetIds,ids);
  for(const operations of [parsed.operations,[operation]]){
   const result=applyBatch(document,{operations});
   assert.deepEqual(result.errors,[]);
   assert.deepEqual(result.doc.animation.tracks[0].targetIds,ids);
  }
  assert.deepEqual(operation,before,'normalization and apply must not mutate input');
  const created=clone(samples.createPrimitive),remapped=clone(samples.setAnimation);
  remapped.animation.tracks[0].targetIds=['body','body'];
  const result=applyBatch(createInitialDoc(),{operations:[created,remapped]});
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.doc.animation.tracks[0].targetIds,[result.doc.nodes[0].id]);
 });

 await test('material references use the actual document and never fall back to a stock material',()=>{
  const document=baseDocument(),id=document.nodes[0].id;
  const materialId='user-custom-finish';
  document.materials.push({...clone(document.materials[0]),id:materialId,baseColor:'#345678'});
  const before=clone(document);
  const operations=[
   {...clone(samples.setMaterial),targetId:id,materialId},
   {...clone(samples.createPrimitive),materialId},
   {...clone(samples.createAssembly),parts:[{...clone(part),materialId}]},
  ];
  for(const operation of operations){
   assert.deepEqual(validateCommandOperations([operation]),[]);
   const parsed=parse([operation]).operations[0];
   assert.equal(parsed.op==='createAssembly'?parsed.parts[0].materialId:parsed.materialId,materialId);
   const accepted=applyBatch(document,{operations:[parsed]});
   assert.deepEqual(accepted.errors,[]);
   assert.equal(accepted.doc.nodes.filter(node=>node.materialId===materialId).length,1);
   assert.deepEqual(accepted.doc.materials,document.materials);
   assert.deepEqual(document,before);

   const invalid=clone(operation);
   if(invalid.op==='createAssembly')invalid.parts[0].materialId='mat_nonexistent';
   else invalid.materialId='mat_nonexistent';
   assert.deepEqual(validateCommandOperations([invalid]),[],'material existence is a document-dependent constraint');
   const rejected=applyBatch(document,{operations:parse([{op:'rename',targetId:id,name:'must not apply'},invalid]).operations});
   assert.ok(rejected.errors.length,'a reference absent from the actual document must fail');
   assert.ok(rejected.errors.some(error=>error.message.includes('mat_nonexistent')));
   assert.deepEqual(rejected.doc,before);assert.equal(rejected.applied.length,0);
   assert.deepEqual(document,before);
  }
 });

 await test('Pi rejects a mixed valid and malformed batch without a partial preview or mutation',async()=>{
  const document=baseDocument(),before=clone(document),id=document.nodes[0].id;
  const transport=fakeTransport([[{name:'edit_scene',args:{summary:'invalid mixed batch',operations:[{op:'rename',targetId:id,name:'must not apply'},{op:'setVisibility',targetId:id},{op:'setMaterial',targetId:id}]}}],context=>{
   const error=context.messages.find(message=>message.role==='toolResult'&&message.isError);
   assert.ok(error);assertReportedPath(error,['operations','visible']);assertReportedPath(error,['operations','materialId']);
   return '整批没有应用，等待修正';
  }]);
  const previews=[];
  const result=await runModelingAgent({...agentOptions(transport,document),onPreview:doc=>previews.push(clone(doc))});
  assert.equal(result.batch.operations.length,0);assert.equal(result.result.applied.length,0);assert.deepEqual(result.result.doc,before);
  assert.deepEqual(previews,[]);assert.deepEqual(document,before);
 });

 await test('Pi reports all missing fields then applies one corrected scoped transaction via retry_scene_edit',async()=>{
  const document=baseDocument(),before=clone(document),id=document.nodes[0].id,other=clone(document.nodes[1]);
  const operations=[
   {op:'rename',targetId:id,name:'intermediate'},
   {op:'rename',targetId:id},
   {op:'setVisibility',targetId:id},
   {op:'setMaterial',targetId:id},
   {op:'translate',value:[1,0,0]},
  ];
  const previews=[];
  const transport=fakeTransport([[{name:'edit_scene',args:{summary:'multiple missing fields',operations}}],context=>{
   assert.equal(previews.length,0);assert.deepEqual(document,before);
   const error=context.messages.find(message=>message.role==='toolResult'&&message.toolName==='edit_scene'&&message.isError);
   assert.ok(error);
   for(const field of ['name','visible','materialId','targetId'])assertReportedPath(error,['operations',field]);
   assert.ok(JSON.stringify(error).includes('call_1_0'),'failed batch must remain addressable for patch retry');
   return [{name:'retry_scene_edit',args:{failedId:'call_1_0',patches:[
    {path:['operations',1,'name'],value:'corrected'},
    {path:['operations',2,'visible'],value:false},
    {path:['operations',3,'materialId'],value:'mat_blue'},
    {path:['operations',4,'targetId'],value:id},
   ]}}];
  },context=>{
   const correction=context.messages.find(message=>message.role==='toolResult'&&message.toolName==='retry_scene_edit');
   assert.ok(correction);assert.equal(correction.isError,false);
   return [{name:'submit_data_preview',args:{summary:'仅选中主体的数据草稿，未视觉验收'}}];
  }]);
  const result=await runModelingAgent({...agentOptions(transport,document),selection:[id],editScope:{nodeIds:[id]},onPreview:doc=>previews.push(clone(doc))});
  assert.equal(transport.calls,3);assert.equal(previews.length,1);assert.deepEqual(document,before);
  const selected=result.result.doc.nodes.find(node=>node.id===id);
  assert.equal(selected.name,'corrected');assert.equal(selected.visible,false);assert.equal(selected.materialId,'mat_blue');assert.deepEqual(selected.transform.position,[1,0,0]);
  assert.deepEqual(result.result.doc.nodes.find(node=>node.id===other.id),other);
  assert.deepEqual(result.result.doc.assets,before.assets);assert.deepEqual(result.result.doc.materials,before.materials);assert.equal(result.result.doc.animation,undefined);
  assert.equal(result.result.applied.length,5);assert.equal(result.batch.operations.length,5);
  store.setState({doc:document,past:[],future:[],selection:[id],aiStatus:'previewing',pendingBatch:result.batch,pendingResult:result.result,previewDoc:result.result.doc,messages:[]});
  store.getState().confirmPending();
  assert.equal(store.getState().past.length,1,'one corrected tool batch must produce one undoable transaction');
  assert.deepEqual(store.getState().doc.nodes,result.result.doc.nodes);
  store.getState().undo();assert.deepEqual(store.getState().doc.nodes,before.nodes);
 });
 await test('contract failure is automatically continued internally after a text stop, without replaying successful edits',async()=>{
  const document=baseDocument(),id=document.nodes[0].id;
  const transport=fakeTransport([[{name:'edit_scene',args:{summary:'bad',operations:[{op:'rename',targetId:id}]}}],'模型暂未纠正',context=>{assert.ok(JSON.stringify(context).includes('内部自动恢复'));return [{name:'retry_scene_edit',args:{failedId:'call_1_0',patches:[{path:['operations',0,'name'],value:'restored'}]}}];},[{name:'submit_data_preview',args:{summary:'已恢复的数据草稿'}}]]);
  const result=await runModelingAgent(agentOptions(transport,document));assert.equal(result.result.doc.nodes[0].name,'restored');assert.equal(result.batch.operations.length,1);assert.equal(document.nodes[0].name,'selected');
  const stopped=fakeTransport([[{name:'edit_scene',args:{summary:'bad',operations:[{op:'rename',targetId:id}]}}],'停止','停止','停止','不应再次请求']);
  const stoppedResult=await runModelingAgent(agentOptions(stopped,document));
  assert.equal(stoppedResult.batch.operations.length,0);assert.equal(stoppedResult.result.applied.length,0);assert.equal(stoppedResult.result.doc.nodes[0].name,'selected');
  assert.equal(stopped.calls,4);assert.equal(document.nodes[0].name,'selected');
 });
 console.log(`${passed} command contract checks passed; synthetic Pi transport, no network`);
}finally{await server.close();}
