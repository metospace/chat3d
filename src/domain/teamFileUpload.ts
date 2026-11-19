import {createModelAsset,parseModelAssetFile,MAX_TEAM_ASSET_BYTES,ASSET_SIZE_ERROR,type ModelAssetVersion} from './modelAssets';
import {parseProjectFile,MAX_TEAM_SCENE_BYTES} from './project';
import {validPublishedCategoryPath} from './teamCategories';
import {prepareTeamPublicationSnapshot} from './teamPreparation';
import type {TeamPreparationResult} from './teamPreparationCore';
import type {TeamClient,TeamItem} from './teamLibrary';
import type {SceneDocument} from './types';
import {importGlb,type GlbImportStage} from '../scene/importGlb';
import {assertGlbSize} from '../scene/glbLimit';

export interface TeamUploadFile {readonly kind:'asset'|'scene';readonly name:string;readonly description:string;readonly categoryPath:string[]}
// File contents stay in memory and cannot be substituted by a caller's metadata object.
const payloads=new WeakMap<TeamUploadFile,ModelAssetVersion|SceneDocument>();
export async function parseTeamUploadFile(file:File,kind:'asset'|'scene',onStage?:(stage:GlbImportStage)=>void|Promise<void>):Promise<TeamUploadFile>{
 if(/\.(glb|gltf)$/i.test(file.name)){
  if(/\.gltf$/i.test(file.name))throw Error('暂不支持 GLTF 或外置资源，请导出为单个自包含 GLB 后再上传。');
  assertGlbSize(file.size);
  const name=file.name.replace(/\.glb$/i,'')||(kind==='asset'?'导入模型':'导入场景');
  const {doc}=await importGlb(await file.arrayBuffer(),name,onStage);
  if(kind==='scene'){
   const result:TeamUploadFile={kind,name,description:'',categoryPath:[]};payloads.set(result,doc);return result;
  }
  const asset=createModelAsset(doc,doc.nodes.map(node=>node.id),{name,category:'其他'});
  const result:TeamUploadFile={kind,name:asset.name,description:asset.description??'',categoryPath:[asset.category]};payloads.set(result,asset);return result;
 }
 const limit=kind==='asset'?MAX_TEAM_ASSET_BYTES:MAX_TEAM_SCENE_BYTES;
 if(!file.size)throw Error('文件为空，请选择资产或场景 JSON 文件');
 const sizeError=kind==='asset'?ASSET_SIZE_ERROR:`项目文件超过 ${limit/1024/1024} MiB`;
 if(file.size>limit)throw Error(sizeError);
 if(/\.zip$/i.test(file.name))throw Error('不支持上传备份包，请选择单个资产或场景 JSON 文件');
 const text=await file.text();
 if(text.length>limit||new TextEncoder().encode(text).length>limit)throw Error(sizeError);
 let header:{format?:unknown};try{header=JSON.parse(text);}catch{throw Error('文件不是有效 JSON，请选择资产或场景 JSON 文件');}
 const format=header?.format;
 if(format==='chat3d-asset-library'||format==='chat3d-workspace-backup')throw Error('不能上传资产库或工作区备份，请先恢复到本地库，再导出单个资产或场景 JSON 文件');
 if(kind==='asset'&&format==='chat3d-project')throw Error('所选文件是场景，请切换到团队场景库上传');
 if(kind==='scene'&&format==='chat3d-model-asset')throw Error('所选文件是资产，请切换到团队资产库上传');
 let payload:ModelAssetVersion|SceneDocument,name:string,description='',categoryPath:string[];
 if(kind==='asset'){
  const parsed=parseModelAssetFile(text,limit);payload=parsed.asset;name=parsed.asset.name;description=parsed.asset.description??'';categoryPath=parsed.teamCategoryPath??(validPublishedCategoryPath([parsed.asset.category])?[parsed.asset.category]:[]);
 }else{
  const parsed=parseProjectFile(text,limit);payload=parsed.doc;name=file.name.replace(/\.(chat3d\.json|json|chat3d)$/i,'')||'场景';categoryPath=parsed.teamCategoryPath??[];
 }
 const result:TeamUploadFile={kind,name,description,categoryPath};payloads.set(result,payload);return result;
}
export function canUpdateTeamUpload(client:TeamClient,item:TeamItem):boolean{
 const user=client.user;return item.sourceKind!=='glb'&&!!user&&user.role!=='viewer'&&(user.role==='admin'||item.owner===user.id);
}
export async function prepareTeamFileUpload(file:TeamUploadFile,options:{client:TeamClient;name:string;description:string;categoryPath:string[];target?:TeamItem;key:string},onStage?:(stage:string)=>void):Promise<TeamPreparationResult>{
 const {client,target,key,description,categoryPath}=options,name=options.name.trim();
 if(!client.user||client.user.role==='viewer')throw Error('请使用有发布权限的团队账号登录');
 const payload=payloads.get(file);if(!payload)throw Error('请重新选择并校验文件');
 if(target&&target.kind!==file.kind)throw Error('只能向同类型的团队原件追加版本');
 if(target&&!canUpdateTeamUpload(client,target))throw Error('只有发布者或管理员可以向团队原件追加版本');
 if(!name||options.name.length>80||typeof description!=='string'||description.length>2000||!validPublishedCategoryPath(categoryPath)||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Error('发布名称、说明、分类或请求标识无效');
 return prepareTeamPublicationSnapshot({kind:file.kind,payload,name,description,category:file.kind==='asset'?(payload as ModelAssetVersion).category:undefined,categoryPath:[...categoryPath],key,expectedVersion:target?.version??0,...(target?{itemId:target.id}:{})},onStage);
}
