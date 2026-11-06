import {isThumbnailImage} from './thumbnailImage';
import {validCategory} from './libraryMetadata';
import {validateAssetContract,type AssetContract} from './assetContract';
import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import {assemblyBounds} from './assemblyEditing';
import {validateDocument,SCHEMA_VERSION,type SceneDocument,type SceneNode,type Material,type Vec3} from './types';
import type {Command} from './commands';
import {makeId} from '../util/ids';
export const ASSET_CATEGORIES=['设备','人员','工位','仓储','物料','其他'] as const;
export type AssetCategory=string;
export interface ModelAssetVersion {
 format:'chat3d-model-asset';schemaVersion:1;id:string;version:number;name:string;category:AssetCategory;description?:string;
 createdAt:string;unit:'m';upAxis:'Y';front:'+Z'|'-Z'|'+X'|'-X';quality:'unreviewed';contract?:AssetContract;
 size:Vec3;nodes:SceneNode[];materials:Material[];thumbnail?:string;externalConnectionsRemoved:number;
}
export interface ModelAssetSummary {id:string;version:number;name:string;category:AssetCategory;createdAt:string;size:Vec3;parts:number;thumbnail?:string;quality:'unreviewed';purpose?:string;anchorCount?:number;description?:string;metadataRevision?:number}
export const MAX_ASSET_BYTES=200*1024*1024;
export const MAX_TEAM_ASSET_BYTES=50*1024*1024;
const assetSizeError=(maxBytes:number)=>`资产超过${maxBytes/1024/1024} MiB，请精简或分拆模型`;
export const ASSET_SIZE_ERROR=assetSizeError(MAX_ASSET_BYTES);
export function assetDocument(asset:ModelAssetVersion):SceneDocument{return {schemaVersion:SCHEMA_VERSION,projectId:asset.id,revision:0,unit:'m',upAxis:'Y',nodes:structuredClone(asset.nodes),materials:structuredClone(asset.materials),assets:[]};}
export function selectedAssetNodes(doc:SceneDocument,selection:string[]):SceneNode[]{const ids=new Set(selection),groups=new Set(doc.nodes.filter(n=>ids.has(n.id)&&n.assemblyId).map(n=>n.assemblyId));return doc.nodes.filter(n=>ids.has(n.id)||(n.assemblyId&&groups.has(n.assemblyId)));}
export function createModelAsset(doc:SceneDocument,selection:string[],details:{name:string;category:AssetCategory;front?:ModelAssetVersion['front'];id?:string;version?:number}):ModelAssetVersion{
 const picked=selectedAssetNodes(doc,selection);if(!picked.length)throw Error('请选择零件；选中组件中的一个零件会保存整个组件');
 if(picked.some(n=>!n.geometry||n.kind!=='primitive'||n.parentId!==null))throw Error('首版资产库只支持平级可编辑几何；请先转换层级或外部引用模型');
 if(doc.unit!=='m'||doc.upAxis!=='Y')throw Error('资产库使用米制、Y轴向上，请先统一坐标');
 const bounds=assemblyBounds(picked),size=bounds.getSize(new Vector3()).toArray() as Vec3;
 if(bounds.isEmpty()||size.some(x=>!Number.isFinite(x)))throw Error('选中模型没有可用边界');
 const origin=new Vector3((bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2);
 const ids=new Set(picked.map(n=>n.id));let removed=0;
 const nodes=structuredClone(picked).map(n=>{delete n.modelAsset;delete n.planKey;delete n.zone;n.transform.position=new Vector3(...n.transform.position).sub(origin).toArray() as Vec3;if(n.connection&&!ids.has(n.connection.targetId)){delete n.connection;removed++;}return n;});
 const materials=structuredClone(doc.materials.filter(m=>nodes.some(n=>n.materialId===m.id)));
 const asset:ModelAssetVersion={format:'chat3d-model-asset',schemaVersion:1,id:details.id??makeId(),version:details.version??1,name:details.name.trim(),category:details.category,front:details.front??'+Z',createdAt:new Date().toISOString(),unit:'m',upAxis:'Y',quality:'unreviewed',size,nodes,materials,externalConnectionsRemoved:removed};
 validateModelAsset(asset);return asset;
}
export function validateModelAsset(asset:ModelAssetVersion):void{
 if(!asset||asset.format!=='chat3d-model-asset'||asset.schemaVersion!==1||!/^[-a-zA-Z0-9_]{1,100}$/.test(asset.id)||!Number.isSafeInteger(asset.version)||asset.version<1||asset.version>10000||typeof asset.name!=='string'||!asset.name.trim()||asset.name.length>80||!validCategory(asset.category)||(asset.description!==undefined&&(typeof asset.description!=='string'||asset.description.length>1000))||!['+Z','-Z','+X','-X'].includes(asset.front)||asset.unit!=='m'||asset.upAxis!=='Y'||asset.quality!=='unreviewed'||!Number.isFinite(Date.parse(asset.createdAt)))throw Error('不支持的资产格式、版本或元数据');
 if(!Array.isArray(asset.nodes)||!asset.nodes.length||!Array.isArray(asset.materials)||asset.nodes.some(n=>!n.geometry||n.kind!=='primitive'||n.parentId!==null))throw Error('资产零件或材质数量、结构不受支持');
 if(!Number.isSafeInteger(asset.externalConnectionsRemoved)||asset.externalConnectionsRemoved<0)throw Error('资产连接元数据无效');
 if(asset.thumbnail&&!isThumbnailImage(asset.thumbnail))throw Error('缩略图无效或过大');
 if(asset.contract)validateAssetContract(asset.contract,asset.nodes);
 const errors=validateDocument(assetDocument(asset));if(errors.length)throw errors[0];
 const actual=assemblyBounds(asset.nodes).getSize(new Vector3()).toArray();if(!Array.isArray(asset.size)||asset.size.length!==3||asset.size.some((n,i)=>!Number.isFinite(n)||Math.abs(n-actual[i])>1e-5))throw Error('资产尺寸与几何不一致');
 if(new TextEncoder().encode(JSON.stringify(asset)).length>MAX_ASSET_BYTES)throw Error(ASSET_SIZE_ERROR);
}
export function summarizeAsset(a:ModelAssetVersion):ModelAssetSummary{return {id:a.id,version:a.version,name:a.name,category:a.category,description:a.description,createdAt:a.createdAt,size:[...a.size],parts:a.nodes.length,purpose:a.contract?.purpose,anchorCount:a.contract?.anchors.length??0,thumbnail:a.thumbnail,quality:'unreviewed'};}
export function instantiateAsset(a:ModelAssetVersion,position:Vec3,yaw=0):Command{
 validateModelAsset(a);if(position.length!==3||position.some(n=>!Number.isFinite(n)||Math.abs(n)>10000)||!Number.isFinite(yaw)||Math.abs(yaw)>3600)throw Error('插入位置或角度无效');
 const rotation=new Quaternion().setFromEuler(new Euler(0,yaw*Math.PI/180,0)),matrix=new Matrix4().compose(new Vector3(...position),rotation,new Vector3(1,1,1)),instanceId=makeId();
 const singleGroup=new Set(a.nodes.map(n=>n.assemblyId??n.id)).size===1;
 const nodes=structuredClone(a.nodes).map(n=>{n.assemblyName=singleGroup?a.name:(a.name+' / '+(n.assemblyName??n.name)).slice(0,200);const p=new Vector3(),q=new Quaternion(),s=new Vector3();new Matrix4().compose(new Vector3(...n.transform.position),new Quaternion(...n.transform.rotationQuaternion),new Vector3(...n.transform.scale)).premultiply(matrix).decompose(p,q,s);n.transform={position:p.toArray() as Vec3,rotationQuaternion:q.toArray() as [number,number,number,number],scale:s.toArray() as Vec3};n.modelAsset={id:a.id,version:a.version,instanceId,sourceNodeId:n.id};return n;});
 return {op:'importComponentDraft',nodes,materials:structuredClone(a.materials)};
}
export function parseModelAsset(text:string,maxBytes=MAX_ASSET_BYTES):ModelAssetVersion{if(text.length>maxBytes||new TextEncoder().encode(text).length>maxBytes)throw Error(assetSizeError(maxBytes));let a:ModelAssetVersion;try{a=JSON.parse(text);}catch{throw Error('资产不是有效JSON');}validateModelAsset(a);return a;}

// A newly saved independent copy retains the actual editor node IDs. Its source
// can therefore create the next revision even if those nodes came from an older asset.
export function assetVersionSourceIssue(nodes:SceneNode[],target:ModelAssetVersion):string|undefined {
 const originalIds=new Set(target.nodes.map(n=>n.id));
 if(nodes.some(n=>n.modelAsset&&n.modelAsset.id!==target.id&&!originalIds.has(n.id)))return '选中模型来自另一资产，请保存为新资产。';
 return undefined;
}
