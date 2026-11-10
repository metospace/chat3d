import {useEditorStore} from '../store';
import {flushWorkspace,updateLibrarySession,useWorkspaceStore,syncAssetCatalogMetadata} from '../workspace';
import {createModelAsset} from './modelAssets';
import {saveModelAsset,readModelAsset,listModelAssets,updateModelAssetMetadata,readAssetQuality} from './modelAssetStorage';
import {normalizeLibraryMetadata,type LibraryMetadata} from './libraryMetadata';
import {assetQualityStatus,validateAssetQuality} from './assetQuality';
import {assertLibraryReady} from './libraryNavigation';
import type {SceneDocument} from './types';
const locked=()=>['capturing','context','generating','validating','previewing','applying'].includes(useEditorStore.getState().aiStatus);
const inFlight=new Set<string>();
export interface LibrarySaveProgress {stage:'preparing'|'thumbnail'|'validating'|'writing'|'workspace'|'complete';completed:number;total:number}
export interface LibrarySaveOptions {metadata:LibraryMetadata;sessionId:string;projectId:string;metadataRevision?:number;onProgress?:(progress:LibrarySaveProgress)=>void}
export async function saveLibraryProject(thumbnail?:(doc:SceneDocument)=>Promise<string>,options?:LibrarySaveOptions):Promise<string>{
 const w=useWorkspaceStore.getState(),s=useEditorStore.getState(),session=w.sessions.find(x=>x.id===w.activeId&&!x.deletedAt);
 assertLibraryReady();if(!session)throw Error('没有可保存的当前项目');
 if(locked())throw Error('请先结束生成并应用或放弃预览');
 if(options&&(options.sessionId!==session.id||options.projectId!==s.doc.projectId))throw Error('当前项目已切换，请重新打开保存窗口');
 if(inFlight.has(session.id))throw Error('项目正在保存，请勿重复提交');
 inFlight.add(session.id);
 const progress=async(stage:LibrarySaveProgress['stage'],completed:number)=>{options?.onProgress?.({stage,completed,total:5});if(options?.onProgress){const {promise,resolve}=Promise.withResolvers<void>();if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>setTimeout(resolve,0));else setTimeout(resolve,0);await promise;}};
 try{
 const doc=s.doc,kind=session.moduleKind??'scene';
 const unchanged=()=>{const current=useEditorStore.getState();if(useWorkspaceStore.getState().activeId!==session.id||current.doc!==doc||current.doc.revision!==doc.revision||current.doc.projectId!==doc.projectId||locked())throw Error('保存期间项目发生变化，请确认当前模型后再保存');};
 if(options?.onProgress){await progress('preparing',0);unchanged();}
 if(kind==='scene'){
 const metadata=normalizeLibraryMetadata(options?.metadata??{name:session.title,category:session.sceneCategory,description:session.libraryDescription},kind);
 const metadataRevision=session.libraryMetadataRevision??0;if(options&&options.metadataRevision!==undefined&&options.metadataRevision!==metadataRevision)throw Error('项目信息已更新，请重新打开保存窗口');
 let sceneThumbnail=session.sceneThumbnail;if(options?.onProgress)await progress('thumbnail',1);if(thumbnail&&doc.nodes.length)try{sceneThumbnail=await thumbnail(doc);}catch{}
 unchanged();if((useWorkspaceStore.getState().sessions.find(x=>x.id===session.id)?.libraryMetadataRevision??0)!==metadataRevision)throw Error('保存期间项目信息发生变化，请重新保存');
 if(options?.onProgress)await progress('writing',3);unchanged();updateLibrarySession(session.id,{moduleKind:'scene',title:metadata.name,autoTitle:false,sceneCategory:metadata.category,libraryDescription:metadata.description,libraryMetadataRevision:metadataRevision+1,sceneThumbnail,librarySavedAt:Date.now(),savedRevision:doc.revision});
 if(options?.onProgress)await progress('workspace',4);await flushWorkspace();assertLibraryReady();options?.onProgress?.({stage:'complete',completed:5,total:5});return `场景已保存到场景库：${metadata.name} r${doc.revision}。引用资产版本保持固定。`;
 }
 if(!doc.nodes.length)throw Error('资产还是空的，请先生成或导入模型');
 const source=session.assetSource,head=source?(await listModelAssets()).find(a=>a.id===source.id):undefined;
 if(source&&(!head||head.version!==source.version))throw Error('资产已有更新版本，请从资产库核对后再保存；当前草稿已保留');
 if(options?.metadataRevision!==undefined&&(head?.metadataRevision??0)!==options.metadataRevision)throw Error('资产信息已在其他页面更新，请重新打开保存窗口');
 // A reopened/stale editing session must never replace newer catalog metadata implicitly.
 const metadata=normalizeLibraryMetadata(options?.metadata??(head?{name:head.name,category:head.category,description:head.description}:{name:session.title,category:session.assetCategory,description:session.libraryDescription}),kind);
 let version=source?.version??0,id=source?.id,metadataRevision=head?.metadataRevision??0,qualityNotice='质量仍待验收。';
 if(head&&session.savedRevision===doc.revision&&session.librarySavedAt){
 try{const record=await readAssetQuality(head.id,head.version);if(record)await validateAssetQuality(await readModelAsset(head.id,head.version),record);qualityNotice={unreviewed:'质量仍待验收。',pending:'质量仍有待验项。',needs_work:'本版验收记录有待修正项。',user_reviewed:'本版已记录人工复核。'}[assetQualityStatus(record)];}catch{qualityNotice='暂无法读取本版验收记录。';}
 if(options?.onProgress)await progress('writing',3);unchanged();const result=await updateModelAssetMetadata(head.id,metadata,head);metadataRevision=result.metadataRevision!;
 }else{
 let preview:string|undefined;if(options?.onProgress)await progress('thumbnail',1);if(thumbnail)try{preview=await thumbnail(doc);}catch{/* Geometry can still be saved without a thumbnail. */}
 unchanged();if(options?.onProgress)await progress('validating',2);unchanged();
 const previous=source?await readModelAsset(source.id,source.version):undefined;
 const asset=createModelAsset(doc,doc.nodes.map(n=>n.id),{name:metadata.name,category:metadata.category!,front:previous?.front,...(source?{id:source.id,version:source.version+1}:{})});asset.description=metadata.description;if(preview)asset.thumbnail=preview;
 if(options?.onProgress)await progress('writing',3);unchanged();await saveModelAsset(asset,source?.version??0,metadataRevision);id=asset.id;version=asset.version;metadataRevision=head?metadataRevision+1:0;
 }
 // The catalog write may finish after a switch. Update only the originating session;
 // never replace its snapshot or mark a newer document revision as saved.
 if(options?.onProgress)await progress('workspace',4);
 await syncAssetCatalogMetadata({id:id!,name:metadata.name,category:metadata.category!,description:metadata.description,metadataRevision});
 updateLibrarySession(session.id,{moduleKind:'asset',title:metadata.name,autoTitle:false,assetSource:{id:id!,version},assetCatalogVersion:version,assetCategory:metadata.category,libraryDescription:metadata.description,libraryMetadataRevision:metadataRevision,librarySavedAt:Date.now(),savedRevision:doc.revision});
 await flushWorkspace();if(useWorkspaceStore.getState().error)throw Error('资产版本已保存，但编辑项目的状态保存失败，请到资产库重新打开，避免重复保存');
 options?.onProgress?.({stage:'complete',completed:5,total:5});return `资产已保存到资产库：${metadata.name} v${version}。${qualityNotice}`;
 }finally{inFlight.delete(session.id);}
}
