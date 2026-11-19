import {TeamServiceError,type TeamClient,type TeamItem} from '../domain/teamLibrary';
import {assetDocument,parseModelAsset} from '../domain/modelAssets';
import {parseProject} from '../domain/project';
import {captureLibraryThumbnail} from './libraryThumbnail';

export type TeamThumbnail={image:string;notice?:string};
let teamPreviewQueue=Promise.resolve();

/** Keep private previews in this pane's session, never in the local resource library. */
export function createTeamPreviewLoader(client:TeamClient):TeamPreviewLoader{
 const cache=new Map<string,TeamThumbnail>();
 return (row:TeamItem,signal:AbortSignal,render=false)=>{
  const key=`${row.kind}:${row.id}:${row.version}`;
  const check=()=>{if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');};
  const pending=teamPreviewQueue.then(async()=>{
   check();
   if(!render&&cache.has(key))return cache.get(key)!;
   if(row.sourceKind==='glb'){
    let thumbnail:TeamThumbnail;
    try{
     const response=await client.raw(`items/${encodeURIComponent(row.id)}/${row.version}/thumbnail`,undefined,signal);
     const blob=await response.blob();check();
     thumbnail=blob.size?{image:await thumbnailDataUrl(blob,signal)}:{image:'',notice:'暂无缩略图'};
    }catch(error){
     check();if(!(error instanceof TeamServiceError)||error.status!==404)throw error;
     thumbnail={image:'',notice:'暂无缩略图'};
    }
    check();cache.set(key,thumbnail);return thumbnail;
   }
   const value=await client.read(row);check();
   const asset=value.kind==='asset'?parseModelAsset(JSON.stringify(value.payload)):undefined;
   const thumbnail=asset?.thumbnail&&!render?{image:asset.thumbnail}:await captureLibraryThumbnail(asset?assetDocument(asset):parseProject(JSON.stringify(value.payload)));
   check();cache.set(key,thumbnail);return thumbnail;
  });
  teamPreviewQueue=pending.then(()=>{},()=>{});
  return pending;
 };
}
export type TeamPreviewLoader=(row:TeamItem,signal:AbortSignal,render?:boolean)=>Promise<TeamThumbnail>;

function thumbnailDataUrl(blob:Blob,signal:AbortSignal):Promise<string>{
 signal.throwIfAborted();
 const reader=new FileReader(),{promise,resolve,reject}=Promise.withResolvers<string>();
 const abort=()=>reader.abort();
 reader.onload=()=>resolve(String(reader.result));
 reader.onerror=()=>reject(Error('团队缩略图读取失败'));
 reader.onabort=()=>reject(new DOMException('Preview cancelled','AbortError'));
 signal.addEventListener('abort',abort,{once:true});
 reader.readAsDataURL(blob);
 return promise.finally(()=>signal.removeEventListener('abort',abort));
}
