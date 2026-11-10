import {ASSET_SIZE_ERROR,MAX_ASSET_BYTES,parseModelAsset} from './modelAssets';
import {parseProject,serializeProject,MAX_TEAM_SCENE_BYTES} from './project';
import type {TeamVersion} from './teamLibrary';
import {publishedCategoryPath} from './teamCategories';

/** Desktop/Web handoff: new ids so imports never overwrite local originals. */
export function buildTeamCopyExport(item:TeamVersion):string{
 const teamCategoryPath=publishedCategoryPath(item);
 if(item.kind==='asset'){
  const asset=parseModelAsset(JSON.stringify(item.payload));
  asset.id=crypto.randomUUID();
  asset.version=1;
  asset.name=item.name.slice(0,76)+' 副本';
  asset.createdAt=new Date().toISOString();
  asset.category=teamCategoryPath[teamCategoryPath.length-1]??'其他';
  const text=JSON.stringify({...asset,teamCategoryPath});
  if(text.length>MAX_ASSET_BYTES||new TextEncoder().encode(text).length>MAX_ASSET_BYTES)throw Error(ASSET_SIZE_ERROR);
  return text;
 }
 const doc=parseProject(JSON.stringify(item.payload),MAX_TEAM_SCENE_BYTES);
 doc.projectId=crypto.randomUUID();
 doc.revision=0;
 return serializeProject(doc,undefined,MAX_TEAM_SCENE_BYTES,teamCategoryPath);
}

export function teamCopyFilename(item:TeamVersion):string{
 const stem=item.name.replace(/[^\w\u4e00-\u9fff.-]+/g,'_').slice(0,48)||'team-item';
 return item.kind==='asset'?`scenivo-team-asset-${stem}-v${item.version}.json`:`scenivo-team-scene-${stem}-v${item.version}.chat3d.json`;
}

export function downloadTeamCopyFile(item:TeamVersion):string{
 const text=buildTeamCopyExport(item);
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
 const a=document.createElement('a');
 try{
  a.href=url;
  a.download=teamCopyFilename(item);
  document.body.appendChild(a);
  a.click();
  return '已发起下载。在桌面端：资产库 → 模型资产库可导入资产 JSON；工作台 → 打开项目可导入场景文件。';
 }finally{
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}
