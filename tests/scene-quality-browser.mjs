import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright-core';

const engine=process.argv.includes('--browser=webkit')?'WebKit':'Chromium';
const executable=[process.env.CHAT3D_BROWSER_PATH,chromium.executablePath(),...[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).flatMap(p=>[join(p,'Google/Chrome/Application/chrome.exe'),join(p,'Microsoft/Edge/Application/msedge.exe')]),'/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
assert.ok(engine==='WebKit'?existsSync(webkit.executablePath()):executable,'Set CHAT3D_BROWSER_PATH to an existing browser; no downloads are performed');
const output=resolve('home-visual-results');await mkdir(output,{recursive:true});
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:0;background:#e3e5e7;color:#263639;font:14px system-ui}header{padding:12px 18px;background:white}h1{margin:0;font-size:17px}p{margin:5px 0 0;font-size:12px}#view{height:calc(100dvh - 80px);width:100%;position:relative;overflow:hidden}</style><header><h1>连续截面与接触阴影验证</h1><p>固定几何 · 可编辑路径 · 实际浏览器渲染</p></header><div id="view"></div>
<script type="module">
import {Viewport} from '/src/scene/Viewport.ts';
import {createInitialDoc} from '/src/store.ts';
const doc=createInitialDoc();doc.nodes=[];doc.projectId='scene-quality-fixture';
const add=(name,geometry,position,materialId='mat_paint')=>doc.nodes.push({id:'fixture-'+doc.nodes.length,name,parentId:null,kind:'primitive',assemblyId:'fixture',assemblyName:'质量检查模型',geometry,materialId,visible:true,transform:{position,rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
const box=(name,w,h,d,p,material)=>add(name,{type:'box',params:{width:w,height:h,depth:d,bevelRadius:.002}},p,material);
box('底板',2.8,.12,2,[0,.06,0],'mat_dark');
box('后壁',2.8,1.3,.08,[0,.77,-.96]);box('侧壁',.08,1.3,2,[-1.36,.77,0]);
const rail={type:'profileSweep',params:{profile:[[0,0],[.09,0],[.09,.025],[.025,.025],[.025,.15],[0,.15]],path:[[-1,-.65],[1,-.65],[1,.65],[-1,.65]],closed:true}};
add('连续斜接围边',rail,[0,.125,0],'mat_brushed');
add('L 形导轨',{type:'profileSweep',params:{profile:[[-.05,0],[.05,0],[.05,.1],[-.05,.1]],path:[[-.7,.4],[.6,.4],[.6,-.3]]}},[0,.13,0],'mat_blue');
box('支座',.7,.3,.5,[-.25,.28,-.1],'mat_paint');box('金属台面',.85,.035,.65,[-.25,.45,-.1],'mat_brushed');
box('透明观察板',1,.8,.008,[.1,.9,.8],'mat_glass');
for(let i=0;i<40;i++)add('重复紧固件',{type:'cylinder',params:{radiusTop:.02,radiusBottom:.02,height:.02,radialSegments:16}},[-1.15+(i%10)*.25,.14,-.8+Math.floor(i/10)*.52],'mat_brushed');
const viewport=new Viewport(document.querySelector('#view'),()=>{});viewport.setBackdrop('light');viewport.setRenderPreset('studio');viewport.sync(doc);viewport.start();
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function draw(){viewport.setGridVisible(false);await nextFrame();await nextFrame();}
window.qa={ready:true,async capture(quality){viewport.setRenderQuality(quality);viewport.fitToScene();await draw();const image=await viewport.captureDocument(doc,'perspective');const img=new Image();img.src=image;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let min=255,max=0;for(let i=0;i<pixels.length;i+=64){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}return {...viewport.getRenderStats(),pixelRange:max-min,overflow:document.documentElement.scrollWidth>innerWidth};},async measure(){const intervals=[],software=viewport.getRenderStats().softwareRenderer;let previous;for(let i=0;i<(software?6:72);i++){const now=await new Promise(resolve=>requestAnimationFrame(resolve));viewport.setGridVisible(false);if(!software&&previous!==undefined&&i>8)intervals.push(now-previous);previous=now;}return {meanRafMs:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,...viewport.getRenderStats()};},async memory(){viewport.setRenderQuality('balanced');await draw();const before=viewport.getRenderStats();for(let i=0;i<4;i++){viewport.setRenderQuality('high');await draw();viewport.setRenderQuality('balanced');await draw();}return {before,after:viewport.getRenderStats()};},async focused(){viewport.fitToScene();await draw();const state=()=>({scale:viewport.sceneScale,position:viewport.keyLight.position.toArray(),target:viewport.keyLight.target.position.toArray(),left:viewport.keyLight.shadow.camera.left,far:viewport.keyLight.shadow.camera.far});const before=state();await viewport.captureDocument(doc,'front',[doc.nodes.find(n=>n.name==='支座').id]);return {before,after:state()};}};
window.addEventListener('pagehide',()=>viewport.dispose(),{once:true});
</script>`;
const cacheDir=await mkdtemp(join(tmpdir(),'chat3d-scene-quality-'));
const server=await createServer({cacheDir,server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'scene-quality-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/__scene_quality')return next();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});}}]});
let browser;
try{
 await server.listen();browser=engine==='WebKit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:executable,headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text());}});
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__scene_quality');await page.waitForFunction(()=>window.qa?.ready);
 const states=[];
 for(const [width,height,quality] of [[1440,900,'high'],[1440,900,'balanced'],[768,1024,'auto'],[390,844,'fast']]){
  await page.setViewportSize({width,height});const result=await page.evaluate(quality=>window.qa.capture(quality),quality);
  assert.equal(result.postprocessingError,'');assert.ok(result.pixelRange>60,'canvas must contain the visible model');assert.equal(result.overflow,false);
  assert.equal(result.contactShadows,result.tier==='high');
  await page.screenshot({path:join(output,`scene-quality-${width}-${quality}.png`)});
  const measured=await page.evaluate(()=>window.qa.measure());assert.ok(measured.drawCalls<300);states.push({width,height,...result,meanRafMs:measured.meanRafMs,timingVerified:!result.softwareRenderer&&result.gpu!=='unknown'});
  console.log(JSON.stringify(states.at(-1)));
 }
 const memory=await page.evaluate(()=>window.qa.memory());assert.ok(memory.after.textures<=memory.before.textures+2,'quality switches leaked GPU textures');assert.ok(memory.after.geometries<=memory.before.geometries+2,'quality switches leaked geometries');
 assert.ok(memory.after.programs<=memory.before.programs+2,'quality switches leaked shader programs');
 const focused=await page.evaluate(()=>window.qa.focused());assert.deepEqual(focused.after,focused.before,'focused captures must restore lighting and contact scale');
 assert.deepEqual(errors,[]);const report={passed:true,engine,states,memory,note:'RAF and CPU draw timings are not a universal 60 fps guarantee; software GPU timing is unverified.'};
 await writeFile(join(output,'scene-quality-report.json'),JSON.stringify(report,null,2));console.log('PASS '+engine+' scene matrix, no blank canvases/overflow, stable allocations and complete-frame counters');
}finally{await browser?.close();await server.close();if(dirname(resolve(cacheDir))===resolve(tmpdir())&&basename(cacheDir).startsWith('chat3d-scene-quality-'))await rm(cacheDir,{recursive:true,force:true});}
