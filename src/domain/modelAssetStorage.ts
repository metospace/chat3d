import {encodeIdbValue,decodeIdbValue,type IdbGraphRoot,type IdbGraphRecord} from './idbChunks';
import {isThumbnailImage} from './thumbnailImage';
import {defaultLibraryCategories,validateCategoryTree,type LibraryCategory} from './libraryCategories';
import {normalizeLibraryMetadata,validCategory,type LibraryMetadata} from './libraryMetadata';
import {validateAssetQuality,type AssetQualityRecord} from './assetQuality';
import {ASSET_CATEGORIES,validateModelAsset,summarizeAsset,type ModelAssetVersion,type ModelAssetSummary} from './modelAssets';
const DB='chat3d.model-assets.v1';
export function openModelAssetDatabase():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{if(typeof indexedDB==='undefined'){reject(Error('浏览器不支持资产存储'));return;}let rejected=false;const request=indexedDB.open(DB,5);request.onupgradeneeded=()=>{for(const [name,keyPath] of [['items','id'],['versions',['id','version']],['reviews',['assetId','version']],['categories','value'],['sceneCategories','value']] as const){if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:typeof keyPath==='string'?keyPath:[...keyPath]});}if(!request.result.objectStoreNames.contains('chunks'))request.result.createObjectStore('chunks');};request.onsuccess=()=>{const db=request.result;if(rejected){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};request.onerror=()=>{rejected=true;reject(Error('资产库打开失败'));};request.onblocked=()=>{rejected=true;reject(Error('资产库被旧页面占用，请关闭旧页面后重试'));};});}
export async function listModelAssets():Promise<ModelAssetSummary[]>{const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('items'),r=tx.objectStore('items').getAll();tx.oncomplete=()=>{db.close();resolve((r.result as ModelAssetSummary[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));};tx.onabort=()=>{db.close();reject(Error('资产列表读取失败'));};});}
interface StoredAssetVersion {id:string;version:number;storageFormat:'chunked-asset-v1';root:IdbGraphRoot}
function addAssetVersion(tx:IDBTransaction,asset:ModelAssetVersion){const root=encodeIdbValue(asset,(chunk,record)=>tx.objectStore('chunks').add(record,[asset.id,asset.version,chunk]));tx.objectStore('versions').add({id:asset.id,version:asset.version,storageFormat:'chunked-asset-v1',root} satisfies StoredAssetVersion);}
function hydrateAssetVersion(tx:IDBTransaction,value:ModelAssetVersion|StoredAssetVersion,done:(asset:ModelAssetVersion)=>void,fail:(error:unknown)=>void){if(!('storageFormat' in value)){done(value);return;}if(value.storageFormat!=='chunked-asset-v1'){fail(Error('资产存储格式无效'));return;}const records=new Map<number,IdbGraphRecord>();let remaining=value.root.recordCount;if(!remaining){try{done(decodeIdbValue(value.root,records) as ModelAssetVersion);}catch(error){fail(error);}return;}for(let chunk=0;chunk<value.root.recordCount;chunk++){const get=tx.objectStore('chunks').get([value.id,value.version,chunk]);get.onsuccess=()=>{if(get.result===undefined){fail(Error('资产分块不完整，原有版本未改动'));return;}records.set(chunk,get.result);if(--remaining===0)try{done(decodeIdbValue(value.root,records) as ModelAssetVersion);}catch(error){fail(error);}};}}
export async function readModelAsset(id:string,version:number):Promise<ModelAssetVersion>{const db=await openModelAssetDatabase(),{promise,resolve,reject}=Promise.withResolvers<ModelAssetVersion>();const tx=db.transaction(['versions','chunks']),get=tx.objectStore('versions').get([id,version]);let asset:ModelAssetVersion|undefined,error:unknown;get.onsuccess=()=>{if(!get.result){error=Error('未找到该资产版本');tx.abort();return;}hydrateAssetVersion(tx,get.result,value=>asset=value,failure=>{error=failure;tx.abort();});};tx.oncomplete=()=>{db.close();try{if(!asset)throw Error('资产读取不完整');validateModelAsset(asset);resolve(asset);}catch(error){reject(error);}};tx.onabort=()=>{db.close();reject(error??Error('资产读取失败'));};return promise;}
export async function saveModelAsset(asset:ModelAssetVersion,expectedVersion=0,expectedMetadataRevision?:number):Promise<void>{validateModelAsset(asset);if(asset.version!==expectedVersion+1)throw Error('新版本必须连续递增');const db=await openModelAssetDatabase(),{promise,resolve,reject}=Promise.withResolvers<void>();const tx=db.transaction(['items','versions','chunks'],'readwrite'),items=tx.objectStore('items');let conflict=false,failure:unknown;const headRequest=items.get(asset.id);try{addAssetVersion(tx,asset);}catch(error){failure=error;tx.abort();}const summary=summarizeAsset(asset);headRequest.onsuccess=()=>{const head=headRequest.result as ModelAssetSummary|undefined;if((head?.version??0)!==expectedVersion||(expectedMetadataRevision!==undefined&&(head?.metadataRevision??0)!==expectedMetadataRevision)){conflict=true;tx.abort();return;}items.put({...summary,...(head&&expectedMetadataRevision===undefined?{name:head.name,category:head.category,description:head.description}:{}),metadataRevision:head?(head.metadataRevision??0)+1:0});};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(Error(conflict?'资产已被其他页面更新，请刷新后另存新版本':failure instanceof Error?failure.message:'资产保存失败，可能存储空间不足；原有版本未改动'));};tx.onerror=()=>{};return promise;}

