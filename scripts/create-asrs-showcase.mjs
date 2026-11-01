import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
import ts from 'typescript';

// Independent, editable showcase. Never writes to the application's workspace.
const output=resolve('home-visual-results/asrs-showcase');
await mkdir(output,{recursive:true});
const executablePath=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),...[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[join(base,'Google/Chrome/Application/chrome.exe'),join(base,'Microsoft/Edge/Application/msedge.exe')])].find(path=>path&&existsSync(path));
assert.ok(executablePath,'An installed Chromium browser is required');
const fixture=`<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="module">
import {createInitialDoc} from '/src/store.ts';
import {validateDocument} from '/src/domain/types.ts';
import {serializeProject,parseProject} from '/src/domain/project.ts';
import {exportGlb} from '/src/scene/export.ts';
import {inspectGlbBytes,importGlb} from '/src/scene/importGlb.ts';
import {exportHtml} from '/src/scene/exportHtml.ts';
import {buildWarehouseScene} from '/scripts/warehouse-comparison-scene.mjs';
import {Viewport} from '/src/scene/Viewport.ts';
const result=buildWarehouseScene(createInitialDoc(),true),doc=result.doc;
doc.projectId='asrs-showcase-20261101';
for(const node of doc.nodes){
 if(node.name==='输送机边梁'){
  const {width,depth}=node.geometry.params,length=Math.max(width,depth);
  node.name='连续 C 型钢输送机边梁';
  node.geometry={type:'profileSweep',params:{profile:[[-.0325,-.07],[.0325,-.07],[.0325,-.067],[-.0295,-.067],[-.0295,.067],[.0325,.067],[.0325,.07],[-.0325,.07]],path:width>depth?[[-length/2,0],[length/2,0]]:[[0,-length/2],[0,length/2]]}};
 }
 if(node.name==='底部运行轨道'){
  node.name='堆垛机连续工字形地轨';
  node.geometry={type:'profileSweep',params:{profile:[[-.045,-.04],[.045,-.04],[.045,-.031],[.009,-.031],[.009,.030],[.032,.030],[.032,.04],[-.032,.04],[-.032,.030],[-.009,.030],[-.009,-.031],[-.045,-.031]],path:[[0,-8.05],[0,8.05]]}};
 }
}
const errors=validateDocument(doc);if(errors.length)throw errors[0];
parseProject(serializeProject(doc));
localStorage.setItem('chat3d.renderPreset.v1','studio');
async function renderStill(view){
 document.body.style.cssText='margin:0;width:100vw;height:100vh;overflow:hidden';
 const container=document.createElement('div');container.style.cssText='width:100vw;height:100vh';document.body.append(container);
 const viewport=new Viewport(container,()=>{});viewport.setBackdrop('light');viewport.setRenderPreset('studio');viewport.setRenderQuality('high');viewport.sync(doc);
 await viewport.captureDocument(doc,'perspective');
 const frames={overview:{target:[0,4.1,2.6],theta:.65,phi:1,distance:42},detail:{target:[5,2.1,6.5],theta:.35,phi:1.28,distance:5.7},aisle:{target:[2.875,4.4,-1],theta:.015,phi:1.37,distance:19.5}};
 function show(name){const c=frames[name];viewport.orbitTarget.fromArray(c.target);viewport.orbitTheta=c.theta;viewport.orbitPhi=c.phi;viewport.orbitRadius=c.distance;viewport.updateOrbitCamera();viewport.render();}
 window.showcase.still={viewport,show};show(view);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 return viewport.getRenderStats();
}
window.showcase={doc,stats:{...result.stats,continuousProfiles:doc.nodes.filter(n=>n.geometry?.type==='profileSweep').length},serializeProject,exportGlb,exportHtml,inspectGlbBytes,importGlb,renderStill,ready:true};
</script>`;
const cacheDir=await mkdtemp(join(tmpdir(),'chat3d-asrs-showcase-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'asrs-showcase',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__asrs_showcase')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});}}]});

