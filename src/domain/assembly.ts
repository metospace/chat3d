import {MAX_PROJECT_BYTES,PROJECT_SIZE_ERROR} from './project';
import {validateBlueprints,type ObjectBlueprint} from './objectBlueprint';
import {Matrix4,Quaternion as Q,Vector3} from 'three';
import {SCENE_ROLE_MATERIALS} from './materials';
import {makeId} from '../util/ids';
import type {Geometry,SceneNode,Transform,Vec3,Quaternion,SceneRole} from './types';
import {SCENE_ROLES,validateGeometry,validateQuaternion,validateVec3} from './types';
export interface AssemblyPart {structureFeatures?:string[];name:string;geometry:Geometry;materialId?:string;label?:string;transform:Transform;repeat?:{count:number;step:Vec3}}
export interface AssemblyDefinition {blueprint?:ObjectBlueprint;name:string;sceneRole?:SceneRole;planKey?:string;zone?:string;position?:Vec3;yaw?:number;parts:AssemblyPart[]}
export class AssemblyValidationError extends Error {
 constructor(public issues:string[]){super('部件校验发现'+issues.length+'项问题：\n'+issues.join('\n'));this.name='AssemblyValidationError';}
}
// User/model-defined recipe only: no equipment catalogue or industrial defaults.
export function buildAssembly(def:AssemblyDefinition):SceneNode[]{
 if(!def.name?.trim()||def.name.length>120||!Array.isArray(def.parts)||!def.parts.length||def.parts.length>100)throw new Error('组合需要名称和1–100条自定义部件定义');
 if(def.blueprint){validateBlueprints([def.blueprint]);for(const p of def.parts)if(!Array.isArray(p.structureFeatures)||p.structureFeatures.length>16||new Set(p.structureFeatures).size!==p.structureFeatures.length||p.structureFeatures.some(k=>!def.blueprint!.features.some(f=>f.key===k)))throw Error('单体部件结构标识无效');}
 if(def.sceneRole!==undefined&&!SCENE_ROLES.includes(def.sceneRole))throw new Error('场景角色无效');
 for(const key of ['planKey','zone'] as const)if(def[key]!==undefined&&(typeof def[key]!=='string'||def[key]!.length>120))throw new Error('设计标识或区域名称无效');
 for(const part of def.parts)if(part.label!==undefined&&(typeof part.label!=='string'||part.label.length>80))throw new Error('部件标注最长80字');
 const position=def.position??[0,0,0],yaw=def.yaw??0;
 if(validateVec3(position,'组合位置').length||!Number.isFinite(yaw))throw new Error('组合位置或角度无效');
 let minimumBytes=0;const issues:string[]=[],encoder=new TextEncoder();
 for(const [index,p] of def.parts.entries()){const where='部件'+(index+1)+' '+String(p?.name??'').slice(0,60)+' [parts['+index+']]：';try{const t=p.transform,repeat=p.repeat;
  if(!p.name?.trim()||p.name.length>100)throw Error(where+'name需为1–100字名称');
  const geometryErrors=validateGeometry(p.geometry);if(geometryErrors.length)throw Error(where+geometryErrors.map(e=>e.message).join('；'));
  if(!t)throw Error(where+'缺少transform');
  const transformErrors=[...validateVec3(t.position,'transform.position'),...validateVec3(t.scale,'transform.scale'),...validateQuaternion(t.rotationQuaternion,'transform.rotationQuaternion')];if(transformErrors.length)throw Error(where+transformErrors.map(e=>e.message).join('；'));
  if(t.scale.some(n=>n<=0))throw Error(where+'transform.scale各轴必须大于0');
  if(repeat&&(!Number.isSafeInteger(repeat.count)||repeat.count<1||validateVec3(repeat.step,'repeat.step').length))throw Error(where+'repeat.count需为正整数，repeat.step需为三维间距');
  // Reject an impossible expansion before allocating it; the complete project is checked on commit.
  minimumBytes+=(encoder.encode(JSON.stringify(p.geometry)).byteLength+2)*(repeat?.count??1);
 }catch(error){issues.push(error instanceof Error?error.message:String(error));}}
 if(issues.length)throw new AssemblyValidationError(issues);
 if(minimumBytes>MAX_PROJECT_BYTES)throw new Error(PROJECT_SIZE_ERROR);
 const root=new Matrix4().compose(new Vector3(...position),new Q().setFromAxisAngle(new Vector3(0,1,0),yaw*Math.PI/180),new Vector3(1,1,1));
 const assemblyId=makeId(),nodes:SceneNode[]=[];
 for(const part of def.parts)for(let i=0;i<(part.repeat?.count??1);i++){
  const p=new Vector3(...part.transform.position);if(part.repeat)p.addScaledVector(new Vector3(...part.repeat.step),i);
  const localTransform:Transform={position:p.toArray() as Vec3,rotationQuaternion:[...part.transform.rotationQuaternion],scale:[...part.transform.scale]};
  const matrix=new Matrix4().compose(p,new Q(...part.transform.rotationQuaternion),new Vector3(...part.transform.scale)).premultiply(root),q=new Q(),scale=new Vector3();matrix.decompose(p,q,scale);q.normalize();
  nodes.push({...(def.blueprint?{modelStructure:{blueprintKey:def.blueprint.key,featureKeys:[...part.structureFeatures!],localTransform,...(nodes.length?{}:{blueprint:structuredClone(def.blueprint)})}}:{}),id:nodes.length?makeId():assemblyId,assemblyId,assemblyName:def.name,...(def.sceneRole?{sceneRole:def.sceneRole}:{}),...(def.planKey?{planKey:def.planKey}:{}),...(def.zone?{zone:def.zone}:{}),...(part.label?{label:part.label}:{}),name:`${def.name} · ${part.name}${part.repeat?' '+(i+1):''}`,kind:'primitive',parentId:null,visible:true,geometry:structuredClone(part.geometry),materialId:part.materialId??SCENE_ROLE_MATERIALS[def.sceneRole??'other'],transform:{position:p.toArray() as Vec3,rotationQuaternion:q.toArray() as Quaternion,scale:scale.toArray() as Vec3}});
 }
 return nodes;
}
