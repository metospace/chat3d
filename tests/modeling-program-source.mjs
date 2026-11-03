import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
try{
 const {readSource,editSource}=await server.ssrLoadModule('/src/ai/modelingProgramSource.ts');
 const {modelingProgramSource}=await server.ssrLoadModule('/src/ai/modelingProgramDraft.ts');
 const source=['const width = 4;','let depth = 2;','const title = "Body";','// function imaginary() {}','const label = "const misleading = 100;";','function makeBody(size) {','  return size * width;','}','const makeWheel = (radius) => radius * 2;','class Builder {}','return makeBody(depth);'].join('\n');
 const options=()=>({expectedVersion:readSource(source).version,patches:[{find:'width = 4',replace:'width = 5'}]});
 test('default is a bounded metadata, declaration and parameter summary, not source',()=>{
  const view=readSource(source);
  assert.equal(view.mode,'summary');assert.equal(view.chars,source.length);assert.equal(view.lineCount,11);
  assert.equal(view.source,undefined);assert.equal(view.window,undefined);assert.equal(view.matches,undefined);
  assert.deepEqual(view.directory.map(item=>[item.name,item.kind,item.line]),[['width','variable',1],['depth','variable',2],['title','variable',3],['label','variable',5],['makeBody','function',6],['makeWheel','function',9],['Builder','class',10]]);
  assert.ok(!view.directory.some(item=>item.name==='imaginary'||item.name==='misleading'));
  assert.deepEqual(view.parameterHeader.slice(0,3),[{name:'width',line:1,value:'4'},{name:'depth',line:2,value:'2'},{name:'title',line:3,value:'"Body"'}]);
  assert.ok(!JSON.stringify(view).includes('return size * width'));
  assert.ok(view.hint.includes('startLine=1..11'));assert.ok(view.hint.includes(`startChar=0..${source.length}`));
  assert.ok(view.hint.includes('{"startLine":1,"endLine":11}'));assert.ok(view.hint.includes(`{"startChar":0,"endChar":${source.length}}`));
  assert.ok(view.hint.includes('query'));assert.ok(view.hint.includes('nextChar'));
  const large=readSource(Array.from({length:1000},(_,i)=>`const parameter${i} = ${i};`).join('\n'));
  assert.equal(large.directory.length,40);assert.equal(large.declarationCount,1000);assert.equal(large.directoryTruncated,true);assert.equal(large.parameterHeader.length,12);
  assert.ok(JSON.stringify(large).length<12000);
 });
 test('version is deterministic, mode-independent and changes with UTF-16 source content',()=>{
  assert.equal(readSource(source).version,readSource(source,{startLine:2,endLine:3}).version);
  assert.equal(readSource(source).version,readSource(source,{query:'width'}).version);
  assert.equal(readSource('😀\r\n').chars,4);assert.equal(readSource('😀\r\n').lineCount,2);
  assert.equal(readSource(source).version,readSource(`${source}`).version);
  assert.notEqual(readSource('ab').version,readSource('ba').version);
  assert.notEqual(readSource(source).version,readSource(source+' ').version);
 });
 test('line ranges are exact and paginate without returning more than 120 lines or 12000 chars',()=>{
  const view=readSource(source,{startLine:6,endLine:8});
  assert.equal(view.window.text,'function makeBody(size) {\n  return size * width;\n}\n');
  assert.equal(view.window.startLine,6);assert.equal(view.window.endLine,8);assert.equal(view.nextLine,9);
  const many=Array.from({length:250},(_,i)=>`line ${i+1}`).join('\n'),page=readSource(many,{startLine:1});
  assert.equal(page.window.endLine,120);assert.equal(page.nextLine,121);
  assert.equal(readSource(many,{startLine:241,endLine:250}).nextLine,undefined);
  const oversized=readSource(many,{startLine:1,endLine:10000});assert.equal(oversized.window.endLine,120);assert.equal(oversized.nextLine,121);assert.equal(oversized.nextChar,oversized.window.endChar);
  const wide=Array.from({length:20},()=> 'x'.repeat(1000)).join('\n'),widePage=readSource(wide,{startLine:1,endLine:20});
  assert.equal(widePage.window.endLine,11);assert.equal(widePage.nextLine,12);assert.ok(widePage.window.text.length<=12000);
  assert.equal(readSource('a\r\nb\r\n',{startLine:2,endLine:2}).window.text,'b\r\n');
  assert.equal(readSource('a\n',{startLine:2,endLine:2}).window.text,'');
 });
 test('minified long lines return bounded partial windows with exact character continuation',()=>{
  const minified='const root=0;'+ 'root++;'.repeat(7000);
  assert.equal(readSource(minified).mode,'summary');
  const linePage=readSource(minified,{startLine:1,endLine:1});
  assert.equal(linePage.mode,'lines');assert.equal(linePage.window.text,minified.slice(0,12000));assert.equal(linePage.nextChar,12000);assert.equal(linePage.nextLine,1);assert.equal(linePage.chars,minified.length);assert.equal(linePage.lineCount,1);
  const page=readSource(minified,{startChar:0});assert.equal(page.window.text.length,12000);assert.equal(page.nextChar,12000);assert.equal(page.nextLine,1);
  const next=readSource(minified,{startChar:page.nextChar,endChar:page.nextChar+200});assert.equal(next.window.text,minified.slice(12000,12200));
  assert.equal(readSource(minified,{startChar:0,endChar:12001}).window.text,minified.slice(0,12000));
  assert.equal(readSource(minified,{startChar:minified.length}).window.text,'');
 });
 test('ordinary end selectors beyond EOF clamp without changing integer or ordering validation',()=>{
  for(const value of ['', 'a', 'a\n', 'a\r\nb\r\n', '😀\nend']){
   const meta=readSource(value),line=readSource(value,{startLine:1,endLine:Number.MAX_SAFE_INTEGER}),chars=readSource(value,{startChar:0,endChar:Number.MAX_SAFE_INTEGER});
   assert.equal(line.window.text,value);assert.equal(chars.window.text,value);
   assert.equal(line.window.endChar,value.length);assert.equal(chars.window.endChar,value.length);
   assert.equal(line.window.endLine,meta.lineCount);assert.equal(line.nextChar,undefined);assert.equal(chars.nextChar,undefined);
   assert.equal(readSource(value,{startLine:meta.lineCount,endLine:meta.lineCount+100}).window.text,value.slice(value.lastIndexOf('\n')+1));
   assert.equal(readSource(value,{startChar:value.length,endChar:value.length+100}).window.text,'');
   assert.equal(readSource(value,{query:'absent',startChar:value.length}).matches.length,0);
  }
 });
 test('oversized line and character pages reconstruct all source with no skipped or repeated UTF-16 units',()=>{
  const inputs=[Array.from({length:370},(_,i)=>`line ${i} 😀\r\n`).join(''), '😀'.repeat(14000)+'\nend', Array.from({length:20},()=> 'x'.repeat(1000)).join('\n'), 'head\n'+'x'.repeat(24001)+'\n'+'tail\n'.repeat(130), '\n'.repeat(300)];
  for(const text of inputs)for(const initial of [{startLine:1,endLine:100000},{startChar:0,endChar:100000}]){
   let opts=initial,joined='',expectedStart=0;
   for(let pages=0;;pages++){
    assert.ok(pages<100,'pagination must terminate');
    const page=readSource(text,opts),view=page.window;
    assert.equal(view.startChar,expectedStart);assert.equal(view.text,text.slice(view.startChar,view.endChar));
    assert.ok(view.text.length<=12000);assert.ok(view.endLine-view.startLine+1<=120);
    joined+=view.text;expectedStart=view.endChar;
    if(page.nextChar===undefined){assert.equal(view.endChar,text.length);break;}
    assert.equal(page.nextChar,view.endChar);assert.ok(page.nextChar>view.startChar);
    opts={startChar:page.nextChar,endChar:100000};
   }
   assert.equal(joined,text);
  }
  const shortLines=Array.from({length:300},()=> 'a').join('\n'),page=readSource(shortLines,{startChar:0,endChar:shortLines.length});
  assert.equal(page.window.endLine,120);assert.equal(page.nextLine,121);assert.equal(page.nextChar,240);
 });
 test('out-of-range start cursors explain actual bounds in Chinese, including query cursors',()=>{
  for(const text of ['',source]){
   const meta=readSource(text);
   for(const opts of [{startLine:meta.lineCount+1},{startChar:meta.chars+1},{query:'x',startLine:meta.lineCount+1},{query:'x',startChar:meta.chars+1}]){
    assert.throws(()=>readSource(text,opts),error=>error.message.includes(`lineCount=${meta.lineCount}`)&&error.message.includes(`chars=${meta.chars}`)&&error.message.includes(`1..${meta.lineCount}`)&&error.message.includes(`0..${meta.chars}`)&&error.message.includes('有效游标'));
   }
  }
 });
 test('literal search returns bounded context, exact offsets and resumable cursors',()=>{
  const literal=readSource('before a.b after aXb end',{query:'a.b'});
  assert.equal(literal.matches.length,1);assert.equal(literal.matches[0].matchStartChar,7);assert.equal(literal.matches[0].matchEndChar,10);
  const many=('p'.repeat(2000)+'needle'+'s'.repeat(2000)+'\n').repeat(12),first=readSource(many,{query:'needle'});
  assert.equal(first.matches.length,8);assert.ok(first.nextLine);assert.ok(first.nextChar);
  assert.ok(first.matches.every(match=>match.text.length<=486));assert.ok(first.matches.reduce((n,match)=>n+match.text.length,0)<=12000);
  const rest=readSource(many,{query:'needle',startChar:first.nextChar});assert.equal(rest.matches.length,4);assert.equal(rest.nextChar,undefined);
  assert.equal(new Set([...first.matches,...rest.matches].map(match=>match.matchStartChar)).size,12);
  assert.equal(readSource(many,{query:'absent'}).matches.length,0);
  const oneLine='x '.repeat(100)+'end',a=readSource(oneLine,{query:'x'}),b=readSource(oneLine,{query:'x',startChar:a.nextChar});
  assert.equal(b.matches[0].matchStartChar,16);
  const multiline='before\n'.repeat(20)+'unique\nvalue\n'+'after\n'.repeat(20),context=readSource(multiline,{query:'unique\nvalue'}).matches[0];
  assert.ok(context.text.includes('unique\nvalue'));assert.ok(context.endLine-context.startLine<120);
 });
 test('read selectors reject malformed, conflicting and unsafe options instead of silently ignoring them',()=>{
  for(const opts of [{query:''},{query:'a'.repeat(1001)},{query:'a\n'.repeat(116)},{startLine:0},{startLine:1.5},{startLine:NaN},{startLine:99},{startLine:undefined},{endLine:2},{startLine:3,endLine:2},{startLine:1,endLine:NaN},{startLine:1,endLine:Infinity},{startLine:1,endLine:1.5},{startLine:1,endLine:Number.MAX_SAFE_INTEGER+1},{startChar:-1},{startChar:Infinity},{startChar:undefined},{endChar:2},{startChar:3,endChar:2},{startChar:0,endChar:NaN},{startChar:0,endChar:Infinity},{startChar:0,endChar:1.5},{startChar:0,endChar:Number.MAX_SAFE_INTEGER+1},{startLine:1,startChar:0},{query:'a',endLine:1},{query:'a',endChar:1},{path:'any.path'},JSON.parse('{"__proto__":{}}'),Object.create({query:'width'})])assert.throws(()=>readSource(source,opts));
  assert.throws(()=>readSource(source,{startLine:1,startChar:0}),/不能混用/);
  for(const opts of [{query:'a',endLine:1},{query:'a',endChar:1}])assert.throws(()=>readSource(source,opts),/不能配 endLine\/endChar/);
  let getterRuns=0;const getter={get query(){getterRuns++;return 'width';}};assert.throws(()=>readSource(source,getter),/accessors/);assert.equal(getterRuns,0);
  assert.throws(()=>readSource(source,null));assert.throws(()=>readSource(42));
 });
 test('literal patches apply simultaneously, preserve unrelated source and report current metadata',()=>{
  const args=options();args.patches.push({find:'depth = 2',replace:'depth = 3'});
  const before=JSON.stringify(args),edited=editSource(source,args);
  assert.equal(edited.source,source.replace('width = 4','width = 5').replace('depth = 2','depth = 3'));
  assert.equal(edited.patchCount,2);assert.equal(edited.chars,edited.source.length);assert.equal(edited.lineCount,11);assert.equal(edited.version,readSource(edited.source).version);
  assert.notEqual(edited.version,args.expectedVersion);assert.equal(JSON.stringify(args),before);assert.equal(source.includes('width = 4'),true);
  const text='alpha beta',swapped=editSource(text,{expectedVersion:readSource(text).version,patches:[{find:'beta',replace:'alpha'},{find:'alpha',replace:'beta'}]});
  assert.equal(swapped.source,'beta alpha');
  const literal=editSource('target',{expectedVersion:readSource('target').version,patches:[{find:'target',replace:'$& $` $\' __proto__'}]});assert.equal(literal.source,'$& $` $\' __proto__');
 });
 test('stale, missing, duplicate, overlapping and no-op patches are rejected atomically',()=>{
  assert.throws(()=>editSource(source,{...options(),expectedVersion:'stale'}),/Stale/);
  assert.throws(()=>editSource(source,{...options(),patches:[{find:'absent',replace:'changed'}]}),/did not match/);
  assert.throws(()=>editSource(source,{...options(),patches:[{find:'width',replace:'size'}]}),/ambiguous/);
  assert.throws(()=>editSource('aaa',{expectedVersion:readSource('aaa').version,patches:[{find:'aa',replace:'x'}]}),/ambiguous/);
  assert.throws(()=>editSource(source,{...options(),patches:[{find:'width = 4',replace:'x'},{find:'const width = 4;',replace:'y'}]}),/overlap/);
  assert.throws(()=>editSource(source,{...options(),patches:[{find:'width = 4',replace:'x'},{find:'width = 4',replace:'y'}]}),/overlap/);
  assert.throws(()=>editSource(source,{...options(),patches:[{find:'width = 4',replace:'width = 4'}]}),/no change/);
  assert.throws(()=>editSource('ab',{expectedVersion:readSource('ab').version,patches:[{find:'a',replace:''},{find:'b',replace:'ab'}]}),/no change/);
  const edited=editSource(source,options());assert.throws(()=>editSource(edited.source,options()),/Stale/);
 });
 test('patch counts, source budget, required fields and prototype-unsafe inputs are guarded',()=>{
  for(const patches of [[],Array(9).fill({find:'a',replace:'b'}),[{find:'',replace:'x'}],[{find:'width'}],[{replace:'x'}],[{find:'width',replace:4}],[{find:'width = 4',replace:'x',path:'arbitrary.path'}],[JSON.parse('{"find":"width = 4","replace":"x","__proto__":{}}')],[Object.create({find:'width = 4',replace:'x'})],new Array(1)])assert.throws(()=>editSource(source,{...options(),patches}));
  assert.throws(()=>editSource(source,{...options(),path:'any.path'}));
  assert.throws(()=>editSource(source,JSON.parse('{"__proto__":{}}')));
  const accessor=[];Object.defineProperty(accessor,'0',{get(){throw Error('must not execute getter');},enumerable:true});
  assert.throws(()=>editSource(source,{...options(),patches:accessor}),/accessors/);
  const exact=editSource('x',{expectedVersion:readSource('x').version,patches:[{find:'x',replace:'a'.repeat(80000)}]});assert.equal(exact.chars,80000);
  assert.throws(()=>editSource('x',{expectedVersion:readSource('x').version,patches:[{find:'x',replace:'a'.repeat(80001)}]}),/80000/);
  const eight='abcdefgh',result=editSource(eight,{expectedVersion:readSource(eight).version,patches:[...eight].map(find=>({find,replace:find.toUpperCase()}))});assert.equal(result.patchCount,8);assert.equal(result.source,'ABCDEFGH');
 });
 test('inspection and editing never execute code',()=>{
  const script='throw new Error("never execute"); globalThis.__sourceHelperExecuted = true;';
  delete globalThis.__sourceHelperExecuted;
  readSource(script);readSource(script,{query:'throw'});
  editSource(script,{expectedVersion:readSource(script).version,patches:[{find:'true',replace:'false'}]});
  assert.equal(globalThis.__sourceHelperExecuted,undefined);
 });
 test('component source stays internally available but parts are bounded without IDs',()=>{
  const nodes=Array.from({length:517},(_,i)=>({id:`part-${i}`,assemblyId:'component',name:`Part ${i}`,...(i===0?{modelingProgram:{source,createdAt:123}}:{})}));
  const saved=modelingProgramSource({nodes},'component');
  assert.equal(saved.source,source);assert.equal(saved.createdAt,123);assert.equal(saved.parts.count,517);assert.equal(saved.parts.names.length,12);assert.equal(saved.parts.truncated,true);assert.ok(!JSON.stringify(saved.parts).includes('part-'));
  assert.throws(()=>modelingProgramSource({nodes},'missing'),/组件不存在/);
  assert.throws(()=>modelingProgramSource({nodes:[{id:'bare',name:'No source'}]},'bare'),/没有参数化源码/);
 });
 console.log(`${passed} bounded modeling source checks passed`);
}finally{await server.close();}
