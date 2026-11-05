import {Matrix3,Matrix4,Quaternion,Vector3} from 'three';
import type {Command} from '../domain/commands';
import type {SceneDocument,Vec3} from '../domain/types';
import {importGlb} from './importGlb';

export const MAX_BLENDER_SCRIPT_BYTES=256*1024;
export interface BlenderScriptRequest {name:string;script:string}
export class BlenderScriptDeclined extends Error {
  constructor(){super('未确认执行 Blender Python，脚本未发送。');}
}
export type ConfirmBlenderScript=(request:Readonly<BlenderScriptRequest>,signal?:AbortSignal)=>Promise<boolean>;

export interface BlenderResult {name:string;blend:Blob;glb:Blob;render:Blob;script:string}
/** Preserve original Blender output bytes; never convert to SceneDocument. */
export async function runBlenderScript(args:BlenderScriptRequest,confirm:ConfirmBlenderScript|undefined,signal?:AbortSignal):Promise<BlenderResult> {
  const {script}=args,name=args.name.trim();
  if(!name||name.length>80||!script.trim()||new TextEncoder().encode(script).byteLength>MAX_BLENDER_SCRIPT_BYTES)throw Error('Blender 模型名称或 Python 脚本大小无效。');
  signal?.throwIfAborted();
  if(!confirm||!await confirm({name,script},signal))throw new BlenderScriptDeclined();
  signal?.throwIfAborted();
  const status=await pythonStatus(signal);
  if(!status.available||!status.token)throw Error('Blender Python 未启用或未取得执行令牌，脚本未发送。');
  const response=await fetch('/api/blender/python',{method:'POST',mode:'same-origin',signal,headers:{'Content-Type':'application/json','X-Chat3D-Python':status.token},body:JSON.stringify({script})});
  if(!response.ok){const body=await response.json().catch(()=>null);throw Error('Blender Python 执行失败：'+(typeof body?.error==='string'?body.error:'HTTP '+response.status));}
  const mib=1024*1024,limit=64*mib;
  if(Number(response.headers.get('Content-Length'))>limit||!response.body)throw Error('Blender 输出超过传输上限。');
  const reader=response.body.getReader(),chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Blender 输出超过传输上限。');chunks.push(value);}}
  finally{void reader.cancel().catch(()=>{});}
  signal?.throwIfAborted();
  const form=await new Response(new Blob(chunks),{headers:{'Content-Type':response.headers.get('Content-Type')??''}}).formData();
  const part=(key:string,mime:string,max:number)=>{const value=form.get(key);if(!(value instanceof Blob)||value.type!==mime||!value.size||value.size>max*mib)throw Error('Blender 未返回完整的原始模型和效果图。');return value;};
  signal?.throwIfAborted();
  return {name,script,blend:part('blend','application/octet-stream',32),glb:part('glb','model/gltf-binary',20),render:part('render','image/png',8)};
}

async function pythonStatus(signal?:AbortSignal):Promise<{available:boolean;token?:string;reason?:string}> {
  const response=await fetch('/api/blender/python/status',{signal,cache:'no-store',mode:'same-origin',headers:{'X-Chat3D-Python':'1'}});
  if(!response.ok)return {available:false};
  const status=await response.json();
  return {available:status?.available===true,token:typeof status?.token==='string'?status.token:undefined,reason:typeof status?.reason==='string'?status.reason:undefined};
}
export async function blenderPythonStatus(signal?:AbortSignal):Promise<{available:boolean;reason?:string}> {
  const {available,reason}=await pythonStatus(signal);return {available,reason};
}

export interface MountingPlateParameters {
  width:number; depth:number; thickness:number; holeDiameter:number; holeInset:number; bevel:number;
}

export async function blenderModelingStatus(signal?:AbortSignal):Promise<{available:boolean;reason?:string}> {
  const response=await fetch('/api/blender/build/status',{signal,cache:'no-store',mode:'same-origin'});
  if(!response.ok)return {available:false};
  const status=await response.json();
  return {available:(status?.modelingAvailable??status?.available)===true,reason:status?.reason==='Blender executable not found'?'找不到 Blender 可执行程序':status?.reason==='Blender modeling is not configured'?'服务端尚未启用 Blender 建模':undefined};
}

export async function blenderPlateCommands(draft:SceneDocument,args:MountingPlateParameters&{targetId?:string;name:string;position?:Vec3},signal?:AbortSignal):Promise<Command[]> {
  const {targetId,name,position,width,depth,thickness,holeDiameter,holeInset,bevel}=args;
  const target=targetId===undefined?undefined:draft.nodes.find(node=>node.id===targetId);
  if(targetId!==undefined&&(!target||target.blenderSource!=='mounting_plate'||target.kind!=='primitive'||target.geometry?.type!=='mesh'||target.modelAsset||target.modelStructure||target.modelingProgram||target.poseRig||target.connection||draft.nodes.some(node=>node.connection?.targetId===targetId)||draft.animation?.tracks.some(track=>track.sourceId===targetId||track.targetIds.includes(targetId))))throw Error('Blender 替换仅支持无资产、结构、连接、姿态或动画绑定的 Blender 实验安装板；现有对象未修改。');
  if(target&&position)throw Error('替换保留原对象的位置、朝向与缩放，请勿同时指定新位置。');
  const response=await fetch('/api/blender/build',{method:'POST',mode:'same-origin',signal,headers:{'Content-Type':'application/json','X-Chat3D-Build':'1'},body:JSON.stringify({type:'mounting_plate',width,depth,thickness,holeDiameter,holeInset,bevel})});
  if(!response.ok){const body=await response.json().catch(()=>null);throw Error('Blender 建模失败：'+(typeof body?.error==='string'?body.error.slice(0,300):'HTTP '+response.status));}
  if(Number(response.headers.get('Content-Length'))>20*1024*1024)throw Error('Blender GLB 超过 20MB，未导入。');
  const {doc}=await importGlb(await response.arrayBuffer(),name+'.glb');
  signal?.throwIfAborted();
  if(doc.nodes.length!==1)throw Error('安装板 GLB 必须包含一个网格部件，未导入。');
  const node=doc.nodes[0],geometry=node.geometry;
  if(geometry?.type!=='mesh')throw Error('Blender GLB 未返回可用网格。');
  // Normalize GLB vertices to a shared floor-origin frame for creation and later replacement.
  const t=node.transform;
    const matrix=new Matrix4().compose(new Vector3(...t.position),new Quaternion(...t.rotationQuaternion),new Vector3(...t.scale));
    if(matrix.determinant()<=0)throw Error('Blender 网格包含不支持的镜像或退化变换。');
    const normalMatrix=new Matrix3().getNormalMatrix(matrix),v=new Vector3();
    const map=(values:number[],normal=false)=>{const out:number[]=[];for(let i=0;i<values.length;i+=3){v.fromArray(values,i);if(normal)v.applyNormalMatrix(normalMatrix);else v.applyMatrix4(matrix);out.push(v.x,v.y,v.z);}return out;};
  const localGeometry={type:'mesh' as const,params:{...geometry.params,positions:map(geometry.params.positions),...(geometry.params.normals?{normals:map(geometry.params.normals,true)}:{})}};
  if(target)return [{op:'updateParameters',targetId:target.id,geometry:localGeometry}];
  node.geometry=localGeometry;node.blenderSource='mounting_plate';
  node.name=name;node.assemblyName=name;node.transform={position:position??[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]};
  return [{op:'importMeshComponent',nodes:[node],materials:doc.materials.filter(material=>material.id===node.materialId)}];
}
