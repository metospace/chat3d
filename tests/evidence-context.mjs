import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let checks=0;
try{
 const {EvidenceContext}=await server.ssrLoadModule('/src/ai/evidenceContext.ts');
 const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
 const image=(key)=>({type:'image',data:Buffer.from(key).toString('base64'),mimeType:'image/png'});
 const packet=(id,{revision=18,scope='whole',views=['front','side'],tool='capture_multiview',details={},text=''}={})=>({role:'toolResult',toolCallId:id,toolName:tool,isError:false,timestamp:0,details:{revision,scope,...details},content:views.flatMap((view,index)=>[{type:'text',text:`${text} revision=${revision} scope=${scope} view=${view}`},image(id+index)])});
 const call=(result)=>({role:'assistant',content:[{type:'toolCall',id:result.toolCallId,name:result.toolName,arguments:{views:['front','side']}}],timestamp:0});
 const images=(messages)=>messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='image'):[]);
 const pixels=(messages)=>images(messages).map(part=>part.data);
 const texts=(messages)=>messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='text').map(part=>part.text):[message.content]).join('\n');
 const recallMessage=(result,id='recall')=>({role:'toolResult',toolCallId:id,toolName:'recall_evidence',isError:false,timestamp:0,...result});

 check('six generated-image boundary is exact, reference images remain uncapped and originals immutable',()=>{
  const context=new EvidenceContext(),captures=[packet('a'),packet('b',{scope:'B'}),packet('c',{scope:'C'}),packet('d',{scope:'D'})];
  const references={role:'user',content:[{type:'text',text:'Keep all references and fix the observed shape'},...Array.from({length:9},(_,index)=>image('reference'+index))],timestamp:0};
  const messages=[references,...captures.flatMap(result=>[call(result),result])],before=structuredClone(messages);
  const projected=context.project(messages);
  assert.equal(context.activeImageCount,6);assert.equal(images(projected).length,15);assert.equal(projected[0],references);assert.deepEqual(messages,before);
  assert.deepEqual(projected.filter(message=>message.role==='assistant'),messages.filter(message=>message.role==='assistant'));
  assert.deepEqual(projected.filter(message=>message.role==='toolResult').map(message=>message.toolCallId),captures.map(message=>message.toolCallId));
  assert.ok(context.active().some(entry=>entry.images.some(item=>item.scopes.includes('whole'))));
  assert.ok(context.active().some(entry=>entry.images.some(item=>item.scopes.includes('D'))));
  assert.equal(context.list().captures.length,4);
 });
 check('latest whole and latest focused packets win when both fit',()=>{
  const context=new EvidenceContext(),whole=packet('whole'),focus=packet('focus',{scope:'hand',views:['front','side','back']});
  const projected=context.project([whole,packet('oldFocus',{scope:'other'}),focus]);
  for(const data of pixels([whole,focus]))assert.ok(pixels(projected).includes(data));
  assert.equal(context.activeImageCount,6);
 });
 check('original and recall share capture identity without collapsing equal pixels from distinct views',()=>{
  const context=new EvidenceContext(),first=packet('first'),duplicate=packet('duplicate',{scope:'component'});
  duplicate.content=structuredClone(first.content);context.project([first,duplicate]);
  assert.equal(context.activeImageCount,4);
  const page=context.recall({captureId:context.list().captures[0].captureId},18);
  const projected=context.project([first,duplicate,recallMessage(page)]);
  assert.equal(images(projected).length,4);assert.equal(new Set(pixels(projected)).size,2);
  assert.equal(images([projected[0]]).length,0);assert.equal(images([projected.at(-1)]).length,2);
  const symmetric=packet('symmetric');symmetric.content[3]=structuredClone(symmetric.content[1]);
  assert.equal(images(new EvidenceContext().project([symmetric])).length,2);
 });
 check('failure text, user instructions, non-capture images and pending call pairing stay untouched',()=>{
  const context=new EvidenceContext(),failure={...packet('failed'),isError:true,content:[{type:'text',text:'capture failed: actual renderer error'}]},user={role:'user',content:'Do not change the layout',timestamp:0};
  const unrelated={...packet('reference'),toolName:'read_reference'},messages=[user,call(failure),failure,unrelated];
  const projected=context.project(messages);
  assert.equal(projected[0],user);assert.equal(projected[1],messages[1]);assert.equal(projected[2],failure);assert.equal(projected[3],unrelated);assert.equal(context.list().total,0);
 });
 check('archived captures expose IDs and availability without acceptance claims; every catalog page is reachable',()=>{
  const context=new EvidenceContext(),messages=Array.from({length:29},(_,index)=>packet('catalog'+index,{scope:'object'+index}));
  const projected=context.project(messages),all=[];let offset=0;
  do{const page=context.list(offset,99);assert.ok(page.captures.length<=12);all.push(...page.captures);offset=page.nextOffset;}while(offset!==null);
  assert.equal(all.length,29);assert.equal(new Set(all.map(entry=>entry.captureId)).size,29);assert.equal(all[0].available,true);
  const catalog=JSON.parse(/availability only\): (\[.*\])\. All captures/.exec(texts(projected))[1]);assert.equal(catalog.length,12);
  assert.match(texts([projected[0]]),/capture-1/);assert.match(texts(projected),/offset=0, limit<=12/);assert.doesNotMatch(texts(projected),/passed|all reviewed|验收通过/);
  assert.equal(context.recall({captureId:all[0].captureId},18).details.evidenceRecall.count,2);
  assert.throws(()=>context.list(-1),/offset/);assert.throws(()=>context.list(0,0),/limit/);
 });
 check('recall pages have explicit cursors, at most three images, and correct half-open boundaries',()=>{
  const context=new EvidenceContext(),source=packet('large',{views:['front','side','back','left','top','bottom','underside']});context.project([source]);
  const captureId=context.list().captures[0].captureId;
  const first=context.recall({captureId,count:20},18),second=context.recall({captureId,startImage:first.details.evidenceRecall.nextImage},18),last=context.recall({captureId,startImage:second.details.evidenceRecall.nextImage},18);
  assert.equal(images([first]).length,3);assert.equal(images([second]).length,3);assert.equal(images([last]).length,1);
  assert.deepEqual(first.details.evidenceRecall.imageIndices,[0,1,2]);assert.equal(first.details.evidenceRecall.nextImage,3);assert.equal(last.details.evidenceRecall.nextImage,null);
  assert.deepEqual(pixels([first,second,last]),pixels([source]));assert.throws(()=>context.recall({captureId,startImage:7},18),/startImage/);assert.throws(()=>context.recall({captureId,count:0},18),/count/);assert.throws(()=>context.recall({captureId,startImage:1.5},18),/startImage/);
 });
 check('recall preserves every original marker and isolated/software/animation provenance without changing review state',()=>{
  for(const [tool,scope,details,text] of [
   ['capture_detail_diagnostic','diagnostic',{acceptanceEvidence:false},'隔离诊断图 hidden=9 not acceptance'],
   ['capture_component_intrinsic','intrinsic-hand',{intrinsicOnly:true},'software几何检查，材质未验收；连接与场景关系仍需上下文'],
   ['preview_animation','whole',{times:[0,1,2]},'动态样本 time=1.00s 不是完整碰撞或动画验收'],
  ]){
   const context=new EvidenceContext(),source=packet(tool,{scope,tool,details:{...details,capturedTurn:4,keys:['18:front:'+scope],reviewState:{status:'unknown'}},text}),original=structuredClone(source);
   context.project([source]);const before=context.active(),page=context.recall({captureId:context.list().captures[0].captureId,count:1},18);
   assert.deepEqual(page.content.filter(part=>part.type==='text'&&source.content.some(original=>original.type==='text'&&original.text===part.text)),source.content.filter(part=>part.type==='text'));
   for(const [key,value] of Object.entries(source.details))assert.deepEqual(page.details[key],value);
   assert.deepEqual(source,original);assert.deepEqual(context.active(),before);
  }
 });
 check('immutable archive survives mutations to original packets, projections, returned catalogs, and recall results',()=>{
  const context=new EvidenceContext(),source=packet('immutable',{details:{intrinsicOnly:true}}),original=structuredClone(source),projected=context.project([source]);
  source.content[0].text='tampered';source.content[1].data='tampered';source.details.intrinsicOnly=false;
  projected[0].content.find(part=>part.type==='image').data='tampered projection';context.list().captures[0].scopes.push('tampered');
  const id=context.list().captures[0].captureId,first=context.recall({captureId:id},18);first.content.find(part=>part.type==='image').data='tampered recall';first.details.intrinsicOnly=false;
  const second=context.recall({captureId:id},18);assert.deepEqual(pixels([second]),pixels([original]));assert.equal(second.details.intrinsicOnly,true);assert.ok(texts([second]).includes(original.content[0].text));assert.ok(!context.list().captures[0].scopes.includes('tampered'));
 });
 check('stale revision recall fails, stale pixels disappear after edits, and recall never refreshes a revision',()=>{
  const context=new EvidenceContext(),old=packet('old',{revision:17}),fresh=packet('fresh');context.project([old]);
  const captureId=context.list().captures[0].captureId,oldRecall=recallMessage(context.recall({captureId},17));
  assert.throws(()=>context.recall({captureId},18),/stale screenshots/);assert.throws(()=>context.recall({captureId:'missing'},18),/Unknown captureId/);
  const projected=context.prepare([old,oldRecall,fresh],undefined,18);
  assert.deepEqual(pixels(projected),pixels([fresh]));assert.equal(context.active().every(entry=>entry.revision===18),true);assert.equal(context.list().captures[0].revision,17);
  assert.equal(images(context.prepare([fresh],undefined,19)).length,0);
  const edit={role:'toolResult',toolName:'edit_scene',toolCallId:'edit',isError:false,timestamp:0,details:{revision:19},content:[{type:'text',text:'scene changed'}]};
  assert.equal(images(context.project([fresh,edit])).length,0);
 });
 check('explicit recalled old packet is active on the next request rather than immediately archived',()=>{
  const context=new EvidenceContext(),old=packet('recalled',{scope:'oldTarget'}),newer=Array.from({length:5},(_,index)=>packet('new'+index,{scope:'newTarget'+index}));
  context.project([old,...newer]);const id=context.list().captures[0].captureId,page=recallMessage(context.recall({captureId:id,count:1},18));
  const projected=context.project([old,...newer,page]);assert.equal(images([projected.at(-1)]).length,1);assert.ok(context.active().some(entry=>entry.captureId===id&&entry.images.some(image=>image.index===0)));assert.equal(images(projected).length,6);
  const followed=context.project([old,...newer,page,packet('afterRecall',{views:['front','side','back']})]);
  assert.equal(images([followed.at(-2)]).length,1);assert.equal(images(followed).length,6);
  assert.match(texts([followed.at(-2)]),/Recalled page cursor/);
 });
 check('prepare ingests originals before legacy compaction and restores only capture content',()=>{
  const context=new EvidenceContext(),source=packet('restore'),other={role:'toolResult',toolCallId:'read',toolName:'read_scene',isError:false,timestamp:0,content:[{type:'text',text:'huge old scene'}]};
  const compacted=[{...source,content:[{type:'text',text:'legacy screenshots omitted'}]},{...other,content:[{type:'text',text:'compacted scene'}]}];
  const projected=context.prepare([source,other],compacted,18);
  assert.deepEqual(pixels(projected),pixels([source]));assert.equal(projected[1],compacted[1]);assert.equal(context.list().total,1);
  assert.equal(context.project(projected).length,projected.length);assert.equal(context.list().total,1);
 });
 check('non-raw string details, JSON metadata and Chinese punctuation retain real marker identities',()=>{
  const context=new EvidenceContext(),source=packet('json');source.details=JSON.stringify({revision:18,intrinsicOnly:true});source.content=[{type:'text',text:JSON.stringify({revision:18,scope:'whole',componentId:'single-subject',view:'back'})},image('json'),{type:'text',text:'动态样本 time=1.00s revision=18 scope=whole；不是完整碰撞或动画验收'},image('time')];
  context.project([source]);const active=context.active()[0];assert.equal(active.revision,18);assert.deepEqual(active.images[0].scopes,['whole','single-subject']);assert.deepEqual(active.images[0].views,['back']);assert.deepEqual(active.images[1].scopes,['whole']);
  const recalled=context.recall({captureId:active.captureId},18);assert.equal(recalled.details.intrinsicOnly,true);assert.match(texts([recalled]),/不是完整碰撞或动画验收/);
 });
 check('animation sample packets of six images remain intact and isolated diagnostics retain exact scope',()=>{
  const context=new EvidenceContext(),old=packet('oldWhole'),animation=packet('animation',{tool:'preview_animation',views:['front','side','back','left','top','bottom'],details:{times:[0,1,2,3,4,5]}});
  animation.content=animation.content.map((part,index)=>part.type==='image'?image('equal-animation-pixels'):{type:'text',text:`动态样本 time=${index/2}.00s revision=18 scope=whole；不是完整碰撞或动画验收`});
  assert.equal(images(context.project([old,animation])).length,6);assert.deepEqual(context.active().map(entry=>entry.toolCallId),['animation']);
  const diagnostic=packet('diagnostic',{tool:'capture_detail_diagnostic',scope:'diagnostic'});context.project([diagnostic]);assert.deepEqual(context.active()[0].images[0].scopes,['diagnostic']);
 });
 check('separate run instances share neither capture IDs nor archives; absent or mixed revisions are not recalled',()=>{
  const a=new EvidenceContext(),b=new EvidenceContext();a.project([packet('runA')]);assert.equal(b.list().total,0);assert.throws(()=>b.recall({captureId:'capture-1'},18),/Unknown/);
  const missing=packet('unknown');missing.details={};missing.content=[{type:'text',text:'no revision'},image('unknown')];b.project([missing]);assert.equal(b.activeImageCount,0);assert.throws(()=>b.recall({captureId:'capture-1'},18),/unknown/);
  const mixed=packet('mixed');mixed.content[2].text='revision=19 scope=whole view=side';const c=new EvidenceContext();c.project([mixed]);assert.equal(c.list().captures[0].revision,null);assert.throws(()=>c.recall({captureId:'capture-1'},19),/unknown/);
 });
 console.log(`${checks} evidence-context behavioral checks passed (pure synthetic provenance, no rendering or quality claims)`);
}finally{await server.close();}
