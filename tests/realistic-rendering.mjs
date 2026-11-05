import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {existsSync} from 'node:fs';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const browserExecutable=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),...[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[join(base,'Google/Chrome/Application/chrome.exe'),join(base,'Microsoft/Edge/Application/msedge.exe')]),'/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
assert.ok(browserExecutable,'Specify an installed browser with CHAT3D_BROWSER_PATH');

// Isolated fixtures only: no saved projects, API credentials or model requests.
const output=resolve('home-visual-results');
await mkdir(output,{recursive:true});
const fixture=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>写实渲染对照</title>
<style>body{margin:0;background:#f3f5f5;color:#263639;font:14px system-ui}header{padding:20px 24px}h1{margin:0 0 6px;font-size:20px}p{margin:0;color:#617174}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 20px}section{min-width:0}h2{font-size:14px;font-weight:500}.view{height:570px;position:relative;border-radius:12px;overflow:hidden}footer{padding:16px 24px;font-size:12px;color:#617174}</style>
<header><h1>同一几何模型 · 材质与灯光对照</h1><p>固定比例与机位，比较原有纯色材质和新的写实材质。</p></header>
<div class="comparison"><section><h2>原有材质 / 经典展示</h2><div class="view" id="before"></div></section><section><h2>写实材质 / 写实棚拍</h2><div class="view" id="after"></div></section></div><footer>测试场景由固定几何构成，用于验证渲染；不是 AI 生成质量评分。</footer>
<script type="module">
import {Viewport} from '/src/scene/Viewport.ts';
import {createInitialDoc} from '/src/store.ts';
import {exportGlb} from '/src/scene/export.ts';
import {importGlb} from '/src/scene/importGlb.ts';
import {exportHtml} from '/src/scene/exportHtml.ts';
console.log('QA modules ready');
const doc=createInitialDoc();doc.projectId='realistic-render-fixture';doc.nodes=[];
const add=(name,geometry,position,materialId)=>doc.nodes.push({id:'fixture-'+doc.nodes.length,parentId:null,kind:'primitive',name,assemblyId:'machine',assemblyName:'材质验证设备',geometry,materialId,visible:true,transform:{position,rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
const box=(name,size,position,materialId='mat_paint',bevelRadius=.002)=>add(name,{type:'box',params:{width:size[0],height:size[1],depth:size[2],bevelRadius}},position,materialId);
const cylinder=(name,radius,height,position,materialId)=>add(name,{type:'cylinder',params:{radiusTop:radius,radiusBottom:radius,height,radialSegments:48}},position,materialId);
box('底座',[2.2,.25,1.55],[0,.225,0],'mat_black');
for(const x of [-1.04,1.04])box('侧壁',[.12,1.55,1.55],[x,1.125,0]);
box('背板',[2.2,1.55,.08],[0,1.125,-.735]);box('顶板',[2.2,.1,1.55],[0,1.95,0]);
add('门框',{type:'frame',params:{width:1.6,height:1.45,depth:.06,thickness:.065}},[-.2,1.14,.8],'mat_paint');
box('玻璃',[1.45,1.30,.008],[-.2,1.14,.799],'mat_glass',0);
box('操作面板',[.4,1.55,.12],[.86,1.125,.8]);box('屏幕',[.30,.27,.015],[.86,1.58,.87],'mat_screen');
for(let i=0;i<12;i++)box('操作键',[.045,.035,.012],[.77+(i%3)*.08,1.27-Math.floor(i/3)*.07,.875],i===11?'mat_red':'mat_black',.002);
cylinder('主轴',.12,.5,[-.2,1.50,-.16],'mat_brushed');cylinder('刀具',.025,.28,[-.2,1.11,-.16],'mat_brushed');
box('工作台',[1.65,.14,1.05],[-.1,.64,0],'mat_brushed');
for(let i=0;i<5;i++)box('T 槽',[1.60,.003,.018],[-.1,.712,-.4+i*.2],'mat_black',0);
box('夹具',[.52,.20,.35],[-.2,.82,-.12],'mat_brushed');box('工件',[.22,.12,.18],[-.2,.98,-.12],'mat_brushed');
box('门把手',[.035,.26,.04],[.39,1.13,.87],'mat_brushed');
for(const x of [-.85,.85])for(const z of [-.55,.55])cylinder('脚垫',.1,.1,[x,.05,z],'mat_black');
const before=structuredClone(doc);before.materials=before.materials.map(m=>{
const v={...m};delete v.surface;delete v.clearcoat;delete v.clearcoatRoughness;delete v.transmission;delete v.ior;delete v.thickness;
if(m.id==='mat_paint')Object.assign(v,{roughness:.32,metalness:.18});
if(m.id==='mat_brushed')Object.assign(v,{baseColor:'#9AAAB5',roughness:.24,metalness:.88});
if(m.id==='mat_glass')Object.assign(v,{baseColor:'#263E46',roughness:.14,metalness:.12,opacity:.38});return v;
});
const viewports=[];
for(const [id,data,preset] of [['before',before,'classic'],['after',doc,'studio']]){
console.log('QA rendering '+id);
const viewport=new Viewport(document.getElementById(id),()=>{});viewport.setRenderQuality('balanced');viewport.setRenderPreset(preset);viewport.setBackdrop('light');viewport.sync(data);viewport.start();viewports.push(viewport);
await viewport.captureDocument(data,'perspective');
}
console.log('QA GLB export');
const bytes=await exportGlb(doc),round=await importGlb(bytes,'fixture.glb');
console.log('QA HTML export');
const exportedHtml=await exportHtml(doc,'写实材质离线预览');
const glass=round.doc.materials.find(m=>m.id===round.doc.nodes.find(n=>n.name==='玻璃').materialId);
window.qa={ready:true,glbBytes:bytes.byteLength,glass,materialsWithMaps:round.doc.materials.filter(m=>m.maps).length,html:exportedHtml,drawCalls:viewports.map(v=>v.renderer.info.render.calls),triangles:viewports.map(v=>v.renderer.info.render.triangles)};
window.addEventListener('pagehide',()=>viewports.forEach(v=>v.dispose()),{once:true});
</script>`;
const cacheDir=await mkdtemp(join(tmpdir(),'chat3d-realistic-qa-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'realistic-fixture',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__realistic_qa')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});}}]});
let browser;
try{
 await server.listen();const port=server.httpServer.address().port;
 browser=await chromium.launch({executablePath:browserExecutable,headless:true});const page=await browser.newPage({viewport:{width:1440,height:790}});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER '+e.message)});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text())}else if(m.text().startsWith('QA '))console.log(m.text());});
 await page.goto(`http://127.0.0.1:${port}/__realistic_qa`);
 await page.waitForFunction(()=>window.qa?.ready,{},{timeout:60000}).catch(error=>{throw Error(errors.join('\n')+'\n'+error.message)});
 const report=await page.evaluate(()=>{const {html,...report}=window.qa;return report;});
 console.log('QA metrics '+JSON.stringify(report));
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(report.glbBytes<20*1024*1024);assert.ok(report.materialsWithMaps>=2);assert.ok(report.glass.transmission>.9);
 assert.ok(report.drawCalls[1]<=report.drawCalls[0]*2+4,'Bound the glass transmission prepass cost');
 await page.screenshot({path:resolve(output,'realistic-comparison.png')});
 const html=await page.evaluate(()=>window.qa.html);await writeFile(resolve(output,'realistic-offline.html'),html);
 const offline=await browser.newPage({viewport:{width:1100,height:800}});const offlineErrors=[];offline.on('pageerror',e=>offlineErrors.push(e.message));
 await offline.route('**/*',route=>{if(/^https?:/.test(route.request().url()))return route.abort();return route.continue();});
 await offline.goto(new URL('file:///'+resolve(output,'realistic-offline.html').replaceAll('\\','/')).href);
 await offline.waitForFunction(()=>document.querySelector('#reset')?.disabled===false&&document.querySelector('#status')?.hidden===true,{},{timeout:30000});
 assert.deepEqual(offlineErrors,[]);await offline.screenshot({path:resolve(output,'realistic-offline.png')});
 const ui=await browser.newPage({viewport:{width:1280,height:800}});
 await ui.addInitScript(()=>localStorage.setItem('chat3d.modelConfig',JSON.stringify({baseURL:'https://example.invalid/v1',model:'test',apiKey:'ui-only-test-key',generationQuality:'fine',generationStyle:'realistic'})));
 let modelRequests=0;await ui.route('**/chat/completions',route=>{modelRequests++;return route.abort();});
 ui.on('pageerror',error=>console.error('UI '+error.message));
 await ui.goto('http://127.0.0.1:'+port+'/');
 
 const picker=ui.getByRole('button',{name:'生成档位，当前精细'}).first();await picker.click();
 assert.equal(await ui.getByRole('menuitemradio',{name:'直接生成'}).getAttribute('aria-checked'),'true');
 assert.equal(await ui.getByRole('menuitemradio',{name:'简洁风格'}).count(),0);
 await ui.getByRole('menuitemradio',{name:'Blender 生成'}).click();
 await picker.click();await ui.getByRole('menuitemradio',{name:'直接生成'}).click();
 await picker.click();await ui.waitForTimeout(250);await ui.screenshot({path:resolve(output,'realistic-menu-desktop.png')});
 await ui.keyboard.press('Escape');await ui.setViewportSize({width:390,height:844});await picker.click();
 const menu=ui.getByRole('menu',{name:'生成档位'});const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);await ui.waitForTimeout(250);await ui.screenshot({path:resolve(output,'realistic-menu-mobile.png')});
 await ui.keyboard.press('Escape');await ui.setViewportSize({width:1280,height:800});await ui.getByRole('button',{name:'新建项目',exact:true}).click();await ui.getByRole('menuitem',{name:/新建空白/}).click();
 await ui.getByRole('button',{name:'显示选项',exact:true}).click();
 const display=ui.getByRole('dialog',{name:'显示设置'});await display.getByRole('radio',{name:'流畅',exact:true}).click();
 assert.equal(await ui.evaluate(()=>localStorage.getItem('chat3d.renderQuality.v1')),'fast');
 await display.getByRole('radio',{name:'自动',exact:true}).click();await ui.screenshot({path:resolve(output,'render-quality-menu-desktop.png')});
 await ui.setViewportSize({width:390,height:844});await display.getByRole('button',{name:'关闭显示设置'}).click();await ui.getByRole('button',{name:'显示选项',exact:true}).click();
 const displayBounds=await display.boundingBox();assert.ok(displayBounds.x>=0&&displayBounds.x+displayBounds.width<=391&&displayBounds.y+displayBounds.height<=845);
 await ui.screenshot({path:resolve(output,'render-quality-menu-mobile.png')});
 assert.equal(modelRequests,0);
 console.log(JSON.stringify({passed:true,...report,comparison:resolve(output,'realistic-comparison.png'),offline:resolve(output,'realistic-offline.png')},null,2));
}finally{await browser?.close();await server.close();if(dirname(resolve(cacheDir))===resolve(tmpdir())&&basename(cacheDir).startsWith('chat3d-realistic-qa-'))await rm(cacheDir,{recursive:true,force:true});}