function jsonForHtml(value){return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
async function prepareViewer(html){
 const match=html.match(/(<script id="scene-data" type="application\/json">)([\s\S]*?)(<\/script>)/);
 assert.ok(match);
 const data=JSON.parse(match[2]),canonical=new Map(),aliases=new Map(),unique=[];
 for(const geometry of data.geometries){
  const {uuid,...payload}=geometry,key=JSON.stringify(payload),existing=canonical.get(key);
  if(existing)aliases.set(uuid,existing);else{canonical.set(key,uuid);unique.push(geometry);}
 }
 const oldCount=data.geometries.length;data.geometries=unique;
 const visit=node=>{if(aliases.has(node.geometry))node.geometry=aliases.get(node.geometry);node.children?.forEach(visit);};visit(data.object);
 html=html.replace(match[0],match[1]+jsonForHtml(data)+match[3]);
 const source=await readFile(resolve('src/scene/instancedRender.ts'),'utf8');
 const batching=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*?;\s*/m,'').replaceAll('export const ','const ').replaceAll('export class ','class ');
 const replace=(needle,replacement)=>{assert.ok(html.includes(needle),'Missing injection anchor: '+needle);html=html.replace(needle,replacement);};
 replace('  let environmentTarget;','  let environmentTarget;\n  let drawBatches;');
 replace('    observer?.disconnect();','    observer?.disconnect();\n    drawBatches?.dispose();');
 replace('    const lighting=runtime.lighting;','    const {InstancedMesh,Matrix4,Mesh,MeshPhysicalMaterial,Scene}=THREE;\n'+batching+'\n    const lighting=runtime.lighting;');
 replace('    const camera = new THREE.PerspectiveCamera','    const meshes=[];scene.traverse(o=>{if(o.isMesh)meshes.push(o);});\n    drawBatches=new InstancedRender(scene);drawBatches.rebuild(meshes);\n    const camera = new THREE.PerspectiveCamera');
 replace('      renderer.render(scene, camera);','      drawBatches.render(()=>renderer.render(scene,camera));');
 const hooks=`
    const cameraViews={
      overview:{target:[0,4.1,2.6],theta:.65,phi:1.0,distance:42},
      aisle:{target:[2.875,4.4,-1],theta:.015,phi:1.37,distance:19.5},
      detail:{target:[5,2.1,6.5],theta:.35,phi:1.28,distance:5.7},
      conveyor:{target:[0,1,9.9],theta:.65,phi:.95,distance:14}
    };
    function showView(name){const view=cameraViews[name];if(!view)return;target.fromArray(view.target);theta=view.theta;phi=view.phi;distance=view.distance;render();document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===name)));}
    document.querySelectorAll('[data-view]').forEach(button=>on(button,'click',()=>showView(button.dataset.view)));
    window.asrsViewer={showView,stats:()=>({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries}),camera:()=>({target:target.toArray(),theta,phi,distance})};
`;
 replace("    on(window, 'resize', resize);",hooks+"    on(window, 'resize', resize);");
 replace('    status.hidden = true;',"    showView('overview');\n    status.hidden = true;");
 replace('</style>',`header{flex-wrap:wrap;padding:16px 24px;gap:10px}h1{font-size:17px;min-width:220px}nav{display:flex;gap:6px;flex-wrap:wrap}button{border-color:#d5dedf;border-radius:7px;padding:8px 13px}button[aria-pressed=true]{background:#294d60;color:white;border-color:#294d60}.metrics{width:100%;color:#6a777d;font-size:12px;letter-spacing:.2px}footer{padding:11px 24px}header a{font-size:12px;color:#3c6376;text-decoration:none;margin-left:8px}@media(max-width:600px){header{padding:12px}h1{width:100%}nav{width:100%}.metrics{line-height:1.7}footer{padding:10px 12px}}\n</style>`);
 replace('<button id="reset"',`<nav aria-label="场景视角"><button data-view="overview">全景</button><button data-view="aisle">巷道</button><button data-view="detail">货架近景</button><button data-view="conveyor">输送区</button></nav><button id="reset"`);
 replace('</header>','<div class="metrics">4 排高位货架 · 6 层 · 288 个货位 · 173 个在架托盘 · 2 台堆垛机<a href="warehouse.chat3d.json" download>项目文件 ↓</a><a href="warehouse.glb" download>GLB ↓</a></div></header>');
 return {html,geometriesBefore:oldCount,geometriesAfter:unique.length};
}

