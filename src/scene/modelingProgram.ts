import threeCore from '../../node_modules/three/build/three.core.js?raw';
import threeModule from '../../node_modules/three/build/three.module.js?raw';
import converterSource from './modelingProgramConverter.js?raw';
import frameSource from './modelingProgramFrame.js?raw';
import workerSource from './modelingProgramWorker.js?raw';
import {MODELING_PROGRAM_LIMITS} from './modelingProgramConverter.js';
import {validateDocument,type SceneDocument,type Material,type SceneNode} from '../domain/types';
import {makeId} from '../util/ids';

export {MODELING_PROGRAM_LIMITS};
export const MODELING_PROGRAM_TIMEOUT_MS=15000;
const CSP="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Treat even a worker's result as untrusted. Only the editable document vocabulary crosses back. */
function readResult(text:string):SceneDocument {
  const limits=MODELING_PROGRAM_LIMITS;
  if(text.length>limits.resultBytes||new TextEncoder().encode(text).byteLength>limits.resultBytes)throw Error('建模程序结果超过24MB预算');
  const data=JSON.parse(text);
  if(!data||!Array.isArray(data.nodes)||!data.nodes.length||data.nodes.length>limits.meshes||!Array.isArray(data.materials)||data.materials.length>limits.materials)throw Error('建模程序返回的网格或材质数量无效');
  if(typeof data.assemblyName!=='string'||data.assemblyName.length>200)throw Error('建模程序返回的模型名称无效');
  const assemblyId=makeId(),materialIds=new Map<string,string>();
  const materials:Material[]=data.materials.map((m:Material)=>{
    if(!m||typeof m.id!=='string'||materialIds.has(m.id))throw Error('建模程序材质标识无效');
    const id=makeId();materialIds.set(m.id,id);
    const value:Material={id,baseColor:m.baseColor,roughness:m.roughness,metalness:m.metalness};
    for(const key of ['opacity','transparent','doubleSided','alphaTest','emissive','emissiveIntensity','clearcoat','clearcoatRoughness','transmission','thickness','ior'] as const)if(m[key]!==undefined)Object.assign(value,{[key]:m[key]});
    return value;
  });
  let vertices=0,indices=0;
  const nodes:SceneNode[]=data.nodes.map((n:SceneNode)=>{
    if(!n||typeof n.name!=='string'||n.name.length>200||typeof n.visible!=='boolean'||n.geometry?.type!=='mesh'||!n.transform)throw Error('建模程序返回的网格部件无效');
    const p=n.geometry.params;
    if(!p||!Array.isArray(p.positions)||p.positions.length>limits.meshVertices*3||!Array.isArray(p.indices)||p.indices.length>limits.indices||p.normals!==undefined&&!Array.isArray(p.normals)||p.uvs!==undefined&&!Array.isArray(p.uvs))throw Error('建模程序网格缓冲无效');
    vertices+=p.positions.length/3;indices+=p.indices.length;
    if(vertices>limits.vertices||indices>limits.totalIndices)throw Error('建模程序总几何预算超限');
    if(!Array.isArray(n.transform.position)||!Array.isArray(n.transform.rotationQuaternion)||!Array.isArray(n.transform.scale))throw Error('建模程序网格变换无效');
    const materialId=materialIds.get(n.materialId??'');if(!materialId)throw Error('建模程序网格缺少有效 PBR 材质');
    return {id:makeId(),parentId:null,kind:'primitive',assemblyId,assemblyName:data.assemblyName,name:n.name,visible:n.visible,materialId,geometry:{type:'mesh',params:{positions:p.positions,indices:p.indices,...(p.normals?{normals:p.normals}:{}),...(p.uvs?{uvs:p.uvs}:{})}},transform:{position:n.transform.position,rotationQuaternion:n.transform.rotationQuaternion,scale:n.transform.scale}};
  });
  const doc:SceneDocument={schemaVersion:1,projectId:makeId(),revision:0,unit:'m',upAxis:'Y',nodes,materials,assets:[]};
  const errors=validateDocument(doc);if(errors.length)throw Error('建模程序结果无效：'+errors[0].message);
  return doc;
}

/** Execute a function BODY with THREE, away from the page and its origin. No scene is mutated. */
export async function runModelingProgram(source:string,signal?:AbortSignal):Promise<SceneDocument> {
  if(signal?.aborted)throw new DOMException('建模程序已取消','AbortError');
  if(typeof source!=='string'||!source.trim()||new TextEncoder().encode(source).byteLength>MODELING_PROGRAM_LIMITS.sourceBytes)throw Error('建模程序需为非空函数体，且不超过256KB');
  if(typeof document==='undefined'||typeof MessageChannel==='undefined')throw Error('当前环境不支持隔离浏览器建模程序');
  const {promise,resolve,reject}=Promise.withResolvers<SceneDocument>();
    const frame=document.createElement('iframe'),id=makeId();
    let port:MessagePort|undefined;
    frame.hidden=true;frame.title='隔离建模程序';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    frame.srcdoc=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script data-id="${id}">${frameSource.replace(/<\/script/gi,'<\\/script')}</script>`;
    let settled=false,ready=false,cleanupTimer:number|undefined;
    const cleanup=()=>{
      clearTimeout(timer);clearTimeout(cleanupTimer);
      signal?.removeEventListener('abort',abort);window.removeEventListener('pagehide',unload);
      window.removeEventListener('message',handshake);
      if(port){port.onmessage=null;port.onmessageerror=null;port.close();}
      frame.remove();
    };
    const finish=(error?:unknown,doc?:SceneDocument,disposed=false)=>{
      if(settled)return;settled=true;
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      const done=()=>{cleanup();if(error)reject(error);else resolve(doc!);};
      // The supervisor acknowledges termination and URL revocation before removal.
      // If the frame itself failed to load, removing its browsing context is the fallback.
      if(port)port.onmessage=event=>{if(event.data?.disposed)done();};
      if(disposed||!ready){done();return;}
      cleanupTimer=window.setTimeout(done,250);
      port?.postMessage({type:'dispose'});
    };
    const abort=()=>finish(new DOMException('建模程序已取消','AbortError'));
    const unload=()=>finish(new DOMException('建模页面已关闭','AbortError'));
    const timer=window.setTimeout(()=>finish(Error('建模程序运行超过15秒，已终止')),MODELING_PROGRAM_TIMEOUT_MS);
    const handshake=(event:MessageEvent)=>{
      if(settled||ready||event.origin!=='null'||event.data?.type!=='modeling-program-ready'||event.data.id!==id||event.ports.length!==1)return;
      ready=true;port=event.ports[0];window.removeEventListener('message',handshake);
      port.onmessage=receive;
      port.onmessageerror=()=>finish(Error('无法读取隔离建模结果'));
      port.start();
      port.postMessage({type:'run',source,core:threeCore,module:threeModule,converter:converterSource,workerSource,resultBytes:MODELING_PROGRAM_LIMITS.resultBytes});
    };
    const receive=(event:MessageEvent)=>{
      if(settled)return;
      const message=event.data;
      if(typeof message?.error==='string'){finish(Error(message.error.slice(0,2000)),undefined,message.disposed===true);return;}
      if(typeof message?.result==='string')try{finish(undefined,readResult(message.result),message.disposed===true);}catch(error){finish(error,undefined,message.disposed===true);}
    };
    window.addEventListener('message',handshake);
    signal?.addEventListener('abort',abort,{once:true});window.addEventListener('pagehide',unload,{once:true});
    if(signal?.aborted){abort();return promise;}
    try{(document.body??document.documentElement).append(frame);}catch(error){finish(error);}
  return promise;
}
