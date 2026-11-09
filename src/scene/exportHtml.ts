import roomEnvironment from '../../node_modules/three/examples/jsm/environments/RoomEnvironment.js?raw';
import {loadRenderPreset,RENDER_PRESETS} from './renderPreset';
import threeCore from '../../node_modules/three/build/three.core.js?raw';
import threeModule from '../../node_modules/three/build/three.module.js?raw';
import threeLicense from '../../node_modules/three/LICENSE?raw';
import viewerSource from './htmlViewer.js?raw';
import * as THREE from 'three';
import type {SceneDocument} from '../domain/types';
import type {DashboardView} from '../domain/dashboard';
import {buildHtmlExportScene,disposeExportScene,prepareExportMaterials} from './export';

function jsonForHtml(value:unknown):string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
}
function textForHtml(value:string):string {
  return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
function requireEmbeddedImages(value:unknown):void {
  if(typeof value==='string') {
    if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('离线导出需要完整的内嵌图片贴图');
  } else if(Array.isArray(value)) {
    value.forEach(requireEmbeddedImages);
  } else if(!value||typeof value!=='object'||!('data' in value)||!('width' in value)||!('height' in value)) {
    throw new Error('离线导出图片贴图不完整');
  }
}
export interface HtmlExportProgress {stage:'geometry'|'textures'|'serialize';completed?:number;total?:number}
export interface HtmlExportOptions {embedded?:boolean;view?:DashboardView}
const VIEWER_OPTIONS_START='<script id="viewer-options" type="application/json">';
function validatedViewerView(view:DashboardView):DashboardView {
  if(!view||typeof view!=='object')throw new Error('模型视图必须包含有效的缩放、位置和角度');
  const ranges={zoom:[.25,4],offsetX:[-1,1],offsetY:[-1,1],azimuth:[-180,180],elevation:[5,85]} as const;
  for(const key of Object.keys(ranges) as (keyof DashboardView)[]) {
    const value=view[key],[min,max]=ranges[key];
    if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`模型视图 ${key} 必须是 ${min} 到 ${max} 之间的有限数字`);
  }
  return {zoom:view.zoom,offsetX:view.offsetX,offsetY:view.offsetY,azimuth:view.azimuth,elevation:view.elevation};
}
/** Update only the inert viewer configuration; serialized geometry and materials stay untouched. */
export function withHtmlViewerView(html:string,view:DashboardView):string {
  const config=jsonForHtml({view:validatedViewerView(view)});
  const start=html.indexOf(VIEWER_OPTIONS_START);
  const contentStart=start+VIEWER_OPTIONS_START.length;
  const end=start<0?-1:html.indexOf('</script>',contentStart);
  if(end<0)throw new Error('离线模型缺少查看器配置，请重新导出');
  return html.slice(0,contentStart)+config+html.slice(end);
}
async function yieldToInterface(){const {promise,resolve}=Promise.withResolvers<void>();setTimeout(resolve,0);await promise;}