export async function readAssetQuality(id:string,version:number):Promise<AssetQualityRecord|undefined>{const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('reviews'),r=tx.objectStore('reviews').get([id,version]);tx.oncomplete=()=>{db.close();resolve(r.result);};tx.onabort=()=>{db.close();reject(Error('验收记录读取失败'));};});}
export async function saveAssetQuality(record:AssetQualityRecord):Promise<void>{const a=await readModelAsset(record.assetId,record.version);await validateAssetQuality(a,record);const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('reviews','readwrite');tx.objectStore('reviews').put(structuredClone(record));tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(Error('验收记录保存失败'));};});}
export const MAX_ASSET_LIBRARY_BACKUP_BYTES=400*1024*1024;
export const ASSET_LIBRARY_BACKUP_SIZE_ERROR=`资产库备份超过${MAX_ASSET_LIBRARY_BACKUP_BYTES/1024/1024} MiB，请逐项下载`;
export const MAX_ASSET_LIBRARY_BACKUP_RECORDS=200;
export function assertAssetLibraryBackupCounts(backup:Pick<AssetLibraryBackup,'versions'|'reviews'|'metadata'>):void {
 for(const [key,label] of [['versions','历史版本'],['reviews','验收记录'],['metadata','资产信息']] as const){const rows=backup[key];if(rows!==undefined&&!Array.isArray(rows))throw Error(`备份${label}格式无效`);if(rows&&rows.length>MAX_ASSET_LIBRARY_BACKUP_RECORDS)throw Error(`资产库备份的${label}超过 ${MAX_ASSET_LIBRARY_BACKUP_RECORDS} 条，无法完整恢复；请保留原库，减少记录后再备份，勿用逐项下载替代历史备份`);}
}
export interface AssetLibraryBackup {format:'chat3d-asset-library';schemaVersion:1;createdAt:string;versions:ModelAssetVersion[];reviews?:AssetQualityRecord[];metadata?:Array<LibraryMetadata&{id:string}>;categories?:LibraryCategory[];sceneCategories?:LibraryCategory[]}
async function readAssetLibraryBackup():Promise<AssetLibraryBackup>{const db=await openModelAssetDatabase(),{promise,resolve,reject}=Promise.withResolvers<AssetLibraryBackup>();const tx=db.transaction(['versions','chunks','reviews','items','categories','sceneCategories']),items=tx.objectStore('items').getAll(),categories=tx.objectStore('categories').getAll(),sceneCategories=tx.objectStore('sceneCategories').getAll(),r=tx.objectStore('versions').getAll(),reviews=tx.objectStore('reviews').getAll();const versions:ModelAssetVersion[]=[];let failure:unknown;r.onsuccess=()=>{versions.length=r.result.length;r.result.forEach((value:ModelAssetVersion|StoredAssetVersion,index:number)=>hydrateAssetVersion(tx,value,asset=>versions[index]=asset,error=>{failure=error;tx.abort();}));};tx.oncomplete=()=>{db.close();resolve({format:'chat3d-asset-library',schemaVersion:1,createdAt:new Date().toISOString(),versions,reviews:reviews.result,metadata:items.result.map((a:ModelAssetSummary)=>({id:a.id,name:a.name,category:a.category,description:a.description})),categories:categories.result,sceneCategories:sceneCategories.result});};tx.onabort=()=>{db.close();reject(failure??Error('资产备份读取失败'));};return promise;}
function checkedBackupText(backup:AssetLibraryBackup):string{assertAssetLibraryBackupCounts(backup);const text=JSON.stringify(backup);assertAssetLibraryBackupSize(new TextEncoder().encode(text).length);return text;}
export function assertAssetLibraryBackupSize(size:number):void{if(size>MAX_ASSET_LIBRARY_BACKUP_BYTES)throw Error(ASSET_LIBRARY_BACKUP_SIZE_ERROR);}
export async function exportAssetLibrary():Promise<AssetLibraryBackup>{const backup=await readAssetLibraryBackup();checkedBackupText(backup);return backup;}
export async function exportAssetLibraryText():Promise<string>{return checkedBackupText(await readAssetLibraryBackup());}
export interface AssetImportResult {count:number;categoryConflicts:string[]}
export async function importAssetLibrary(text:string):Promise<number>{return (await importAssetLibraryDetailed(text)).count;}
export async function importAssetLibraryDetailed(text:string):Promise<AssetImportResult>{
 assertAssetLibraryBackupSize(new TextEncoder().encode(text).length);
 const b=JSON.parse(text) as AssetLibraryBackup;if(b?.format!=='chat3d-asset-library'||b.schemaVersion!==1||!Array.isArray(b.versions)||(!b.versions.length&&!b.categories?.length&&!b.sceneCategories?.length))throw Error('资产库备份格式或数量无效');
 assertAssetLibraryBackupCounts(b);
 const mapping=new Map<string,string>(),seen=new Set<string>(),grouped=new Map<string,number[]>();
 for(const a of b.versions){validateModelAsset(a);const key=a.id+':'+a.version;if(seen.has(key))throw Error('资产版本重复');seen.add(key);const rows=grouped.get(a.id)??[];rows.push(a.version);grouped.set(a.id,rows);if(!mapping.has(a.id))mapping.set(a.id,crypto.randomUUID());}
 for(const versions of grouped.values())if(versions.sort((a,b)=>a-b).some((v,i)=>v!==i+1))throw Error('备份必须包含从v1开始的连续版本');
 const importedReviews:AssetQualityRecord[]=[];if(b.reviews!==undefined){const keys=new Set<string>();for(const r of b.reviews){const a=b.versions.find(a=>a.id===r.assetId&&a.version===r.version);if(!a||keys.has(r.assetId+':'+r.version))throw Error('备份验收记录引用无效');keys.add(r.assetId+':'+r.version);await validateAssetQuality(a,r);importedReviews.push({...structuredClone(r),assetId:mapping.get(r.assetId)!,origin:'imported'});}}
 const metadata=new Map<string,LibraryMetadata>();if(b.metadata!==undefined){for(const entry of b.metadata){if(!mapping.has(entry.id)||metadata.has(mapping.get(entry.id)!))throw Error('备份资产信息引用无效');metadata.set(mapping.get(entry.id)!,normalizeLibraryMetadata(entry,'asset'));}}
 const categories=b.categories??[];if(!Array.isArray(categories)||categories.length>500||new Set(categories.map(c=>c.value)).size!==categories.length||categories.some(c=>!validCategory(c.value)||!validCategory(c.label)||!Number.isSafeInteger(c.revision)||c.revision<0))throw Error('备份分类无效');
 const sceneCategories=b.sceneCategories??[];if(!Array.isArray(sceneCategories))throw Error('场景分类备份无效');for(const [kind,rows] of [['asset',categories],['scene',sceneCategories]] as const){validateCategoryTree(rows.map(c=>({...c,parentValue:undefined})));validateCategoryTree([...new Map([...defaultLibraryCategories(kind),...rows].map(c=>[c.value,c])).values()]);}
 const values=b.versions.map(a=>({...structuredClone(a),id:mapping.get(a.id)!}));const latest=new Map<string,ModelAssetVersion>();for(const a of values)if(!latest.has(a.id)||latest.get(a.id)!.version<a.version)latest.set(a.id,a);
 const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{
 const tx=db.transaction(['items','versions','chunks','reviews','categories','sceneCategories'],'readwrite'),existingItems=tx.objectStore('items').getAll(),existingCategories=tx.objectStore('categories').getAll(),existingScenes=tx.objectStore('sceneCategories').getAll();const categoryConflicts:string[]=[];
 existingScenes.onsuccess=()=>{try{
 const local=new Map<string,string>();
 // Defaults and legacy item values are already meaningful in a populated library,
 // even when no explicit category-management row has ever been written.
 if(existingItems.result.length){for(const value of ASSET_CATEGORIES)local.set(value,value);for(const a of existingItems.result)if(validCategory(a.category))local.set(a.category,a.category);}
 for(const category of existingCategories.result as LibraryCategory[])local.set(category.value,category.label);
 for(const category of categories){const label=local.get(category.value);if(label!==undefined){if(label!==category.label)categoryConflicts.push(`分类“${category.value}”保留本地名称“${label}”，未采用备份名称“${category.label}”`);}else tx.objectStore('categories').put({...category,revision:1});}
 const mergedAssets=new Map([...defaultLibraryCategories(),...categories,...existingCategories.result].map((c:LibraryCategory)=>[c.value,c]));validateCategoryTree([...mergedAssets.values()]);
 const localScenes=new Map((existingScenes.result as LibraryCategory[]).map(c=>[c.value,c]));for(const c of sceneCategories){if(!localScenes.has(c.value))tx.objectStore('sceneCategories').put({...c,revision:1});else if(JSON.stringify(localScenes.get(c.value))!==JSON.stringify(c))categoryConflicts.push('场景分类“'+c.label+'”保留本地设置');}validateCategoryTree([...new Map([...defaultLibraryCategories('scene'),...sceneCategories,...existingScenes.result].map((c:LibraryCategory)=>[c.value,c])).values()]);
 for(const r of importedReviews)tx.objectStore('reviews').add(r);for(const a of values)addAssetVersion(tx,a);for(const a of latest.values())tx.objectStore('items').add({...summarizeAsset(a),...metadata.get(a.id),metadataRevision:0});
 }catch{tx.abort();}};
 tx.oncomplete=()=>{db.close();resolve({count:latest.size,categoryConflicts});};tx.onabort=()=>{db.close();reject(Error('备份恢复失败，未写入部分资产'));};
 });
}

