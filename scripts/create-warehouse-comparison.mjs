import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const output=resolve('home-visual-results/warehouse-comparison');await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),...[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[join(base,'Google/Chrome/Application/chrome.exe'),join(base,'Microsoft/Edge/Application/msedge.exe')]),'/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
assert.ok(executablePath,'Set CHAT3D_BROWSER_PATH to an installed browser');
const cacheDir=await mkdtemp(join(tmpdir(),'chat3d-warehouse-'));
const fixture=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>立体仓库风格对照</title>
<style>*{box-sizing:border-box}body{margin:0;background:#edf0f0;color:#25383b;font:14px system-ui}header{padding:22px 28px 12px}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:#637477}main{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 22px}section{min-width:0}h2{font-size:15px;font-weight:600;margin:12px 0}.view{height:750px;border-radius:12px;overflow:hidden}footer{padding:16px 28px;color:#6a797b;font-size:12px}</style>
<header><h1 id="title">立体仓库 · 简洁与写实对照</h1><p>4 排 × 6 跨 × 6 层 · 288 个货位 · 173 个在架托盘 · 2 台巷道堆垛机</p></header>
<main><section><h2 id="left-title">简洁结构 / 经典展示</h2><div class="view" id="left"></div></section><section><h2 id="right-title">写实结构 / 写实棚拍</h2><div class="view" id="right"></div></section></main>
<footer>固定布局与相同机位。场景由参数化构建，支持应用内导入编辑；本对照未调用外部模型 API。</footer>
<script type="module">
import {Viewport} from '/src/scene/Viewport.ts';
import {createInitialDoc} from '/src/store.ts';
import {validateDocument} from '/src/domain/types.ts';
import {serializeProject,parseProject} from '/src/domain/project.ts';
import {exportGlb} from '/src/scene/export.ts';
import {inspectGlbBytes,importGlb} from '/src/scene/importGlb.ts';
import {exportHtml} from '/src/scene/exportHtml.ts';
import {buildWarehouseScene,classicWarehouseMaterials} from '/scripts/warehouse-comparison-scene.mjs';
const simple=buildWarehouseScene(createInitialDoc(),false),real=buildWarehouseScene(createInitialDoc(),true);
for(const result of [simple,real]){const errors=validateDocument(result.doc);if(errors.length)throw errors[0];parseProject(serializeProject(result.doc));}
const views=['left','right'].map(id=>{const viewport=new Viewport(document.getElementById(id),()=>{});viewport.setBackdrop('light');return viewport;});
const sleep=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
async function show(leftDoc,rightDoc,mode='overview'){
 for(const [i,doc] of [leftDoc,rightDoc].entries()){
  const view=views[i];view.setRenderPreset(i===0?'classic':'studio');view.sync(doc);
  await view.captureDocument(doc,'perspective');
  if(mode==='detail'){
   const ids=doc.nodes.filter(n=>real.focus.pallet.includes(n.assemblyId)||n.assemblyId==='rack-3').map(n=>n.id);
   view.fitToSelection(ids);view.orbitTarget.set(5.05,1.28,6.28);view.orbitTheta=.92;view.orbitPhi=1.08;view.orbitRadius=5.2;
  }else if(mode==='aisle'){
   view.orbitTarget.set(2.875,4.7,-.5);view.orbitTheta=.01;view.orbitPhi=1.22;view.orbitRadius=24;
  }else{view.orbitTheta=.68;view.orbitPhi=.88;view.fitToScene();}
  view.updateOrbitCamera();view.render();
 }
 await sleep();
}
await show(simple.doc,real.doc);console.log('WAREHOUSE scene ready '+real.stats.nodes+' nodes');
window.warehouse={simple,real,views,show,serializeProject,exportGlb,exportHtml,inspectGlbBytes,importGlb,classicWarehouseMaterials,ready:true};
window.addEventListener('pagehide',()=>views.forEach(view=>view.dispose()),{once:true});
</script>`;
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'warehouse-comparison',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__warehouse')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});}}]});
let browser;
function interactiveViewer(html){
 const anchor="    on(window, 'resize', resize);";
 assert.ok(html.includes(anchor));
 const hooks=`
    const broadcastCamera=()=>window.parent.postMessage({type:'warehouse-camera',theta,phi,distance,target:target.toArray()},'*');
    on(canvas,'pointermove',()=>{if(pointer)broadcastCamera();});
    on(canvas,'wheel',broadcastCamera);
    on(reset,'click',broadcastCamera);
    on(window,'message',event=>{
      const message=event.data;if(!message||!['warehouse-camera','warehouse-view'].includes(message.type))return;
      if(message.type==='warehouse-camera'){theta=message.theta;phi=message.phi;distance=message.distance;target.fromArray(message.target);}
      else if(message.view==='detail'){target.set(5.05,1.28,6.28);theta=.92;phi=1.08;distance=5.2;}
      else if(message.view==='aisle'){target.set(2.875,4.7,-.5);theta=.01;phi=1.22;distance=24;}
      else{home();theta=.68;phi=.88;}
      render();
    });
`;
 return html.replace(anchor,hooks+anchor).replaceAll('theta = Math.PI / 4;','theta = .68;').replaceAll('phi = Math.PI / 3;','phi = .88;');
}
try{
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1800,height:1000},deviceScaleFactor:1});const errors=[];
 page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER '+error.message)});
 page.on('console',message=>{if(message.text().startsWith('WAREHOUSE '))console.log(message.text());if(message.type()==='error')errors.push(message.text());});
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__warehouse');
 await page.waitForFunction(()=>window.warehouse?.ready,{},{timeout:60000});assert.deepEqual(errors,[]);
 await page.screenshot({path:join(output,'warehouse-overview-comparison.png')});
 await page.locator('#right').screenshot({path:join(output,'warehouse-realistic-overview.png')});
 const report=await page.evaluate(()=>{const {simple,real,views}=window.warehouse;return {simple:simple.stats,realistic:real.stats,drawCalls:views.map(view=>view.renderer.info.render.calls),triangles:views.map(view=>view.renderer.info.render.triangles)};});
 assert.equal(report.simple.storedPallets,report.realistic.storedPallets);assert.equal(report.realistic.positions,288);
 for(const mode of ['detail','aisle']){
  await page.evaluate(async mode=>{const {show,simple,real}=window.warehouse;document.getElementById('title').textContent=mode==='detail'?'货架与托盘近景 · 简洁与写实':'巷道作业视角 · 简洁与写实';await show(simple.doc,real.doc,mode);},mode);
  await page.screenshot({path:join(output,'warehouse-'+mode+'-comparison.png')});
 }
 await page.evaluate(async()=>{const {show,real,classicWarehouseMaterials}=window.warehouse;document.getElementById('title').textContent='同一写实几何 · 材质与灯光对照';document.getElementById('left-title').textContent='同一几何 / 原有材质与灯光';document.getElementById('right-title').textContent='同一几何 / 写实材质与灯光';await show({...real.doc,materials:classicWarehouseMaterials(real.doc.materials)},real.doc,'detail');});
 await page.screenshot({path:join(output,'warehouse-material-comparison.png')});
 for(const [key,name] of [['simple','warehouse-simple'],['real','warehouse-realistic']]){
  console.log('WAREHOUSE exporting '+name);
  const project=await page.evaluate(key=>{const w=window.warehouse;return w.serializeProject(w[key].doc);},key);
  await writeFile(join(output,name+'.chat3d.json'),project);
  const result=await page.evaluate(async key=>{const w=window.warehouse;const bytes=await w.exportGlb(w[key].doc);w.inspectGlbBytes(bytes);const round=await w.importGlb(bytes,'warehouse.glb');const data=new Uint8Array(bytes);let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return {base64:btoa(binary),nodes:round.doc.nodes.length,bytes:bytes.byteLength};},key);
  assert.ok(result.bytes<20*1024*1024);assert.equal(result.nodes,report[key==='simple'?'simple':'realistic'].nodes);
  await writeFile(join(output,name+'.glb'),Buffer.from(result.base64,'base64'));report[name+'GlbBytes']=result.bytes;
  await page.evaluate(async key=>{const w=window.warehouse;const doc=w[key].doc;const vp=w.views[0];vp.setRenderPreset(key==='simple'?'classic':'studio');localStorage.setItem('chat3d.renderPreset.v1',key==='simple'?'classic':'studio');},key);
  const html=await page.evaluate(async key=>{const w=window.warehouse;return w.exportHtml(w[key].doc,key==='simple'?'立体仓库 · 简洁':'立体仓库 · 写实');},key);
  await writeFile(join(output,name+'.html'),interactiveViewer(html));
 }
 const comparison=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>立体仓库 · 同布局对照</title><style>*{box-sizing:border-box}body{margin:0;background:#edf0f0;color:#23373a;font:14px system-ui}header{padding:18px 22px}h1{font-size:22px;margin:0 0 7px}p{margin:0;color:#637477}nav{display:flex;gap:8px;padding:0 22px 14px;flex-wrap:wrap}button,a{border:1px solid #c7d3d3;border-radius:7px;background:white;color:inherit;padding:8px 12px;font:inherit;text-decoration:none;cursor:pointer}main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 12px}iframe{width:100%;height:76vh;border:0;border-radius:10px;background:white}footer{padding:14px 22px;color:#637477;font-size:12px}@media(max-width:760px){main{grid-template-columns:1fr}iframe{height:65vh}}</style><header><h1>立体仓库 · 简洁与写实</h1><p>相同的 288 个货位、173 个在架托盘、2 台堆垛机与收发货布局。拖动任一画面可同步视角。</p></header><nav><button data-view="overview">全景</button><button data-view="aisle">巷道</button><button data-view="detail">托盘近景</button><a href="warehouse-realistic.chat3d.json" download>下载写实项目</a><a href="warehouse-realistic.glb" download>下载 GLB</a></nav><main><iframe id="simple" title="简洁场景" src="warehouse-simple.html"></iframe><iframe id="real" title="写实场景" src="warehouse-realistic.html"></iframe></main><footer>此场景由固定布局参数化构建，未调用外部模型 API；对照用于观察几何细节、材质与灯光的差异，不是模型生成质量评分。</footer><script>const frames=[document.getElementById('simple'),document.getElementById('real')];window.addEventListener('message',event=>{if(event.data?.type!=='warehouse-camera')return;const source=frames.find(frame=>frame.contentWindow===event.source);if(source)frames.filter(frame=>frame!==source).forEach(frame=>frame.contentWindow.postMessage(event.data,'*'));});document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>frames.forEach(frame=>frame.contentWindow.postMessage({type:'warehouse-view',view:button.dataset.view},'*'))));</script></html>`;
 await writeFile(join(output,'index.html'),comparison);
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 const offline=await browser.newPage({viewport:{width:1800,height:1000}});const offlineErrors=[];
 offline.on('pageerror',error=>offlineErrors.push(error.message));await offline.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue());
 await offline.goto(new URL('file:///'+join(output,'index.html').replaceAll('\\','/')).href);
 for(const frame of offline.frames().filter(frame=>frame.parentFrame()))await frame.waitForFunction(()=>document.querySelector('#reset')?.disabled===false&&document.querySelector('#status')?.hidden===true,{},{timeout:60000});
 await offline.getByRole('button',{name:'托盘近景',exact:true}).click();await offline.waitForTimeout(300);assert.deepEqual(offlineErrors,[]);
 await offline.screenshot({path:join(output,'warehouse-interactive.png')});
 console.log(JSON.stringify({passed:true,output,...report},null,2));
}finally{await browser?.close();await server.close();if(dirname(resolve(cacheDir))===resolve(tmpdir())&&basename(cacheDir).startsWith('chat3d-warehouse-'))await rm(cacheDir,{recursive:true,force:true});}
