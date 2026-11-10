import {createInitialDoc,useEditorStore} from '../store';
import {createSession,switchSession,useWorkspaceStore,updateLibrarySession,type WorkspaceSession} from '../workspace';
import {assetDocument,instantiateAsset,type ModelAssetSummary} from './modelAssets';
import {readModelAsset,listModelAssets} from './modelAssetStorage';
import {applyBatch} from './commands';
import {makeId} from '../util/ids';
import {workspaceSaveError} from './workspaceRecovery';
export function projectIsDraft(s:WorkspaceSession){return !s.librarySavedAt;}
export function projectLabel(s:WorkspaceSession){return s.snapshot.wasRunning?'正在执行':s.snapshot.pendingBatch?'待确认预览':!s.librarySavedAt?'草稿':s.savedRevision!==s.snapshot.doc.revision?'当前修改尚未保存到库':'已保存到库';}
export function assertLibraryReady(){const w=useWorkspaceStore.getState();if(!w.ready)throw Error('工作区正在恢复，请稍候');if(w.error)throw Error(workspaceSaveError(w.error));}
function navigationGuard(isCurrent:()=>boolean){const activeId=useWorkspaceStore.getState().activeId;return ()=>{assertLibraryReady();if(!isCurrent()||useWorkspaceStore.getState().activeId!==activeId)throw Error('导航已变化，已取消打开；当前项目保持不变');};}
export async function openLibraryAsset(item:ModelAssetSummary,isCurrent=()=>true){
 assertLibraryReady();const check=navigationGuard(isCurrent),latest=(await listModelAssets()).find(a=>a.id===item.id);check();if(!latest)throw Error('未找到该资产');
 item=latest;
 const existing=useWorkspaceStore.getState().sessions.filter(s=>!s.deletedAt&&s.moduleKind==='asset'&&s.assetSource?.id===item.id).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 if(existing){updateLibrarySession(existing.id,{title:item.name,autoTitle:false,assetCategory:item.category,libraryDescription:item.description,libraryMetadataRevision:item.metadataRevision,assetCatalogVersion:latest.version});if(!switchSession(existing.id)){assertLibraryReady();throw Error('编辑项目已不可用，请重新选择资产');}return {reused:true};}
 const asset=await readModelAsset(item.id,item.version);check();
 if(!createSession({...assetDocument(asset),projectId:makeId()},{moduleKind:'asset',title:item.name,assetCategory:item.category,libraryDescription:item.description,libraryMetadataRevision:item.metadataRevision,librarySavedAt:Date.now(),savedRevision:0,assetCatalogVersion:latest.version,assetSource:{id:asset.id,version:asset.version}})){assertLibraryReady();throw Error('无法打开资产，请重试');}return {reused:false};
}
export async function createSceneFromAsset(item:ModelAssetSummary,title='未命名场景',isCurrent=()=>true){
 assertLibraryReady();const check=navigationGuard(isCurrent);if(!title.trim())title='未命名场景';const asset=await readModelAsset(item.id,item.version);check();
 const result=applyBatch(createInitialDoc(),{operations:[instantiateAsset({...asset,name:item.name},[0,0,0])]});if(result.errors.length)throw Error(result.errors.map(e=>e.message).join('; '));
 if(!createSession(result.doc,{moduleKind:'scene',title:title.trim().slice(0,80)})){assertLibraryReady();throw Error('无法新建场景，请重试');}useEditorStore.setState({dirty:true});
}