/** Update the catalog only. Version records, geometry, reviews and scene instances stay byte-for-byte unchanged. */
export async function updateModelAssetMetadata(id:string,details:LibraryMetadata,expected:{version:number;metadataRevision?:number}):Promise<ModelAssetSummary>{
 const metadata=normalizeLibraryMetadata(details,'asset'),db=await openModelAssetDatabase();
 return new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite'),items=tx.objectStore('items'),r=items.get(id);let result:ModelAssetSummary,conflict=false;
 r.onsuccess=()=>{const old=r.result as ModelAssetSummary|undefined;if(!old||old.version!==expected.version||(old.metadataRevision??0)!==(expected.metadataRevision??0)){conflict=true;tx.abort();return;}result={...old,...metadata,category:metadata.category!,metadataRevision:(old.metadataRevision??0)+1};items.put(result);};
 tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(Error(conflict?'资产信息已在其他页面更新，请关闭后重新打开信息编辑':'资产信息保存失败，原有信息未改动'));};tx.onerror=()=>{};
 });
}

/** Refresh only the catalog's derived preview. Immutable model versions remain intact. */
export async function updateAssetThumbnail(id:string,expectedVersion:number,thumbnail:string):Promise<ModelAssetSummary>{
 if(!isThumbnailImage(thumbnail))throw Error('预览图无效或过大');
 const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{let result:ModelAssetSummary;let conflict=false;
 const tx=db.transaction('items','readwrite'),items=tx.objectStore('items'),r=items.get(id);
 r.onsuccess=()=>{const head=r.result as ModelAssetSummary|undefined;if(!head||head.version!==expectedVersion){conflict=true;tx.abort();return;}result={...head,thumbnail};items.put(result);};
 tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(Error(conflict?'资产版本已变化，请重新打开详情后更新预览':'预览更新失败，原图与模型均保留'));};tx.onerror=()=>{};
 });
}

