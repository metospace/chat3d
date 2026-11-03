import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {workTimeline,workTimelineTime}=await server.ssrLoadModule('/src/ui/chat/workTimeline.ts');
 const started=new Date(2026,10,3,9,7,5).getTime();
 const timings=[
  {id:'model-1',kind:'model',label:'第1轮模型响应',phase:'planning',startedAt:started-100,endedAt:started+100},
  {id:'build',kind:'tool',toolName:'build_modeling_program',label:'build_modeling_program',phase:'building',startedAt:started+1000,endedAt:started+9000,summary:'工具摘要不可见',detail:'Error: private raw failure',failed:true},
  {id:'review',kind:'tool',label:'检查连接',phase:'reviewing',startedAt:started+10000,endedAt:started+11000,summary:'工具复核不可见'}
 ];
 const explanations=[
  {id:'design-b',phase:'planning',text:'按五层结构安排横梁。',createdAt:started+500},
  {id:'design-a',phase:'planning',text:'保留原有布局。',createdAt:started},
  {id:'design-repeat',phase:'planning',text:'保留原有布局。',createdAt:started+750},
  {id:'build-a',phase:'building',text:'先建立立柱，再布置横梁。',createdAt:started+2000},
  {id:'build-b',phase:'building',text:'保持立柱间距一致。',createdAt:started+3000},
  {id:'review-a',phase:'reviewing',text:'接下来核对横梁与立柱的接触。',createdAt:started+4000},
  {id:'refine-a',phase:'repairing',text:'调整横梁端部的位置。',createdAt:started+5000},
  {id:'build-again',phase:'building',text:'补充背面的支撑。',createdAt:started+6000}
 ];
 const rows=workTimeline({status:'running'},{timings,explanations});
 assert.deepEqual(rows.map(row=>row.phase),['planning','building','reviewing','repairing','building']);
 assert.deepEqual(rows.map(row=>row.text),['保留原有布局。\n\n按五层结构安排横梁。','先建立立柱，再布置横梁。\n\n保持立柱间距一致。','接下来核对横梁与立柱的接触。','调整横梁端部的位置。','补充背面的支撑。']);
 assert.ok(rows.every(row=>row.kind==='explanation'));
 assert.equal(rows[0].startedAt,started);assert.equal(rows[0].endedAt,started+750,'duplicate prose still has a real last explanation timestamp');
 assert.equal(rows[1].startedAt,started+2000);assert.equal(rows[1].endedAt,started+3000,'tool end time is never used for prose');
 assert.equal(rows.at(-1).status,'running');assert.ok(rows.slice(0,-1).every(row=>row.status==='ended'));
 const visible=JSON.stringify(rows);for(const secret of ['build_modeling_program','第1轮','工具摘要不可见','工具复核不可见','private raw failure'])assert.ok(!visible.includes(secret));
 assert.deepEqual(workTimeline({status:'running'},{timings}),[],'tool-only activity never synthesizes visible events');
 console.log('PASS only public prose renders, consecutive phases merge, distinct prose stays ordered and execution rows stay hidden');
 for(const status of ['preview','completed'])assert.ok(workTimeline({status},{timings,explanations}).every(row=>row.status==='ended'));
 for(const status of ['failed','stopped']){
  const history=workTimeline({status},{timings,explanations});assert.equal(history.at(-1).status,'interrupted');assert.equal(history[0].status,'ended');
 }
 assert.equal(workTimeline({status:'running'},{phase:'reviewing',explanations:[explanations[0]]})[0].status,'ended','a later live phase does not mark old prose as ongoing');
 const legacy=workTimeline({status:'completed'},{timings,explanations:[
  {id:'explanation-1',text:'旧版设计说明。',createdAt:started},
  {id:'during-build',text:'旧版构建说明。',createdAt:started+1500},
  {id:'unknown',text:'旧版未注明阶段。',createdAt:started+12000},
  {id:'undated',text:'保留未注明时间的旧记录。'}
 ]});
 assert.deepEqual(legacy.map(row=>row.phase),['planning','building',undefined]);assert.equal(legacy[2].title,'工作进展');
 const undated=workTimeline({status:'completed'},{explanations:[{id:'old',text:'无日期的公开说明。'}]})[0];
 assert.equal(undated.startedAt,undefined);assert.equal(undated.endedAt,undefined);assert.equal(undated.status,'recorded');
 const ambiguous=workTimeline({status:'running'},{timings:[...timings,{id:'overlap',kind:'model',label:'private',phase:'reviewing',startedAt:started+1000,endedAt:started+3000}],explanations:[{id:'legacy',text:'不能猜测阶段。',createdAt:started+2000}]});
 assert.equal(ambiguous[0].phase,undefined);
 const explicit=workTimeline({status:'running'},{timings,explanations:[{id:'explanation-1',phase:'repairing',text:'显式阶段优先。',createdAt:started}]});assert.equal(explicit[0].phase,'repairing');
 for(const invalid of [undefined,NaN,Infinity,Number.MAX_VALUE])assert.equal(workTimelineTime(invalid),'时间未记录');
 assert.equal(workTimelineTime(started),'09:07:05');assert.equal(workTimelineTime(started+3500),'09:07:08');
 console.log('PASS statuses never imply successful execution, legacy phase association is conservative and timestamps are not invented');
 const safe=workTimeline({status:'running'},{timings,explanations:[
  {id:'reasoning',text:'<think>private reasoning</think>公开记录：保持原有尺寸。',createdAt:started},
  {id:'unfinished-private',text:'<think>not public',createdAt:started},
  {id:'code',text:'```js\nreturn secret;\n```',createdAt:started},
  {id:'json',text:'{"private":"payload"}',createdAt:started}
 ]});
 assert.equal(safe.length,1);assert.equal(safe[0].text,'公开记录：保持原有尺寸。');
 const technical=[
  {id:'failure',text:'保留原有结构。\n工具调用失败：edit_scene node-abc123 {"operations":[]} Error: invalid materialId',createdAt:started},
  {id:'legacy-json',text:'继续检查比例。\n{\n"nodeIds": ["node-secret"],\n"private": "payload"\n}',createdAt:started+1}
 ];
 const sanitized=workTimeline({status:'failed'},{explanations:technical,timings});
 assert.equal(sanitized[0].text,'保留原有结构。\n\n继续检查比例。');
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
  ['unknown command edit_scene node-abc123 materialId {"operations":[]}',/你可以继续描述要修改的地方/]
 ])for(const previewRetained of [false,true]){
  const message=generationFailureMessage(raw,{previewRetained});assert.match(message,expected);assert.match(message,previewRetained?/已保留之前的预览/:/场景未修改/);
  for(const hidden of ['HTTP','401','503','JSON','edit_scene','node-abc123','materialId','operations','secret.example','private.example','PROXY_UPSTREAM_DENIED'])assert.equal(message.includes(hidden),false,hidden);
  assert.equal(sanitizeGenerationText(message,{failed:true,previewRetained}),message,'safe messages retain their recovery guidance');
 }
 assert.equal(sanitizeGenerationText('主体已保留。\nsetNodeTransform invalid materialId node-123'), '主体已保留。');
 console.log('PASS technical failure blocks stay diagnostic-only and recovery guidance remains actionable');
 const many=Array.from({length:60},(_,index)=>({id:String(index),phase:'building',text:`公开说明 ${index}`,createdAt:started+index}));
 const merged=workTimeline({status:'completed'},{explanations:many});assert.equal(merged.length,1);assert.deepEqual(merged[0].text.split('\n\n'),many.map(item=>item.text));
 console.log('PASS private payloads stay hidden and merging preserves every distinct public explanation');
}finally{await server.close();}
