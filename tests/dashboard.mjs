import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as httpServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {openTeam,teamMiddleware} from '../server/team/service.mjs';
import {decodeDashboardPackage} from '../shared/dashboard-package.mjs';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
const dir=await mkdtemp(join(tmpdir(),'scenivo-dashboard-'));
const oldPack={fileName:'dashboard.zip',entry:'index.html',base64:Buffer.from(zipSync({'index.html':strToU8('<!doctype html><h1>WMS</h1>'),'assets/main.js':strToU8('document.title="WMS"')})).toString('base64')};
let team,server,http;const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});globalThis.localStorage=dom.window.localStorage;
try{
 assert.equal(new TextDecoder().decode(decodeDashboardPackage({fileName:'screen.zip',entry:'index.html',files:{'index.html':strToU8('<h1>screen</h1>'),'assets/main.js':strToU8('document.title="WMS"')}})['assets/main.js']),'document.title="WMS"');
 for(const path of ['../escape.js','/absolute.js'])assert.throws(()=>decodeDashboardPackage({fileName:'bad.zip',entry:'index.html',files:{'index.html':strToU8('<h1>ok</h1>'),[path]:strToU8('bad')}}));
 console.log('PASS unsafe static resource paths remain rejected');
 team=openTeam(join(dir,'team.sqlite'));team.provision('admin','dashboard-password-strong','admin');team.provision('member','dashboard-password-strong','member');
 const admin=team.login('admin','dashboard-password-strong'),member=team.login('member','dashboard-password-strong');
 const middleware=teamMiddleware(team,()=>{});http=httpServer((req,res)=>middleware(req,res,()=>res.writeHead(404).end()));await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+http.address().port;
 const post=async(path,body,token=admin.token)=>{const response=await fetch(base+'/api/team/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const metadata={name:'产线运营',description:'生产运营大屏',system:'自定义生产系统',entry:'index.html',sourceKind:'folder',fileName:'产线大屏.zip',expectedVersion:0,key:crypto.randomUUID()};
 assert.equal((await post('dashboards/uploads',metadata,member.token)).status,403);
 const created=await post('dashboards/uploads',metadata);assert.equal(created.status,200,JSON.stringify(created.body));const root='dashboards/uploads/'+created.body.uploadId;
 const firstFile=await post(root+'/files',{path:'index.html',size:24});assert.equal(firstFile.status,200);const fileRoot=root+'/files/'+firstFile.body.fileId;
 assert.equal((await post(fileRoot+'/chunks',{offset:1,base64:Buffer.from('<h1>test</h1>').toString('base64')})).status,409);
 assert.equal((await post(root+'/complete',{})).status,409);
 assert.equal((await post(root+'/files',{path:'../outside.js',size:1})).status,400);
 assert.equal((await post(root+'/files',{path:'index.html/evil.js',size:1})).status,400);
 assert.equal((await post(root+'/files',{path:'secret.js',size:1},member.token)).status,403);
 const html=Buffer.from('<!doctype html><h1></h1>');assert.equal(html.length,24);
 assert.equal((await post(fileRoot+'/chunks',{offset:0,base64:html.toString('base64')})).body.offset,24);
 const css=Buffer.from('body{color:red}'),cssFile=await post(root+'/files',{path:'assets/main.css',size:css.length});await post(root+'/files/'+cssFile.body.fileId+'/chunks',{offset:0,base64:css.toString('base64')});
 const ancillary={'README.md':'# 大屏说明','scripts/build.py':'raise RuntimeError("must never execute")','src/App.vue':'<template>source only</template>','src/main.ts':'import App from "./App.vue"','vite.config.js':'import {defineConfig} from "vite"; export default defineConfig({});','.gitignore':'node_modules/','LICENSE':'source license'};
 for(const [path,text] of Object.entries(ancillary)){const bytes=Buffer.from(text),registered=await post(root+'/files',{path,size:bytes.length});assert.equal(registered.status,200,path);await post(root+'/files/'+registered.body.fileId+'/chunks',{offset:0,base64:bytes.toString('base64')});}
 const published=await post(root+'/complete',{});assert.equal(published.status,200,JSON.stringify(published.body));const first=published.body;assert.equal(first.version,1);
 assert.deepEqual((await post(root+'/complete',{})).body,first);
 assert.equal((await post('dashboards/uploads',{...metadata,name:'changed'})).status,409);
 const read=async suffix=>fetch(base+'/api/team/dashboards/'+first.id+'/'+first.version+suffix,{headers:{Authorization:'Bearer '+member.token}});
 const manifest=await(await read('')).json();assert.equal(manifest.system,'自定义生产系统');assert.equal(manifest.sourceKind,'folder');assert.deepEqual(manifest.files.map(f=>f.path).sort(),['assets/main.css','index.html',...Object.keys(ancillary)].sort());
 assert.deepEqual(Buffer.from(await(await read('/files?path=assets%2Fmain.css')).arrayBuffer()),css);
 const exported=unzipSync(new Uint8Array(await(await read('/source')).arrayBuffer()));assert.deepEqual(Buffer.from(exported['index.html']),html);assert.deepEqual(Buffer.from(exported['assets/main.css']),css);
 for(const [path,text] of Object.entries(ancillary))assert.equal(Buffer.from(exported[path]).toString(),text);
 assert.equal((await read('/files?path=../team.sqlite')).status,404);
 const stale=await post('dashboards/uploads',{...metadata,itemId:first.id,expectedVersion:0,key:crypto.randomUUID()});if(stale.status===200){const result=await post('dashboards/uploads/'+stale.body.uploadId+'/complete',{});assert.notEqual(result.status,200);}else assert.equal(stale.status,409);
 await post('dashboards/'+first.id+'/archive',{archived:true});assert.deepEqual(await(await fetch(base+'/api/team/dashboards',{headers:{Authorization:'Bearer '+member.token}})).json(),[]);assert.equal((await read('')).status,200);
 console.log('PASS custom system, chunk offset validation, incomplete files, admin enforcement, folder export, idempotency and immutable archived reads');
 const publishImages=async(files,extra={})=>{
  const initialized=await post('dashboards/uploads',{...metadata,...extra,key:crypto.randomUUID()});assert.equal(initialized.status,200,JSON.stringify(initialized.body));const uploadRoot='dashboards/uploads/'+initialized.body.uploadId;
  for(const [path,bytes] of Object.entries({'index.html':html,...files})){
   const registered=await post(uploadRoot+'/files',{path,size:bytes.length});assert.equal(registered.status,200,path);
   const chunk=await post(uploadRoot+'/files/'+registered.body.fileId+'/chunks',{offset:0,base64:bytes.toString('base64')});assert.equal(chunk.status,200,path);
  }
  const completed=await post(uploadRoot+'/complete',{});assert.equal(completed.status,200,JSON.stringify(completed.body));return completed.body;
 };
 const images=await publishImages({'assets/reference-full.png':Buffer.from('not actual render'),'cover.svg':Buffer.from('<svg onload="alert(1)"/>')});
 const imageRoot='dashboards/'+images.id+'/1',get=async(path,token=member.token)=>fetch(base+'/api/team/'+path,{headers:{Authorization:'Bearer '+token}});
 assert.equal((await get(imageRoot+'/screenshot/not-bound')).status,404);
 const {encode}=await import('fast-png');const pixels=new Uint8Array(320*180*4);pixels.fill(180);const png=Buffer.from(encode({width:320,height:180,data:pixels,channels:4,depth:8}));
 const {screenshotPng}=await import('../server/team/dashboard-screenshot.mjs'),{crc32,deflateSync}=await import('node:zlib'),{decode}=await import('fast-png');
 const chunk=(type,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;};
 for(const [color,channels] of [[0,1],[2,3],[4,2],[6,4]]){
  const width=320,height=180,stride=width*channels,raw=Buffer.alloc(stride*height),filtered=Buffer.alloc((stride+1)*height),header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color;
  for(let index=0;index<raw.length;index++)raw[index]=(index*37+Math.floor(index/stride)*19)%256;
  for(let y=0;y<height;y++){
   const filter=y%5;filtered[y*(stride+1)]=filter;
   for(let x=0;x<stride;x++){
    const index=y*stride+x,left=x>=channels?raw[index-channels]:0,up=y?raw[index-stride]:0,corner=y&&x>=channels?raw[index-stride-channels]:0;
    const p=left+up-corner,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-corner),predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?(left+up)>>>1:a<=b&&a<=c?left:b<=c?up:corner;
    filtered[y*(stride+1)+1+x]=(raw[index]-predictor)&255;
   }
  }
  const input=Buffer.concat([png.subarray(0,8),chunk('IHDR',header),chunk('tEXt',Buffer.from('source\0<script>not retained</script>')),chunk('IDAT',deflateSync(filtered)),chunk('IEND',Buffer.alloc(0))]),clean=screenshotPng(input.toString('base64'));
  assert.deepEqual(Buffer.from(decode(clean.bytes).data),raw);assert.equal(clean.bytes.includes(Buffer.from('<script>')),false);
  filtered[0]=5;const invalid=Buffer.concat([png.subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(filtered)),chunk('IEND',Buffer.alloc(0))]);assert.throws(()=>screenshotPng(invalid.toString('base64')),/过滤器/);
  const bomb=Buffer.concat([png.subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(filtered.length+1))),chunk('IEND',Buffer.alloc(0))]);assert.throws(()=>screenshotPng(bomb.toString('base64')),/解码/);
 }
 console.log('PASS all PNG filters and supported channels preserve decoded pixels; metadata removed, invalid filters and excess inflation rejected');
 const identity=await(await get(imageRoot+'/screenshot/info')).json();assert.match(identity.packageHash,/^[a-f0-9]{64}$/);
 const shotBody={packageHash:identity.packageHash,expectedScreenshotId:null,base64:png.toString('base64'),source:'受控桌面实际渲染 index.html，人工核对固定版本',capturedAt:new Date().toISOString(),confirmed:true};
 assert.equal((await post(imageRoot+'/screenshot',shotBody,member.token)).status,403);
 assert.equal((await get(imageRoot+'/screenshot/info','invalid')).status,401);
 for(const changed of [{confirmed:false},{packageHash:'0'.repeat(64)},{source:'https://evil.invalid\nscript'},{base64:Buffer.from('<svg onload="alert(1)"/>').toString('base64')},{base64:Buffer.from('<script>alert(1)</script>').toString('base64')},{base64:png.subarray(0,50).toString('base64')},{base64:Buffer.concat([png,Buffer.from('<script>')]).toString('base64')},{base64:'A'.repeat(12*1024*1024)}])assert.notEqual((await post(imageRoot+'/screenshot',{...shotBody,...changed})).status,200);
 const tiny=Buffer.from(encode({width:1,height:1,data:new Uint8Array(4),channels:4,depth:8}));assert.equal((await post(imageRoot+'/screenshot',{...shotBody,base64:tiny.toString('base64')})).status,400);
 const broken=Buffer.from(png);broken[broken.length-1]^=1;assert.equal((await post(imageRoot+'/screenshot',{...shotBody,base64:broken.toString('base64')})).status,400);
 const saved=await post(imageRoot+'/screenshot',shotBody);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.templateId,images.id);assert.equal(saved.body.version,1);assert.equal(saved.body.width,320);assert.equal(saved.body.height,180);assert.equal(saved.body.provenance,'admin-confirmed-local-render');
 const picture=await get(imageRoot+'/screenshot/'+saved.body.id);assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/png');assert.equal(picture.headers.get('x-content-type-options'),'nosniff');const decoded=(await import('fast-png')).decode(new Uint8Array(await picture.arrayBuffer()));assert.deepEqual(decoded.data,pixels);
 const listed=await(await get('dashboards')).json();assert.equal(listed.find(row=>row.id===images.id).screenshot.id,saved.body.id);assert.equal(listed.find(row=>row.id===images.id).packageHash,identity.packageHash);
 assert.equal((await post(imageRoot+'/screenshot',shotBody)).status,409);
 const other=await publishImages({});assert.equal((await post('dashboards/'+other.id+'/1/screenshot',shotBody)).status,409);
 assert.equal((await get('dashboards/'+other.id+'/1/screenshot/'+saved.body.id)).status,404);
 await publishImages({'new.js':Buffer.from('new version')},{itemId:images.id,expectedVersion:1});assert.equal((await get('dashboards/'+images.id+'/2/screenshot/'+saved.body.id)).status,404);assert.equal((await get(imageRoot+'/screenshot/'+saved.body.id)).status,200);
 const nextIdentity=await(await get('dashboards/'+images.id+'/2/screenshot/info')).json();assert.equal((await post('dashboards/'+images.id+'/2/screenshot',shotBody)).status,409);assert.notEqual(nextIdentity.packageHash,identity.packageHash);
 assert.equal((await post(imageRoot+'/screenshot/unbind',{expectedScreenshotId:saved.body.id},member.token)).status,403);
 assert.equal((await post(imageRoot+'/screenshot/unbind',{expectedScreenshotId:'stale'})).status,409);
 assert.equal((await post(imageRoot+'/screenshot/unbind',{expectedScreenshotId:saved.body.id})).status,200);assert.equal((await get(imageRoot+'/screenshot/'+saved.body.id)).status,404);
 console.log('PASS package assets never imply screenshots; authenticated PNG decode, limits, binding CAS, ID/version/hash isolation and unbinding');
 const archiveBytes=Buffer.from(zipSync({'index.html':html,'assets/main.css':css,...Object.fromEntries(Object.entries(ancillary).map(([path,text])=>[path,Buffer.from(text)]))}));
 const archiveMeta={...metadata,name:'ZIP 大屏',system:'企业 ERP',sourceKind:'file',fileName:oldPack.fileName,key:crypto.randomUUID()};
 const archiveInit=await post('dashboards/uploads',archiveMeta),archiveRoot='dashboards/uploads/'+archiveInit.body.uploadId;
 const archiveFile=await post(archiveRoot+'/files',{path:oldPack.fileName,size:archiveBytes.length});await post(archiveRoot+'/files/'+archiveFile.body.fileId+'/chunks',{offset:0,base64:archiveBytes.toString('base64')});
 const archivePublished=await post(archiveRoot+'/complete',{});assert.equal(archivePublished.status,200,JSON.stringify(archivePublished.body));
 const archiveExport=await fetch(base+'/api/team/dashboards/'+archivePublished.body.id+'/1/source',{headers:{Authorization:'Bearer '+member.token}});assert.deepEqual(Buffer.from(await archiveExport.arrayBuffer()),archiveBytes);
 const corrupt=Buffer.from(archiveBytes);const central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));corrupt.writeUInt32LE((corrupt.readUInt32LE(central+16)^1)>>>0,central+16);
 const corruptInit=await post('dashboards/uploads',{...archiveMeta,key:crypto.randomUUID()}),corruptRoot='dashboards/uploads/'+corruptInit.body.uploadId,corruptFile=await post(corruptRoot+'/files',{path:oldPack.fileName,size:corrupt.length});await post(corruptRoot+'/files/'+corruptFile.body.fileId+'/chunks',{offset:0,base64:corrupt.toString('base64')});assert.equal((await post(corruptRoot+'/complete',{})).status,400);
 console.log('PASS original ZIP export preserves bytes and corrupted archive cannot publish');
 const cancel=await post('dashboards/uploads',{...metadata,key:crypto.randomUUID()});await post('dashboards/uploads/'+cancel.body.uploadId+'/cancel',{});assert.notEqual((await post('dashboards/uploads/'+cancel.body.uploadId+'/complete',{})).status,200);
 await new Promise(resolve=>http.close(resolve));http=undefined;team.close();team=openTeam(join(dir,'team.sqlite'));assert.equal(team.dashboards.read(member.user,first.id,1).system,'自定义生产系统');
 console.log('PASS cancelled uploads cannot publish and published metadata survives reopen');
 // Exercise the on-disk migration against the actual previous schema and original package bytes.
 const legacyPath=join(dir,'legacy.sqlite'),db=new DatabaseSync(legacyPath);db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);CREATE TABLE dashboard_items(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),head INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);CREATE TABLE dashboard_versions(item TEXT NOT NULL REFERENCES dashboard_items(id),version INTEGER NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,system TEXT NOT NULL CHECK(system IN('WMS','MES','其他')),created TEXT NOT NULL,package TEXT NOT NULL,file_name TEXT NOT NULL,entry TEXT NOT NULL,PRIMARY KEY(item,version));CREATE TABLE dashboard_requests(user TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));CREATE TRIGGER dashboard_versions_no_update BEFORE UPDATE ON dashboard_versions BEGIN SELECT RAISE(ABORT,'immutable'); END;CREATE TRIGGER dashboard_versions_no_delete BEFORE DELETE ON dashboard_versions BEGIN SELECT RAISE(ABORT,'immutable'); END;`);db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0)').run('legacy-user','legacy','salt','hash','admin');db.prepare('INSERT INTO dashboard_items VALUES(?,?,1,0)').run('legacy-item','legacy-user');db.prepare('INSERT INTO dashboard_versions VALUES(?,1,?,?,?,?,?,?,?)').run('legacy-item','旧模板','保留原始包','WMS',new Date().toISOString(),JSON.stringify(oldPack),oldPack.fileName,oldPack.entry);db.close();
 const legacy=openTeam(legacyPath);try{const user={id:'legacy-user',role:'admin'},value=legacy.dashboards.read(user,'legacy-item',1);assert.equal(value.name,'旧模板');assert.equal(value.screenshot,undefined);assert.deepEqual(value.files.map(f=>f.path).sort(),['assets/main.js','index.html']);assert.equal(legacy.db.prepare('SELECT count(*) AS n FROM dashboard_versions').get().n,1);const identity=await legacy.dashboards.screenshotInfo(user,'legacy-item',1);assert.match(identity.packageHash,/^[a-f0-9]{64}$/);const result=await legacy.dashboards.bindScreenshot(user,'legacy-item',1,{...shotBody,packageHash:identity.packageHash});assert.equal(legacy.dashboards.list(user)[0].screenshot.id,result.id);assert.equal(legacy.dashboards.read(user,'legacy-item',1).files.length,2);}finally{legacy.close();}
 console.log('PASS previous package schema migrates without losing fixed versions');
 server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
 const {createEditorStore}=await server.ssrLoadModule('/src/store.ts'),{serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts'),{dashboardBinding}=await server.ssrLoadModule('/src/domain/dashboard.ts');
 const {selectDashboardFiles}=await server.ssrLoadModule('/src/domain/dashboardUpload.ts');
 const {parseDashboardCommand}=await server.ssrLoadModule('/src/domain/dashboard.ts');
 const {downloadDashboardSource}=await server.ssrLoadModule('/src/domain/dashboard.ts');
 // Destination selection must precede both network activity and source progress.
 const savedWindow=globalThis.window,savedTauri=globalThis.isTauri;
 globalThis.window=dom.window;globalThis.isTauri=true;
 try{
  const sourceItem={id:'source id',version:3,fileName:'源码.zip'},events=[],progress=[];let resolvePicker,committed;
  dom.window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
   events.push(command);
   if(command==='select_export_destination'){assert.deepEqual(args,{kind:'zip',filename:sourceItem.fileName});return new Promise(resolve=>{resolvePicker=resolve;});}
   if(command==='commit_export_file'){committed=args;return '/saved/source.zip';}
  }};
  const client={raw:async(path,options,signal)=>{
   events.push('fetch');assert.equal(path,'dashboards/source%20id/3/source');assert.equal(options,undefined);assert.ok(signal instanceof AbortSignal);
   return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3]));controller.close();}}),{headers:{'Content-Length':'3'}});
  }};
  const pending=downloadDashboardSource(client,sourceItem,value=>progress.push(value));
  assert.deepEqual(events,['select_export_destination']);assert.deepEqual(progress,[]);
  resolvePicker('source-token');assert.equal(await pending,'已保存到：/saved/source.zip');
  assert.deepEqual(events,['select_export_destination','fetch','commit_export_file']);assert.deepEqual(new Uint8Array(committed),new Uint8Array([1,2,3]));
  assert.deepEqual(progress,[{loaded:0},{loaded:0,total:3},{loaded:2,total:3},{loaded:3,total:3}]);
  const cancelled=downloadDashboardSource(client,sourceItem,value=>progress.push(value));resolvePicker(null);assert.equal(await cancelled,null);assert.equal(progress.length,4);assert.equal(events.filter(event=>event==='fetch').length,1);
  dom.window.__TAURI_INTERNALS__.invoke=async(command,args)=>{events.push(command);if(command==='select_export_destination')return 'fallback-token';if(command==='commit_export_file'){committed=args;return '/saved/source.html';}};
  const unknownProgress=[];
  await downloadDashboardSource({raw:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([4,5]));controller.close();}}))},sourceItem,value=>unknownProgress.push(value));
  assert.deepEqual(unknownProgress,[{loaded:0},{loaded:0},{loaded:2}]);assert.deepEqual(new Uint8Array(committed),new Uint8Array([4,5]));
  for(const length of [null,'','-1','1.5','Infinity','9007199254740992','3junk','0','3']){
   const updates=[],headers=new Headers();if(length!==null)headers.set('content-length',length);
   const response={headers,body:null,arrayBuffer:async()=>new Uint8Array([7,8,9]).buffer};
   await downloadDashboardSource({raw:async()=>response},{...sourceItem,fileName:'source.html'},value=>updates.push(value));
   const total=length==='0'?0:length==='3'?3:undefined;
   assert.deepEqual(updates,[{loaded:0},total===undefined?{loaded:0}:{loaded:0,total},total===undefined?{loaded:3}:{loaded:3,total}]);assert.deepEqual(new Uint8Array(committed),new Uint8Array([7,8,9]));
  }
  const failure=Error('source stream failed');let released=false;
  const failedResponse={headers:new Headers(),body:{getReader:()=>({read:async()=>{throw failure;},releaseLock:()=>{released=true;}})}};
  const beforeFailure=events.length;
  await assert.rejects(downloadDashboardSource({raw:async()=>failedResponse},sourceItem),error=>error===failure);assert.equal(released,true);assert.deepEqual(events.slice(beforeFailure),['select_export_destination','cancel_export_destination']);
  await assert.rejects(downloadDashboardSource({raw:async()=>{throw failure;}},sourceItem),error=>error===failure);
  console.log('PASS source progress starts after picker, counts streamed bytes, handles length and fallback, and preserves cancellation and failures');
 }finally{delete dom.window.__TAURI_INTERNALS__;if(savedWindow===undefined)delete globalThis.window;else globalThis.window=savedWindow;if(savedTauri===undefined)delete globalThis.isTauri;else globalThis.isTauri=savedTauri;}
 assert.deepEqual(parseDashboardCommand('/看板'),{mode:'dashboard',name:undefined});assert.deepEqual(parseDashboardCommand('/看板 蓝光车间生产'),{mode:'dashboard',name:'蓝光车间生产'});assert.deepEqual(parseDashboardCommand('/看板 叠加 MES'),{mode:'overlay',name:'MES'});assert.deepEqual(parseDashboardCommand('/看板 移除'),{mode:'dashboard',remove:true});assert.equal(parseDashboardCommand('说明看板如何接入'),undefined);
 const index=new File(['<h1>MES</h1>'],'index.html'),style=new File(['body{}'],'main.css');Object.defineProperty(index,'webkitRelativePath',{value:'my-screen/dist/index.html'});Object.defineProperty(style,'webkitRelativePath',{value:'my-screen/dist/assets/main.css'});
 const selection=await selectDashboardFiles([index,style],'folder');assert.equal(selection.name,'my-screen');assert.deepEqual(selection.entries,['dist/index.html']);assert.deepEqual(selection.files.map(f=>f.path),['dist/assets/main.css','dist/index.html']);
 const zipSelection=await selectDashboardFiles([new File([Buffer.from(oldPack.base64,'base64')],'source.zip')],'file');assert.deepEqual(zipSelection.entries,['index.html']);
 const sourceFiles=[['index.html','<script type="module" src="/src/main.ts"></script>'],['dist/index.html','<h1>运行入口</h1>'],...Object.entries(ancillary)].map(([path,text])=>{const file=new File([text],path.split('/').at(-1));Object.defineProperty(file,'webkitRelativePath',{value:'完整源码/'+path});return file;});
 const completeSource=await selectDashboardFiles(sourceFiles,'folder');assert.equal(completeSource.entries[0],'dist/index.html');assert.ok(completeSource.files.some(f=>f.path==='scripts/build.py'));assert.ok(completeSource.files.some(f=>f.path==='README.md'));
 await assert.rejects(selectDashboardFiles([new File(['source'],'App.vue')],'folder'),/没有 HTML 入口/);
 globalThis.DOMParser=dom.window.DOMParser;
 const {buildDashboardPreview,buildDashboardExport,inspectDashboardPlacement}=await server.ssrLoadModule('/src/scene/dashboardRuntime.ts');
 const sourceResources=Object.fromEntries([['index.html','<h1>静态入口</h1>'],...Object.entries(ancillary)].map(([path,text])=>[path,new TextEncoder().encode(text)]));
 await buildDashboardPreview({fileName:'source.zip',entry:'index.html',files:sourceResources});
 await assert.rejects(buildDashboardPreview({fileName:'source.zip',entry:'index.html',files:{...sourceResources,'index.html':strToU8('<script type="module" src="src/main.ts"></script>')}}),/src\/main\.ts.*需要构建/);
 const runtimeWindow=globalThis.window,runtimeDocument=globalThis.document;globalThis.window=dom.window;globalThis.document=dom.window.document;
 try{
  const pack={fileName:'runtime.html',entry:'index.html',files:{'index.html':strToU8('<main data-scenivo-scene>Actual template</main>')}},abort=new AbortController();
  const pending=inspectDashboardPlacement(pack,abort.signal);assert.ok(dom.window.document.querySelector('iframe[sandbox="allow-scripts"]'));abort.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(dom.window.document.querySelector('iframe'),null);
  await assert.rejects(inspectDashboardPlacement(pack,AbortSignal.abort()),{name:'AbortError'});assert.equal(dom.window.document.querySelector('iframe'),null);
  const combined=await buildDashboardExport(pack,dashboardBinding('http://localhost',{id:first.id,version:1,name:'MES'},'dashboard'),'<html><body>offline scene</body></html>');assert.match(combined,/offline scene/);assert.match(combined,/Actual template/);
 }finally{if(runtimeWindow===undefined)delete globalThis.window;else globalThis.window=runtimeWindow;if(runtimeDocument===undefined)delete globalThis.document;else globalThis.document=runtimeDocument;}
 console.log('PASS actual placement probe abort removes iframe, pre-aborted probe never mounts, and composition export includes fixed template and scene');
 let blobIndex=0;dom.window.URL.createObjectURL=()=>`blob:local-${++blobIndex}`;dom.window.URL.revokeObjectURL=()=>{};
 Object.assign(dom.window,{fetch:globalThis.fetch,Request:globalThis.Request,Response:globalThis.Response});
 dom.window.eval((await readFile(new URL('../src/scene/dashboardPlacement.js',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../src/scene/dashboardSandbox.js',import.meta.url),'utf8'))+'\nmountDashboard('+JSON.stringify({entry:'index.html',marker:'__asset_',resources:{'assets/icon.png':{mime:'image/png',base64:'AA=='}},modules:{},documents:{'index.html':'<!doctype html><html><head></head><body><main id="dynamic"></main></body></html>'}})+',"default-src none");');
 const dynamic=dom.window.document.querySelector('#dynamic');dynamic.innerHTML='<img src="assets/icon.png"><span>保留统计文字</span>';assert.match(dynamic.querySelector('img').getAttribute('src'),/^blob:local-/);assert.equal(dynamic.querySelector('span').textContent,'保留统计文字');
 dynamic.insertAdjacentHTML('beforeend','<img src="assets/icon.png">');assert.equal(dynamic.querySelectorAll('img').length,2);for(const image of dynamic.querySelectorAll('img'))assert.match(image.getAttribute('src'),/^blob:local-/);
 const template=dom.window.document.createElement('template');template.innerHTML='<section class="template-panel"><img src="assets/icon.png"><span>初始统计</span></section>';
 assert.equal(template.childNodes.length,0);assert.equal(template.content.firstElementChild.tagName,'SECTION');
 dynamic.appendChild(template.content.firstElementChild);assert.equal(dynamic.querySelector('.template-panel span').textContent,'初始统计');assert.match(dynamic.querySelector('.template-panel img').getAttribute('src'),/^blob:local-/);
 template.innerHTML='<section class="template-panel"><span>更新后的统计</span></section>';dynamic.querySelector('.template-panel').replaceWith(template.content.firstElementChild);assert.equal(dynamic.querySelector('.template-panel span').textContent,'更新后的统计');
 const vector=dom.window.document.createElementNS('http://www.w3.org/2000/svg','svg');vector.innerHTML='<circle cx="5" cy="5" r="2"/>';assert.equal(vector.firstElementChild.namespaceURI,'http://www.w3.org/2000/svg');
 assert.throws(()=>{dynamic.innerHTML='<img src="https://external.invalid/icon.png">';},/已阻止外部资源/);
 console.log('PASS ancillary source remains inert, build-only scripts get precise errors and dynamic HTML images resolve locally');
 const store=createEditorStore(),initial=store.getState().doc,binding=dashboardBinding('http://localhost',{id:first.id,version:1,name:'MES'},'dashboard');assert.equal(store.getState().setDashboard(binding).ok,true);assert.deepEqual(parseProject(serializeProject(store.getState().doc)).dashboard,binding);store.getState().undo();assert.equal(store.getState().doc.dashboard,undefined);assert.deepEqual(store.getState().doc.nodes,initial.nodes);store.getState().redo();assert.deepEqual(store.getState().doc.dashboard,binding);const before=store.getState().doc;assert.equal(store.getState().setDashboard({...binding,slot:{x:90,y:0,width:30,height:30}}).ok,false);store.getState().setAiStatus('previewing');assert.equal(store.getState().setDashboard(undefined).ok,false);assert.equal(store.getState().doc,before);
 console.log('PASS folder root normalization, nested entry selection, ZIP entry detection, scene round-trip and undo boundaries');
 const {validDashboardView}=await server.ssrLoadModule('/src/domain/dashboard.ts');
 const authored={zoom:1.8,offsetX:.12,offsetY:-.08,azimuth:65,elevation:40};assert.equal(validDashboardView(authored),true);assert.equal(validDashboardView({...authored,zoom:Infinity}),false);assert.equal(validDashboardView({...authored,zoom:0}),false);assert.equal(validDashboardView({...authored,offsetX:1.1}),false);
 store.getState().setAiStatus('idle');assert.equal(store.getState().setDashboard({...binding,view:authored}).ok,true);assert.deepEqual(parseProject(serializeProject(store.getState().doc)).dashboard.view,authored);store.getState().undo();assert.equal(store.getState().doc.dashboard.view,undefined);store.getState().redo();assert.deepEqual(store.getState().doc.dashboard.view,authored);
 const {scenePublication}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');assert.deepEqual(scenePublication(store.getState().doc).scene.dashboard.view,authored);
 const {validDashboardRegion}=await server.ssrLoadModule('/src/domain/dashboard.ts');const manualRegion={x:24,y:18,width:52,height:65};assert.equal(validDashboardRegion(manualRegion),true);for(const invalid of [{...manualRegion,x:-1},{...manualRegion,width:3},{...manualRegion,x:80},{...manualRegion,height:Infinity}])assert.equal(validDashboardRegion(invalid),false);
 assert.equal(store.getState().setDashboard({...binding,view:authored,region:manualRegion}).ok,true);assert.deepEqual(parseProject(serializeProject(store.getState().doc)).dashboard.region,manualRegion);assert.deepEqual(scenePublication(store.getState().doc).scene.dashboard.region,manualRegion);store.getState().undo();assert.equal(store.getState().doc.dashboard.region,undefined);store.getState().redo();assert.deepEqual(store.getState().doc.dashboard.region,manualRegion);
}finally{if(http)await new Promise(resolve=>http.close(resolve));team?.close();await server?.close();dom.window.close();await rm(dir,{recursive:true,force:true});}