/** Atomic catalog-only category move with optimistic concurrency checks. */
export async function moveModelAssetsToCategory(expected:Array<Pick<ModelAssetSummary,'id'|'version'|'metadataRevision'>>,category:string):Promise<ModelAssetSummary[]>{
 if(!expected.length||expected.length>500||new Set(expected.map(x=>x.id)).size!==expected.length||!validCategory(category))throw Error('请选择资产和有效目标分类');
 const db=await openModelAssetDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(['items','categories'],'readwrite'),store=tx.objectStore('items');let error='';const changed:ModelAssetSummary[]=[];
 const target=tx.objectStore('categories').get(category);target.onsuccess=()=>{if(!target.result&&!ASSET_CATEGORIES.includes(category as typeof ASSET_CATEGORIES[number])){error='目标分类不存在，请刷新分类';tx.abort();return;}
 for(const e of expected){const r=store.get(e.id);r.onsuccess=()=>{const old=r.result as ModelAssetSummary|undefined;if(!old||old.version!==e.version||(old.metadataRevision??0)!==(e.metadataRevision??0)){error='选中资产已变化，未移动任何资产，请刷新重选';tx.abort();return;}const updated={...old,category,metadataRevision:(old.metadataRevision??0)+1};changed.push(updated);store.put(updated);};}};
 tx.oncomplete=()=>{db.close();resolve(changed);};tx.onabort=()=>{db.close();reject(Error(error||'批量移动失败，原分类均保留'));};tx.onerror=()=>{};
 });
}