/** A standalone, static viewer. Only visible scene geometry/materials are serialized. */
export async function exportHtml(doc:SceneDocument,title:string,onProgress?:(progress:HtmlExportProgress)=>void,options:HtmlExportOptions={}):Promise<string> {
  const viewerOptions=jsonForHtml(options.view===undefined?{}:{view:validatedViewerView(options.view)});
  if(!doc.nodes.some(node=>node.visible)) throw new Error('没有可导出的可见对象');
  onProgress?.({stage:'geometry',completed:0,total:doc.nodes.filter(node=>node.visible).length});
  await yieldToInterface();
  const scene=await buildHtmlExportScene(doc,(completed,total)=>onProgress?.({stage:'geometry',completed,total}));
  try {
    onProgress?.({stage:'textures'});
    await yieldToInterface();
    await prepareExportMaterials(scene);
    // Export vertex buffers, never constructor parameters: addon geometry types are not
    // registered in ObjectLoader, and regenerated primitives can lose baked transforms.
    const converted=new Map<THREE.BufferGeometry,THREE.BufferGeometry>();
    scene.traverse(object=>{
      if(object instanceof THREE.Mesh&&object.geometry.type!=='BufferGeometry') {
        const original=object.geometry;
        let geometry=converted.get(original);
        if(!geometry){geometry=new THREE.BufferGeometry().copy(original);converted.set(original,geometry);original.dispose();}
        object.geometry=geometry;
      }
    });
    scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(scene);
    if(bounds.isEmpty()||!Number.isFinite(bounds.min.length()+bounds.max.length())) throw new Error('没有可导出的可见模型');
    // Do not carry project IDs, connections, editing metadata or document state into a shareable file.
    scene.userData={};
    scene.traverse(object=>{object.userData={};});
    onProgress?.({stage:'serialize'});
    await yieldToInterface();
    const data=scene.toJSON() as THREE.Object3DJSON & {images?:{url:unknown}[];materials?:{attenuationDistance?:number}[]};
    // JSON turns Infinity into null. Omitting the physical material's default
    // restores Infinity in MaterialLoader instead of dividing by zero in glass.
    for(const material of data.materials??[])if(material.attenuationDistance!==undefined&&!Number.isFinite(material.attenuationDistance))delete material.attenuationDistance;
    for(const image of data.images??[]) requireEmbeddedImages(image.url);
    const heading=textForHtml(title);
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${heading}</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#242424;background:#f4f4f4;color-scheme:light}*{box-sizing:border-box}body{margin:0;height:100vh;height:100dvh;display:flex;flex-direction:column}header{display:flex;align-items:center;gap:16px;padding:13px 20px;background:#fff;border-bottom:1px solid #ddd}h1{font-size:14px;font-weight:600;margin:0;flex:1;overflow-wrap:anywhere}button{border:1px solid #ccc;background:#fff;color:#222;border-radius:5px;padding:7px 12px;cursor:pointer;font:inherit;font-size:12px}button:hover{background:#eee}button:focus-visible,canvas:focus-visible{outline:2px solid #333;outline-offset:-3px}main{position:relative;min-height:0;flex:1;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}#status{position:absolute;inset:0;display:grid;place-content:center;padding:28px;text-align:center;font-size:14px;line-height:1.8;background:#f4f4f4}#status[hidden]{display:none}footer{display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 20px;border-top:1px solid #ddd;background:#fff;font-size:12px;color:#666}footer>span{flex:1}details{position:relative}summary{cursor:pointer}pre{position:absolute;right:0;bottom:22px;width:min(600px,85vw);max-height:55vh;overflow:auto;white-space:pre-wrap;background:#fff;padding:16px;border:1px solid #ddd;font:11px/1.5 monospace;z-index:2}
${options.embedded?':root{background:transparent;color:#dff6ff;color-scheme:normal}html,body{background:transparent}body>header,body>footer{display:none}#status{background:transparent;color:#dff6ff;text-shadow:0 1px 6px #000}':''}
</style>
</head>
<body${options.embedded?' data-embedded="true"':''}>
<header><h1>${heading}</h1><button id="reset" type="button" disabled>重置视角</button></header>
<main id="viewport"><canvas id="view" tabindex="0" aria-label="三维模型查看器"></canvas><div id="status" role="status">正在载入离线模型…</div></main>
<footer><span>左键拖动旋转 · 右键或 Shift 拖动平移 · 滚轮缩放 · 双击重置</span><details><summary>Three.js · MIT</summary><pre>${textForHtml(threeLicense)}</pre></details></footer>
${VIEWER_OPTIONS_START}${viewerOptions}</script>
<script id="scene-data" type="application/json">${jsonForHtml(data)}</script>
<script id="three-runtime" type="application/json">${jsonForHtml({core:threeCore,module:threeModule,roomEnvironment,lighting:RENDER_PRESETS[loadRenderPreset()]})}</script>
<script>${viewerSource}</script>
</body>
</html>`;
  } finally {
    disposeExportScene(scene);
  }
}
