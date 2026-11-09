import {dashboardPath} from '../../shared/dashboard-package.mjs';
import type {TeamClient} from './teamLibrary';
export interface DashboardSelection {kind:'file'|'folder';name:string;files:{file:File;path:string}[];entries:string[];totalBytes:number}
export interface DashboardUploadProgress {phase:'uploading'|'processing';loaded:number;total:number;fileName:string}
export interface DashboardUploadMetadata {name:string;description:string;system:string;entry:string;itemId?:string;expectedVersion:number;key:string}
const CHUNK_BYTES=1024*1024;
const utf8=new TextDecoder('utf-8',{fatal:true});
function safeNumber(value:bigint){if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('文件大小超过当前浏览器可准确处理的范围');return Number(value);}
/** Read ZIP directory only; selecting a large source never expands or buffers the archive. */
async function archiveEntries(file:File):Promise<string[]>{
 const start=Math.max(0,file.size-65557),footer=new Uint8Array(await file.slice(start).arrayBuffer()),view=new DataView(footer.buffer);let end=-1;
 for(let p=footer.length-22;p>=0;p--)if(view.getUint32(p,true)===0x06054b50&&p+22+view.getUint16(p+20,true)===footer.length){end=p;break;}
 if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('ZIP 目录无效或不支持分卷压缩包');
 let count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(count===65535||size===0xffffffff||offset===0xffffffff){const locator=end-20;if(locator<0||view.getUint32(locator,true)!==0x07064b50)throw Error('ZIP64 目录无效');const position=safeNumber(view.getBigUint64(locator+8,true));const record=new DataView(await file.slice(position,position+56).arrayBuffer());if(record.byteLength<56||record.getUint32(0,true)!==0x06064b50||record.getUint32(16,true)||record.getUint32(20,true))throw Error('ZIP64 目录无效');count=safeNumber(record.getBigUint64(32,true));size=safeNumber(record.getBigUint64(40,true));offset=safeNumber(record.getBigUint64(48,true));}
 if(!Number.isSafeInteger(offset+size)||offset+size>file.size)throw Error('ZIP 目录范围无效');
 let cursor=offset;const entries:string[]=[],paths=new Set<string>(),files=new Set<string>();
 for(let i=0;i<count;i++){
  const header=new DataView(await file.slice(cursor,cursor+46).arrayBuffer());if(header.byteLength!==46||header.getUint32(0,true)!==0x02014b50)throw Error('ZIP 文件目录不完整');
  const flags=header.getUint16(8,true),method=header.getUint16(10,true),length=header.getUint16(28,true),extra=header.getUint16(30,true),comment=header.getUint16(32,true),mode=header.getUint32(38,true)>>>16&0xf000;
  if(flags&1||![0,8].includes(method)||mode&&mode!==0x8000&&mode!==0x4000)throw Error('不支持加密、链接或非静态 ZIP 条目');
  const name=utf8.decode(await file.slice(cursor+46,cursor+46+length).arrayBuffer()),directory=name.endsWith('/'),path=dashboardPath(name,directory);if(paths.has(path))throw Error('ZIP 含重复路径：'+path);paths.add(path);if(!directory){files.add(path);if(/\.html?$/i.test(path))entries.push(path);}
  cursor+=46+length+extra+comment;if(cursor>offset+size)throw Error('ZIP 文件目录越界');
 }
 for(const path of paths){const parts=path.split('/');for(let i=1;i<parts.length;i++)if(files.has(parts.slice(0,i).join('/')))throw Error('ZIP 文件与文件夹路径冲突：'+path);}
 if(cursor!==offset+size)throw Error('ZIP 文件目录大小不一致');return entries;
}
function sortEntries(entries:string[]){return entries.sort((a,b)=>{const rank=(path:string)=>/(^|\/)(dist|build)\/index\.html?$/i.test(path)?0:/(^|\/)index\.html?$/i.test(path)?1:2;return rank(a)-rank(b)||a.split('/').length-b.split('/').length||a.localeCompare(b);});}
export async function selectDashboardFiles(input:File[],kind:'file'|'folder'):Promise<DashboardSelection>{
 if(!input.length)throw Error(kind==='folder'?'请选择包含静态大屏的文件夹':'请选择 HTML 或 ZIP 文件');
 if(kind==='file'){
  if(input.length!==1)throw Error('单文件上传请选择一个 HTML 或 ZIP；多个资源请使用选择文件夹');const file=input[0];if(!/\.(?:html?|zip)$/i.test(file.name))throw Error('请选择 HTML 或静态 ZIP 源码文件');dashboardPath(file.name.replace(/\.zip$/i,'.html'));
  const entries=/\.zip$/i.test(file.name)?await archiveEntries(file):[file.name];if(!entries.length)throw Error('压缩包中没有 HTML 入口。若这是 Vue/React 工程，请先本地构建，再将 dist/build 一起打包；平台不会执行构建脚本。');
  return {kind,name:file.name,files:[{file,path:file.name}],entries:sortEntries(entries),totalBytes:file.size};
 }
 const original=input.map(file=>({file,path:file.webkitRelativePath||file.name})),roots=new Set(original.map(({path})=>path.split('/')[0])),strip=roots.size===1&&original.every(({path})=>path.includes('/'));
 const files=original.map(({file,path})=>({file,path:strip?path.slice(path.indexOf('/')+1):path}));const paths=new Set<string>();let totalBytes=0;
 for(const {file,path} of files){dashboardPath(path);if(paths.has(path))throw Error('文件夹中存在重复路径：'+path);paths.add(path);totalBytes+=file.size;if(!Number.isSafeInteger(totalBytes))throw Error('文件总大小超过当前浏览器可准确处理的范围');}
 const entries=sortEntries(files.filter(({path})=>/\.html?$/i.test(path)).map(({path})=>path));if(!entries.length)throw Error('所选目录没有 HTML 入口。若这是 Vue/React 工程，请先本地构建，再选择包含 dist/build 的目录；平台不会执行构建脚本。');
 return {kind,name:strip?original[0].path.split('/')[0]:'看板文件夹',files:files.sort((a,b)=>a.path.localeCompare(b.path)),entries,totalBytes};
}
async function json<T>(client:TeamClient,path:string,body:unknown,signal?:AbortSignal):Promise<T>{return (await client.raw(path,body,signal)).json();}
export async function uploadDashboard(client:TeamClient,selection:DashboardSelection,metadata:DashboardUploadMetadata,onProgress:(progress:DashboardUploadProgress)=>void,signal?:AbortSignal):Promise<{id:string;version:number}>{
 if(!metadata.name.trim())throw Error('请输入模板名称');if(!metadata.system.trim())throw Error('请输入所属系统');if(!selection.entries.includes(metadata.entry))throw Error('请选择有效的 HTML 入口');
 signal?.throwIfAborted();const initialized=await json<{uploadId:string;id?:string;version?:number}>(client,'dashboards/uploads',{...metadata,name:metadata.name.trim(),system:metadata.system.trim(),sourceKind:selection.kind,fileName:selection.kind==='folder'?selection.name+'.zip':selection.name},signal);
 if(initialized.id&&initialized.version)return {id:initialized.id,version:initialized.version};const root=`dashboards/uploads/${initialized.uploadId}`;let loaded=0;
 try{
  for(const {file,path} of selection.files){signal?.throwIfAborted();const info=await json<{fileId:string;offset:number}>(client,root+'/files',{path,size:file.size},signal);let offset=info.offset;if(!Number.isSafeInteger(offset)||offset<0||offset>file.size)throw Error('服务器返回的文件进度无效');loaded+=offset;onProgress({phase:'uploading',loaded,total:selection.totalBytes,fileName:path});
   while(offset<file.size){signal?.throwIfAborted();const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK_BYTES).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const result=await json<{offset:number}>(client,`${root}/files/${info.fileId}/chunks`,{offset,base64:btoa(binary)},signal);if(result.offset!==offset+bytes.length)throw Error('服务器确认的分块位置不一致，请重试');offset=result.offset;loaded+=bytes.length;onProgress({phase:'uploading',loaded,total:selection.totalBytes,fileName:path});}
  }
  onProgress({phase:'processing',loaded,total:selection.totalBytes,fileName:metadata.entry});return await json<{id:string;version:number}>(client,root+'/complete',{},signal??new AbortController().signal);
 }catch(error){if(signal?.aborted){try{await json(client,root+'/cancel',{});}catch{/* Cancelling never claims a completed publish was undone. */}}throw error;}
}