let browser;
try{
 await server.listen();browser=await chromium.launch({executablePath,headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__asrs_showcase');
 await page.waitForFunction(()=>window.showcase?.ready,{},{timeout:60000});assert.deepEqual(errors,[]);
 console.log('ASRS document validated');
 const report=await page.evaluate(()=>window.showcase.stats);assert.equal(report.positions,288);assert.equal(report.continuousProfiles,8);
 await writeFile(join(output,'warehouse.chat3d.json'),await page.evaluate(()=>{const w=window.showcase;return w.serializeProject(w.doc);}));
 const rawHtml=await page.evaluate(()=>{const w=window.showcase;return w.exportHtml(w.doc,'ASRS · 自动化立体仓库');});
 const prepared=await prepareViewer(rawHtml);await writeFile(join(output,'index.html'),prepared.html);
 report.htmlBytes=Buffer.byteLength(prepared.html);report.exportGeometries={before:prepared.geometriesBefore,after:prepared.geometriesAfter};
 console.log('ASRS interactive HTML exported; duplicate geometry eliminated');
 const glb=await page.evaluate(async()=>{const w=window.showcase,bytes=await w.exportGlb(w.doc);w.inspectGlbBytes(bytes);const round=await w.importGlb(bytes,'warehouse.glb');const data=new Uint8Array(bytes);let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));return {base64:btoa(binary),nodes:round.doc.nodes.length,bytes:bytes.byteLength};});
 assert.equal(glb.nodes,report.nodes);assert.ok(glb.bytes<20*1024*1024);report.glbBytes=glb.bytes;
 await writeFile(join(output,'warehouse.glb'),Buffer.from(glb.base64,'base64'));
 console.log('ASRS GLB roundtrip passed');
 const offline=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 const offlineErrors=[];offline.on('pageerror',e=>offlineErrors.push(e.message));
 await offline.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue());
 await offline.goto(pathToFileURL(join(output,'index.html')).href);
 await offline.waitForFunction(()=>window.asrsViewer&&document.querySelector('#status')?.hidden===true,{},{timeout:90000});
 report.offlineRender=await offline.evaluate(()=>window.asrsViewer.stats());
 assert.ok(report.offlineRender.drawCalls<600);
 for(const mode of ['overview','aisle','detail','conveyor']){
  await offline.getByRole('button',{name:({overview:'全景',aisle:'巷道',detail:'货架近景',conveyor:'输送区'})[mode],exact:true}).click();
  await offline.locator('#viewport').screenshot({path:join(output,'warehouse-'+mode+'.png')});
  console.log('ASRS captured '+mode);
 }
 const before=await offline.evaluate(()=>window.asrsViewer.camera());
 const canvas=offline.locator('#view'),box=await canvas.boundingBox();
 await offline.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await offline.mouse.down();await offline.mouse.move(box.x+box.width*.6,box.y+box.height*.52);await offline.mouse.up();
 assert.notDeepEqual(await offline.evaluate(()=>window.asrsViewer.camera()),before);
 await offline.setViewportSize({width:390,height:844});await offline.getByRole('button',{name:'全景',exact:true}).click();
 assert.equal(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(offlineErrors,[]);report.offlineErrors=offlineErrors;report.interactionChecked=true;
 await offline.close();
 await page.setViewportSize({width:1600,height:900});
 report.highQualityRender=await page.evaluate(()=>window.showcase.renderStill('overview'));
 assert.equal(report.highQualityRender.tier,'high');assert.equal(report.highQualityRender.postprocessingError,'');
 for(const view of ['overview','detail','aisle']){
  await page.evaluate(async view=>{window.showcase.still.show(view);await new Promise(resolve=>requestAnimationFrame(resolve));},view);
  await page.screenshot({path:join(output,'warehouse-high-'+view+'.png')});
  console.log('ASRS high quality captured '+view);
 }
 await page.evaluate(()=>window.showcase.still.viewport.dispose());
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 await writeFile(join(output,'README.txt'),'自动化立体仓库示例\n\nindex.html：离线三维预览，可旋转、缩放、切换四个视角。\nwarehouse.chat3d.json：可导入应用继续编辑的项目。\nwarehouse.glb：通用三维模型，导入导出回读已校验。\n\n4 排 × 6 跨 × 6 层 × 2 货位 = 288 个货位；173 个在架托盘；两台堆垛机、滚筒输送机、AGV 与暂存区。\n使用当前建模几何、物理材质与离线渲染器参数化构建，未调用外部模型 API。场景用于视觉演示，不代表工程设计。\n');
 console.log(JSON.stringify({passed:true,output,...report},null,2));
}finally{await browser?.close();await server.close();}
