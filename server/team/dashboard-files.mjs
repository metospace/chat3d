import {createReadStream,createWriteStream,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {TextDecoder} from 'node:util';
import {randomUUID} from 'node:crypto';
import yauzl from 'yauzl';
import yazl from 'yazl';
import {unzipSync} from 'fflate';
import {dashboardPath,dashboardMime} from '../../shared/dashboard-package.mjs';

export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const extension=path=>path.slice(path.lastIndexOf('.')+1).toLowerCase();
export const contentType=dashboardMime;
export function safePath(value,{directory=false,source=false}={}){
 if(source&&typeof value==='string'&&/\.zip$/i.test(value)){
  dashboardPath(value.slice(0,-4)+'.html');return value;
 }
 return dashboardPath(value,directory);
}
export function pathIndex(){
 const nodes=new Map();
 return (path,directory=false)=>{
  const parts=path.toLowerCase().split('/');
  for(let i=1;i<parts.length;i++){
   const parent=parts.slice(0,i).join('/'),node=nodes.get(parent);
   if(node?.kind==='file')fail(400,'看板文件路径重叠');
   if(!node)nodes.set(parent,{kind:'directory',explicit:false});
  }
  const key=parts.join('/'),old=nodes.get(key);
  if(old&&(!directory||old.kind==='file'||old.explicit))fail(400,'看板文件路径重复或重叠');
  nodes.set(key,{kind:directory?'directory':'file',explicit:true});
 };
}
function htmlProbe(){
 const decoder=new TextDecoder('utf-8',{fatal:true});let found=false,carry='';
 const check=text=>{if(text.includes('\u0000'))fail(400,'看板入口不是有效 HTML');const source=carry+text;if(/<(?:!doctype\s+html|html|head|body|div|main|section|script|style|title|canvas|svg|h[1-6]|p)(?:\s|>)/i.test(source))found=true;carry=source.slice(-128);};
 return {push(bytes){try{check(decoder.decode(bytes,{stream:true}));}catch(error){if(error.status)throw error;fail(400,'看板文本必须为 UTF-8');}},end(){try{check(decoder.decode());}catch(error){if(error.status)throw error;fail(400,'看板文本必须为 UTF-8');}if(!found)fail(400,'看板入口不是有效 HTML');}};
}
export async function validateHtml(path,signal){
 const probe=htmlProbe();for await(const chunk of createReadStream(path,{signal})){probe.push(chunk);}probe.end();
}
const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
export async function extractZip(source,directory,entry,signal){
 const archive=await new Promise((resolve,reject)=>yauzl.open(source,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true,autoClose:true},(error,zip)=>error?reject(Object.assign(error,{status:400})):resolve(zip)));
 const files=[],index=pathIndex(),ranges=[],centralDirectoryOffset=archive.readEntryCursor;
 return new Promise((resolve,reject)=>{
  let settled=false,processing=false,activeStream,pendingError;
  const stop=error=>{if(settled)return;pendingError??=error;activeStream?.destroy(pendingError);archive.close();if(processing)return;settled=true;signal?.removeEventListener('abort',abort);reject(pendingError.status?pendingError:Object.assign(pendingError,{status:400}));};
  const abort=()=>stop(Object.assign(new Error('上传已取消'),{status:409}));
  signal?.addEventListener('abort',abort,{once:true});
  archive.on('error',stop);
  archive.on('end',()=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(!files.some(file=>file.path===entry))return reject(Object.assign(new Error('ZIP 中找不到指定 HTML 入口'),{status:400}));resolve(files);});
  archive.on('entry',async item=>{
   processing=true;
   try{
    if(signal?.aborted)throw Object.assign(new Error('上传已取消'),{status:409});
    if(item.generalPurposeBitFlag&1)fail(400,'不接受加密 ZIP');
    const mode=(item.externalFileAttributes>>>16)&0xffff,type=mode&0xf000,directoryEntry=item.fileName.endsWith('/');
    if(type&&type!==(directoryEntry?0x4000:0x8000))fail(400,'ZIP 不允许符号链接或特殊文件');
    const path=safePath(item.fileName,{directory:directoryEntry});index(path,directoryEntry);
    const local=await new Promise((resolveLocal,rejectLocal)=>archive.readLocalFileHeader(item,{minimal:true},(error,value)=>error?rejectLocal(error):resolveLocal(value)));
    const start=item.relativeOffsetOfLocalHeader,end=local.fileDataStart+item.compressedSize;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>centralDirectoryOffset||ranges.some(range=>start<range.end&&end>range.start))fail(400,'ZIP 文件数据范围重叠或无效');
    ranges.push({start,end});
    if(directoryEntry){if(item.uncompressedSize!==0)fail(400,'ZIP 目录内容无效');archive.readEntry();return;}
    if(!Number.isSafeInteger(item.uncompressedSize)||item.uncompressedSize<0)fail(400,'ZIP 文件大小无效');
    const storage=randomUUID(),stream=await new Promise((resolveStream,rejectStream)=>archive.openReadStream(item,(error,value)=>error?rejectStream(error):resolveStream(value)));
    activeStream=stream;if(pendingError){stream.destroy();throw pendingError;}
    let bytes=0,crc=0xffffffff;const probe=path===entry?htmlProbe():null;
    const counter=new Transform({transform(chunk,_encoding,done){try{bytes+=chunk.length;if(bytes>item.uncompressedSize)fail(400,'ZIP 解压大小与声明不符');for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);probe?.push(chunk);done(null,chunk);}catch(error){done(error);}}});
    await pipeline(stream,counter,createWriteStream(join(directory,storage),{flags:'wx',mode:0o600,flush:true}),{signal});
    if(bytes!==item.uncompressedSize)fail(400,'ZIP 解压大小与声明不符');if(((crc^0xffffffff)>>>0)!==(item.crc32>>>0))fail(400,'ZIP 文件校验失败');probe?.end();
    if(pendingError)throw pendingError;files.push({path,bytes,storage});archive.readEntry();
   }catch(error){stop(error);}finally{processing=false;activeStream=undefined;if(pendingError)stop(pendingError);}
  });
  if(signal?.aborted)abort();else archive.readEntry();
 });
}
export function migratePackage(pack,directory){
 mkdirSync(directory,{recursive:true,mode:0o700});
 const source=Buffer.from(pack.base64,'base64');writeFileSync(join(directory,'source'),source,{mode:0o600,flag:'wx',flush:true});
 // Immutable legacy packages were validated at publication; preserve historical paths.
 const raw=/\.zip$/i.test(pack.fileName)?unzipSync(source):{[pack.fileName]:source};
 const files=[];
 for(const [path,data] of Object.entries(raw)){
  if(path.endsWith('/'))continue;
  const storage=randomUUID();writeFileSync(join(directory,storage),data,{mode:0o600,flag:'wx',flush:true});files.push({path,bytes:data.length,storage});
  if(path===pack.entry){const probe=htmlProbe();probe.push(data);probe.end();}
 }
 if(!files.some(file=>file.path===pack.entry))fail(400,'看板入口不存在');
 return {sourceKind:'file',fileName:pack.fileName,entry:pack.entry,bytes:source.length,fileCount:files.length,files,source:'source'};
}
export async function folderZip(directory,manifest,target,signal){
 const zip=new yazl.ZipFile();
 const output=createWriteStream(target,{flags:'wx',mode:0o600});
 zip.on('error',error=>output.destroy(error));
 const transfer=pipeline(zip.outputStream,output,{signal});
 try{for(const file of manifest.files)zip.addFile(join(directory,file.storage),file.path);zip.end();await transfer;}catch(error){zip.outputStream.destroy(error);await transfer.catch(()=>{});await rm(target,{force:true});throw error;}
 return (await stat(target)).size;
}
export function loadManifest(directory){return JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));}
