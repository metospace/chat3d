import type {TeamClient,TeamItem} from '../domain/teamLibrary';
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
