import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {progressFeed,workTimelineTime}=await server.ssrLoadModule('/src/ui/chat/workTimeline.ts');
 const started=new Date(2026,10,3,9,7,5).getTime();
 const timings=[
  {id:'model-1',kind:'model',label:'第1轮模型响应',phase:'planning',startedAt:started-100,endedAt:started+100,summary:'private model summary'},
  {id:'build',kind:'tool',toolName:'build_modeling_program',label:'private tool label',phase:'building',startedAt:started+1000,endedAt:started+9000,summary:'保留主体轮廓。',detail:'Error: private raw failure',failed:true},
  {id:'review',kind:'tool',toolName:'capture_multiview',label:'private review label',phase:'reviewing',startedAt:started+10000},
  {id:'unknown',kind:'tool',toolName:'private_unknown_tool',label:'看起来像公开说明的未知动作',startedAt:started+11000,endedAt:started+12000}
 ];
 const explanations=[
  {id:'design-b',phase:'planning',text:'按五层结构安排横梁。',createdAt:started+500},
  {id:'design-a',phase:'planning',text:'保留原有布局。',createdAt:started},
  {id:'design-repeat',phase:'planning',text:'按五层结构安排横梁。',createdAt:started+750},
  {id:'build-a',phase:'building',text:'先建立立柱，再布置横梁。',createdAt:started+2000},
  {id:'build-b',phase:'building',text:'保持立柱间距一致。',createdAt:started+3000},
  {id:'review-a',phase:'reviewing',text:'接下来核对横梁与立柱的接触。',createdAt:started+4000},
  {id:'refine-a',phase:'repairing',text:'调整横梁端部的位置。',createdAt:started+5000},
  {id:'build-again',phase:'building',text:'补充背面的支撑。',createdAt:started+6000}
 ];
 const rows=progressFeed({status:'running'},{timings,explanations});
 assert.deepEqual(rows.filter(row=>row.kind==='explanation').map(row=>row.text),['保留原有布局。','按五层结构安排横梁。','先建立立柱，再布置横梁。','保持立柱间距一致。','接下来核对横梁与立柱的接触。','调整横梁端部的位置。','补充背面的支撑。']);
 assert.deepEqual(rows.map(row=>row.at),[started,started+500,started+1000,started+2000,started+3000,started+4000,started+5000,started+6000,started+10000]);
 assert.ok(rows.filter(row=>row.kind==='explanation').every(row=>row.status==='recorded'),'public prose does not claim execution or success');
 const actions=rows.filter(row=>row.kind==='action');
 assert.deepEqual(actions.map(row=>row.status),['failed','running']);assert.equal(actions[0].summary,'保留主体轮廓。');
 assert.ok(actions.every(row=>row.text.trim()&&!row.text.includes('_')),'observed known tools receive public action names');
 const visible=JSON.stringify(rows);for(const secret of ['build_modeling_program','capture_multiview','第1轮','private model summary','private tool label','private review label','private raw failure','private_unknown_tool','看起来像公开说明的未知动作'])assert.ok(!visible.includes(secret),secret);
 assert.equal(progressFeed({status:'running'},{timings}).length,2,'tool-only activity still exposes real known actions');
 console.log('PASS flat public explanations and actual actions remain ordered without phase groups or private metadata');
 for(const status of ['preview','completed','failed','stopped']){
  const history=progressFeed({status},{timings,explanations});
  assert.deepEqual(history.filter(row=>row.kind==='action').map(row=>row.status),['failed','interrupted'],'ending the run cannot complete an unfinished action');
  assert.ok(history.filter(row=>row.kind==='explanation').every(row=>row.status==='recorded'));
 }
 const completed=progressFeed({status:'running'},{timings:[{...timings[2],endedAt:started+11000}]});assert.equal(completed[0].status,'completed','only a recorded tool end proves completion');
 const undated=progressFeed({status:'completed'},{explanations:[{id:'old',text:'无日期的公开说明。'}]})[0];
 assert.equal(undated.at,undefined);assert.equal(undated.status,'recorded');
 for(const invalid of [undefined,NaN,Infinity,Number.MAX_VALUE]){
  assert.equal(workTimelineTime(invalid),'时间未记录');
  assert.equal(progressFeed({status:'running'},{explanations:[{id:'invalid',text:'日期缺失的公开说明。',createdAt:invalid}]})[0].at,undefined);
 }
 assert.equal(workTimelineTime(started),'09:07:05');assert.equal(workTimelineTime(started+3500),'09:07:08');
 console.log('PASS unfinished actions remain unfinished after run termination and prose never receives invented execution or timestamps');
 const safe=progressFeed({status:'running'},{timings:[],explanations:[
  {id:'reasoning',text:'<think>private reasoning</think>公开记录：保持原有尺寸。',createdAt:started},
  {id:'unfinished-private',text:'<think>not public',createdAt:started},
  {id:'thinking',text:'<thinking>private alternate reasoning</thinking>',createdAt:started},
  {id:'code',text:'```js\nreturn secret;\n```',createdAt:started},
  {id:'json',text:'{"private":"payload"}',createdAt:started}
 ]});
 assert.equal(safe.length,1);assert.equal(safe[0].text,'公开记录：保持原有尺寸。');
 const technical=[
  {id:'failure',text:'保留原有结构。\n工具调用失败：edit_scene node-abc123 {"operations":[]} Error: invalid materialId',createdAt:started},
  {id:'legacy-json',text:'继续检查比例。\n{\n"nodeIds": ["node-secret"],\n"private": "payload"\n}',createdAt:started+1}
 ];
 const sanitized=progressFeed({status:'failed'},{explanations:technical,timings:[{...timings[1],summary:'保持主体结构。\n工具调用失败：edit_scene node-abc123 {"operations":[]} Error: invalid materialId'}]});
 assert.deepEqual(sanitized.filter(row=>row.kind==='explanation').map(row=>row.text),['保留原有结构。','继续检查比例。']);assert.equal(sanitized.find(row=>row.kind==='action').summary,'保持主体结构。');
 for(const hidden of ['edit_scene','node-abc123','operations','Error','materialId','node-secret','payload'])assert.equal(JSON.stringify(sanitized).includes(hidden),false,hidden);
 assert.equal(technical[0].text.includes('edit_scene'),true,'rendering never rewrites saved explanations');
 const {generationFailureMessage,sanitizeGenerationText}=await server.ssrLoadModule('/src/domain/generationFailure.ts');
 for(const [raw,expected] of [
  ['HTTP 401 Unauthorized {"error":"invalid key"}',/检查访问凭证/],
  ['体验页访问验证未通过（HTTP 401）',/重新登录体验页/],
  ['TypeError: Failed to fetch https://secret.example/v1',/检查网络连接/],
  ['等待超过 3 分钟，已停止本次接收',/恢复输入后手动重试/],
  ['PROXY_UPSTREAM_DENIED https://private.example',/检查模型配置/],
  ['HTTP 503 Bad gateway',/模型服务暂时不可用/],
  ['unknown command edit_scene node-abc123 materialId {"operations":[]}',/失败原因/]
 ])for(const previewRetained of [false,true]){
  const message=generationFailureMessage(raw,{previewRetained});assert.match(message,expected);assert.match(message,previewRetained?/已保留之前的预览/:/场景未修改/);
  for(const hidden of ['HTTP','401','503','JSON','edit_scene','node-abc123','materialId','operations','secret.example','private.example','PROXY_UPSTREAM_DENIED'])assert.equal(message.includes(hidden),false,hidden);
  assert.equal(sanitizeGenerationText(message,{failed:true,previewRetained}),message,'safe messages retain their recovery guidance');
 }
 assert.equal(sanitizeGenerationText('主体已保留。\nsetNodeTransform invalid materialId node-123'), '主体已保留。');
 console.log('PASS technical failure blocks stay diagnostic-only and recovery guidance remains actionable');
 const many=Array.from({length:60},(_,index)=>({id:String(index),phase:'building',text:`公开说明 ${index}`,createdAt:started+index}));
 assert.deepEqual(progressFeed({status:'completed'},{explanations:many}).map(row=>row.text),many.map(item=>item.text),'every distinct public explanation remains a separate visible record');
 const repeated=Array.from({length:3},(_,index)=>({id:`repeat-${index}`,kind:'tool',toolName:'edit_scene',label:'private',startedAt:started+index*10,endedAt:started+index*10+5,summary:'调整部件位置。'}));
 const compressed=progressFeed({status:'running'},{timings:repeated});assert.equal(compressed.length,1);assert.equal(compressed[0].count,3);assert.equal(compressed[0].status,'completed');assert.equal(compressed[0].summary,'调整部件位置。');
 const unfinished={...repeated[0],id:'unfinished',startedAt:started+40,endedAt:undefined};
 const failed={...repeated[0],id:'failed',startedAt:started+50,endedAt:started+55,failed:true};
 const distinct=progressFeed({status:'running'},{timings:[...repeated,unfinished,failed]});assert.deepEqual(distinct.map(row=>[row.status,row.count]),[['completed',3],['running',1],['failed',1]],'unfinished or failed actions cannot disappear into successful repetitions');
 const separated=progressFeed({status:'completed'},{timings:[repeated[0],repeated[1]],explanations:[{id:'between',text:'保持操作通道畅通。',createdAt:started+7}]});assert.deepEqual(separated.map(row=>row.kind),['action','explanation','action']);
 assert.equal(progressFeed({status:'completed'},{timings:[repeated[0],{...repeated[1],summary:'调整另一部件。'}]}).length,2,'different public results stay distinct');
 assert.equal(progressFeed({status:'running'},{timings:[{...unfinished,repeatedInput:true}]}).length,0,'duplicate input rejected before execution is not an observed action');
 console.log('PASS every distinct explanation survives and only consecutive successful equivalent actions compress');
}finally{await server.close();}
