import assert from 'node:assert/strict';import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let passed=0;const check=(name,f)=>{f();passed++;console.log('PASS '+name)};
try{const {normalizedUsage,providerHasUsage,executionMetadata,classifyToolFailure,safeToolFailureCategory}=await server.ssrLoadModule('/src/ai/executionTelemetry.ts');const {runDiagnostics,fullRunDiagnostics,expandDiagnosticBundle}=await server.ssrLoadModule('/src/domain/runDiagnostics.ts');const {DEFAULT_TASK_BUDGET}=await server.ssrLoadModule('/src/ai/taskBudget.ts');
check('SDK default zero is unknown without provider evidence',()=>{assert.equal(normalizedUsage({input:0,output:0,totalTokens:0}).usageState,'unknown');assert.equal(normalizedUsage({input:0,output:0},true).usageState,'reported-zero');});
check('cached input is counted once in per-round totals',()=>{assert.deepEqual(normalizedUsage({input:20,cacheRead:80,cacheWrite:10,output:5}),{inputTokens:110,uncachedInputTokens:20,cacheReadTokens:80,cacheWriteTokens:10,outputTokens:5,usageState:'reported'});});
check('only explicit provider usage counters prove reported zero',()=>{assert.equal(providerHasUsage({usage:{prompt_tokens:0,completion_tokens:0}}),true);assert.equal(providerHasUsage({usage:{}}),false);assert.equal(providerHasUsage({usage:{prompt_tokens:-1,completion_tokens:0}}),false);assert.equal(providerHasUsage({response:{usage:{input_tokens:2,output_tokens:3}}}),true);});
check('model metadata rejects URLs and the configured credential',()=>{assert.equal(executionMetadata({model:'https://private?key=secret',apiKey:'secret'},4).model,undefined);assert.equal(executionMetadata({model:'private-secret',apiKey:'secret'},4).model,undefined);assert.equal(executionMetadata({model:'gpt-test',apiKey:'secret'},4).model,'gpt-test');for(const model of ['sk-private','token-private','bearer-private','https://private.example','gpt-test\nprivate'])assert.equal(executionMetadata({model,apiKey:'secret'},4).model,undefined);});
check('diagnostics identify legacy zero usage as incomplete without leaking labels or arguments',()=>{const a={turn:1,toolCalls:1,inputTokens:0,outputTokens:0,usageIncomplete:false,timings:[{kind:'model',startedAt:1,endedAt:2,inputTokens:0,outputTokens:0},{kind:'tool',toolName:'read_scene',label:'private-label',detail:'private-secret',arguments:{secret:'private-secret'},argumentsChars:40,resultChars:87000,sceneRevision:4,startedAt:2,endedAt:3}]};const d=runDiagnostics('idle',a,null);assert.equal(d.run.usageIncomplete,true);assert.equal(d.run.timings[1].toolName,'read_scene');assert.equal(d.run.timings[1].resultChars,87000);assert.equal(JSON.stringify(d).includes('private-'),false);});
check('v2 diagnostics retain model content, scene, history commands and raw failures without credentials',()=>{
 const apiKey='fixture-configured-credential',script='bpy.ops.mesh.primitive_cube_add()';
 const diagnostics=[{at:1,kind:'tool',data:{arguments:{script},headers:{Authorization:'fixture-auth-header'},result:{error:'RuntimeError: no selected mesh'}}}];
 const lastRun={timings:[{kind:'tool',failed:true,detail:'RuntimeError: no selected mesh'}],diagnostics};
 const message={text:'Keep this secret compartment and token of appreciation',images:['data:image/png;base64,Zm9v'],run:{activity:lastRun}};
 const doc={revision:7,nodes:{cube:{name:'Secret compartment'}}},pendingBatch={operations:[{script}]},pendingResult={doc};
 const past=[{summary:'first change'}],future=[{summary:'second change'}];
 const bundle=JSON.parse(JSON.stringify(fullRunDiagnostics({aiStatus:'generating',aiError:`HTTP 401 ${apiKey}`,lastRun,messages:[message],doc,pendingBatch,pendingResult,past,future,aiConfig:{apiKey,baseURL:'https://private-config.example'}},diagnostics))),result=expandDiagnosticBundle(bundle);assert.equal(bundle.format,'chat3d-diagnostics-v2');
 assert.equal(result.messages[0].text,message.text);assert.deepEqual(result.messages[0].images,message.images);
 assert.equal(result.lastRun.timings[0].detail,'RuntimeError: no selected mesh');assert.equal(result.liveDiagnostics[0].data.arguments.script,script);assert.equal(result.lastRun.diagnostics[0].data.result.error,'RuntimeError: no selected mesh');
 assert.deepEqual(result.doc,doc);assert.deepEqual(result.pendingBatch,pendingBatch);assert.deepEqual(result.pendingResult,pendingResult);assert.deepEqual(result.past,past);assert.deepEqual(result.future,future);
 assert.match(result.aiError,/HTTP 401/);assert.equal(result.aiConfig,undefined);assert.doesNotMatch(JSON.stringify(result),/fixture-configured-credential|fixture-auth-header|private-config\.example/);
});
check('explicit zero is complete and first response/content timings remain distinct',()=>{const d=runDiagnostics('idle',{turn:1,toolCalls:0,inputTokens:0,outputTokens:0,timings:[{kind:'model',usageState:'reported-zero',startedAt:1,responseAt:2,firstDataAt:3,firstContentAt:4,endedAt:5,inputTokens:0,outputTokens:0}]},null);assert.equal(d.run.usageIncomplete,false);assert.equal(d.run.timings[0].responseAt,2);assert.equal(d.run.timings[0].firstContentAt,4);});
check('launch snapshot copies and freezes safe model reasoning budget and reference dimensions without legacy quality',()=>{
 const config={model:'gpt-test',apiKey:'private-secret',generationQuality:'private-legacy-quality',reasoningEffort:'xhigh',taskBudget:{maxMinutes:12.9,maxRounds:35.8,maxReportedTokens:300000.4}};
 const reference={count:2,dimensions:[{width:640,height:480,url:'https://private.example',data:'private-secret'},{width:1024,height:768}]};
 const meta=executionMetadata(config,7,reference),before=JSON.stringify(meta);
 config.model='other';config.generationQuality='fine';config.reasoningEffort='low';config.taskBudget.maxRounds=2;reference.count=0;reference.dimensions[0].width=1;reference.dimensions.push({width:1,height:1});
 assert.equal(JSON.stringify(meta),before);assert.equal(meta.model,'gpt-test');assert.equal(Object.hasOwn(meta,'generationQuality'),false);assert.equal(meta.reasoningEffort,'xhigh');assert.deepEqual(meta.taskBudget,{maxMinutes:12,maxRounds:35,maxReportedTokens:300000});assert.deepEqual(meta.referenceImages,{count:2,dimensions:[{width:640,height:480},{width:1024,height:768}]});
 for(const value of [meta,meta.taskBudget,meta.referenceImages,meta.referenceImages.dimensions,meta.referenceImages.dimensions[0]])assert.equal(Object.isFrozen(value),true);
 assert.equal(before.includes('private'),false);const exported=runDiagnostics('idle',{executionMeta:meta,timings:[]},null).run.executionMeta;assert.deepEqual(exported,meta);
});
check('reasoning accepts only configured enums and exposes service default explicitly',()=>{
 for(const value of [undefined,null,'default','off','HIGH','private-secret',{},['high'],4])assert.equal(executionMetadata({reasoningEffort:value},0).reasoningEffort,'default');
 for(const value of ['low','medium','high','xhigh'])assert.equal(executionMetadata({reasoningEffort:value},0).reasoningEffort,value);
});
check('invalid budgets are normalized without coercing strings or retaining unknown fields',()=>{
 for(const value of [undefined,null,'private-secret',{maxMinutes:'private-secret',maxRounds:NaN,maxReportedTokens:Infinity,extra:'private-secret'}])assert.deepEqual(executionMetadata({taskBudget:value},0).taskBudget,DEFAULT_TASK_BUDGET);
 assert.deepEqual(executionMetadata({taskBudget:{maxMinutes:-2,maxRounds:999,maxReportedTokens:1e20}},0).taskBudget,{maxMinutes:1,maxRounds:200,maxReportedTokens:20000000});
});
check('reference metadata exports only numeric count and complete positive integer dimensions',()=>{
 for(const count of ['private-secret',-1,NaN,Infinity,.5])assert.equal(executionMetadata({},0,{count}).referenceImages,undefined);
 const meta=executionMetadata({},0,{count:3,dimensions:[{width:'private-secret',height:1},{width:1,height:Infinity},{width:32,height:24,prompt:'private-secret'},{width:2,height:2}]});assert.deepEqual(meta.referenceImages,{count:3,dimensions:[undefined,undefined,{width:32,height:24}]});assert.equal(JSON.stringify(meta).includes('private-secret'),false);
});
check('tool failure classification returns only safe categories without serializing hostile errors',()=>{
 const cases=[['Invalid arguments schema','schema'],['网格几何自相交','geometry'],['超出本次编辑范围','scope'],['截图与当前任务文档不匹配，不能用于验收','review-evidence'],['参考图与模型不符','reference-mismatch'],['HTTP 503 network timeout','transport'],['unrecognized failure','other']];
 for(const [message,category] of cases)assert.equal(classifyToolFailure(new Error(message+' private-secret https://private.example data:image/png;base64,cHJpdmF0ZQ==')),category);
 const hostile={message:'private-secret',category:'private-secret',toString(){throw Error('must not stringify')},toJSON(){throw Error('must not serialize')}};assert.equal(classifyToolFailure(hostile),'other');assert.equal(classifyToolFailure(hostile,'capture_view'),'review-evidence');assert.equal(safeToolFailureCategory('private-secret'),undefined);
});
check('diagnostics retain per-tool safe failure category only for failed tool entries',()=>{
 const timings=['schema','geometry','scope','review-evidence','reference-mismatch','transport','other','private-secret'].map(failureCategory=>({kind:'tool',toolName:'edit_scene',startedAt:1,endedAt:2,failed:true,failureCategory,detail:'private-secret'}));
 timings.push({kind:'tool',failed:false,failureCategory:'schema'},{kind:'model',failed:true,failureCategory:'schema'});
 const diagnostic=runDiagnostics('error',{timings},'private-secret');assert.deepEqual(diagnostic.run.timings.map(t=>t.failureCategory),['schema','geometry','scope','review-evidence','reference-mismatch','transport','other','other',undefined,undefined]);assert.equal(JSON.stringify(diagnostic).includes('private-secret'),false);
});
check('every untrusted configuration field is filtered at capture and persisted export boundaries',()=>{
 const secret='private-secret',config={model:secret,apiKey:secret,generationQuality:secret,reasoningEffort:secret,taskBudget:{maxMinutes:secret,maxRounds:secret,maxReportedTokens:secret},baseURL:'https://private.example',prompt:secret,images:[secret]};
 const metadata=executionMetadata(config,secret,{count:secret,dimensions:[{width:secret,height:secret}]});assert.equal(Object.hasOwn(metadata,'generationQuality'),false);assert.equal(JSON.stringify(metadata).includes(secret),false);
 const forged={appVersion:secret,model:'sk-private-secret',initialRevision:secret,buildCommit:secret,contextPolicy:secret,executionMode:secret,generationQuality:secret,reasoningEffort:secret,taskBudget:config.taskBudget,referenceImages:{count:1,dimensions:[{width:secret,height:secret,url:'https://private.example'}]},apiKey:secret,prompt:secret};
 const diagnostic=JSON.stringify(runDiagnostics(secret,{executionMeta:forged,outcome:secret,turn:secret,toolCalls:secret,inputTokens:secret,outputTokens:secret,timings:[]},'HTTP 401 '+secret+' https://private.example'));assert.equal(Object.hasOwn(JSON.parse(diagnostic).run.executionMeta,'generationQuality'),false);assert.equal(diagnostic.includes(secret),false);assert.equal(diagnostic.includes('private.example'),false);assert.equal(JSON.parse(diagnostic).httpStatus,'401');
});
check('hostile strings in every timing and child metadata field cannot escape the whitelist',()=>{
 const secret='private_secret',timing={kind:secret,toolName:secret,repeatedInput:secret,argumentsChars:secret,resultChars:secret,sceneRevision:secret,firstDataAt:secret,firstContentAt:secret,responseAt:secret,usageState:secret,uncachedInputTokens:secret,cacheReadTokens:secret,cacheWriteTokens:secret,startedAt:secret,endedAt:secret,failed:secret,inputTokens:secret,outputTokens:secret,failureCategory:secret,requestFootprint:secret,arguments:{key:secret},detail:secret};
 const child={status:secret,rounds:secret,toolCalls:secret,inputTokens:secret,outputTokens:secret,usageReported:secret,startedAt:secret,endedAt:secret,error:secret};
 const diagnostic=JSON.stringify(runDiagnostics('error',{timings:[timing,{...timing,kind:'tool',failed:true}],parallelRuns:[child]},secret));assert.equal(diagnostic.includes(secret),false);assert.equal(JSON.parse(diagnostic).run.timings[1].failureCategory,'other');
});
check('diagnostics distinguish active review from model changes without exporting arbitrary phase text',()=>{
 const valid=runDiagnostics('generating',{phase:'reviewing',lastModelEditAt:1200,timings:[]},null);assert.equal(valid.run.phase,'reviewing');assert.equal(valid.run.lastModelEditAt,1200);
 const unsafe=JSON.stringify(runDiagnostics('generating',{phase:'private-secret',lastModelEditAt:'private-secret',timings:[]},null));assert.equal(unsafe.includes('private-secret'),false);
});
console.log(passed+' execution telemetry checks passed');}finally{await server.close()}
