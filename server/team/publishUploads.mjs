import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,closeSync,readSync,writeSync,fstatSync,ftruncateSync,fsyncSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';

export const TEAM_UPLOAD_CHUNK_BYTES=1024*1024;
export const TEAM_UPLOAD_MAX_BYTES=500*1024*1024;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const keyPattern=/^[a-zA-Z0-9-]{16,80}$/;
const digestPattern=/^[0-9a-f]{64}$/;
const writable=user=>{if(!['admin','member'].includes(user.role))fail(403,'只读成员不能发布');};
const chunkDigest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Temporary bytes live beside the database, never in a source/model directory.
 * The durable offset is advanced only after fsync; unconfirmed trailing bytes are
 * truncated on the next write. Completed metadata retains the key/content binding.
 */
export function openPublicationUploads(db,root){
 mkdirSync(root,{recursive:true,mode:0o700});
 db.exec(`CREATE TABLE IF NOT EXISTS publish_uploads(id TEXT PRIMARY KEY,user TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,total INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,result TEXT,UNIQUE(user,key));`);
 if(!db.prepare('PRAGMA table_info(publish_uploads)').all().some(column=>column.name==='encoding'))db.exec("ALTER TABLE publish_uploads ADD COLUMN encoding TEXT NOT NULL DEFAULT 'json'");
 const file=row=>join(root,row.id+'.part');
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const owned=(user,id)=>{writable(user);const row=db.prepare('SELECT * FROM publish_uploads WHERE id=? AND user=?').get(id,user.id);if(!row)fail(404,'找不到此发布上传');return row;};
 const status=row=>({uploadId:row.id,offset:row.offset,total:row.total,encoding:row.encoding,...(row.result?{result:JSON.parse(row.result)}:{})});
 const cleanup=row=>{try{rmSync(file(row),{force:true});}catch{/* A durable result remains retryable even if temporary-file cleanup fails. */}};
 function start(user,body){
  writable(user);
  const encoding=body.encoding??'json';
  if(!['json','gzip'].includes(encoding)||!keyPattern.test(body.key??'')||typeof body.key!=='string'||!digestPattern.test(body.digest??'')||typeof body.digest!=='string'||!Number.isSafeInteger(body.total)||body.total<1||body.total>TEAM_UPLOAD_MAX_BYTES)fail(400,'发布上传信息无效或超过 500 MiB');
  return transaction(()=>{
   let row=db.prepare('SELECT * FROM publish_uploads WHERE user=? AND key=?').get(user.id,body.key);
   if(row){if(row.total!==body.total||row.digest!==body.digest||row.encoding!==encoding)fail(409,'重试标识已用于其他内容');if(row.result)cleanup(row);return status(row);}
   row={id:randomUUID(),user:user.id,key:body.key,digest:body.digest,total:body.total,offset:0,encoding};
   db.prepare('INSERT INTO publish_uploads(id,user,key,digest,total,offset,encoding) VALUES(?,?,?,?,?,0,?)').run(row.id,row.user,row.key,row.digest,row.total,row.encoding);return status(row);
  });
 }
 function chunk(user,id,body){
  if(!Number.isSafeInteger(body.offset)||body.offset<0||typeof body.data!=='string'||!body.data.length||body.data.length>4*Math.ceil(TEAM_UPLOAD_CHUNK_BYTES/3)||body.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(body.data))fail(400,'上传分块编码或偏移无效');
  const bytes=Buffer.from(body.data,'base64');if(!bytes.length||bytes.length>TEAM_UPLOAD_CHUNK_BYTES||bytes.toString('base64')!==body.data)fail(400,'上传分块编码无效');
  return transaction(()=>{
   const row=owned(user,id),end=body.offset+bytes.length;
   if(body.offset%TEAM_UPLOAD_CHUNK_BYTES!==0||end>row.total||bytes.length!==Math.min(TEAM_UPLOAD_CHUNK_BYTES,row.total-body.offset))fail(400,'上传分块大小或范围无效');
   if(body.offset>row.offset||body.offset<row.offset&&end>row.offset)fail(409,'上传偏移与已确认位置不一致');
   if(row.result)fail(409,'发布上传已经完成，请重新查询上传状态');
   let fd;try{
    fd=openSync(file(row),row.offset===0?'w+':'r+',0o600);
    if(fstatSync(fd).size<row.offset)throw Error('Confirmed publication upload bytes are missing');
    if(body.offset<row.offset){const previous=Buffer.allocUnsafe(bytes.length);let read=0;while(read<previous.length){const n=readSync(fd,previous,read,previous.length-read,body.offset+read);if(!n)throw Error('Publication upload ended unexpectedly');read+=n;}if(!previous.equals(bytes))fail(409,'重试分块内容与已确认内容不同');return status(row);}
    ftruncateSync(fd,row.offset);let written=0;while(written<bytes.length){const count=writeSync(fd,bytes,written,bytes.length-written,row.offset+written);if(!count)throw Error('Publication upload storage made no progress');written+=count;}fsyncSync(fd);
    db.prepare('UPDATE publish_uploads SET offset=? WHERE id=?').run(end,row.id);row.offset=end;return status(row);
   }finally{if(fd!==undefined)closeSync(fd);}
  });
 }
 async function complete(user,id,publish){
  const row=owned(user,id);if(row.result){cleanup(row);return JSON.parse(row.result);}
  if(row.offset!==row.total)fail(409,'发布上传尚未完成');
  const bytes=readFileSync(file(row));if(bytes.length!==row.total)throw Error('Confirmed publication upload byte length is invalid');
  // This fingerprint is SHA-256 of the ordered, lowercase SHA-256 chunk hex strings.
  const digest=createHash('sha256');for(let offset=0;offset<row.total;offset+=TEAM_UPLOAD_CHUNK_BYTES)digest.update(chunkDigest(bytes.subarray(offset,Math.min(offset+TEAM_UPLOAD_CHUNK_BYTES,row.total))));
  if(digest.digest('hex')!==row.digest)fail(409,'上传内容校验失败，请保留原发布项重试');
  let expanded=bytes;
  if(row.encoding==='gzip')try{expanded=gunzipSync(bytes,{maxOutputLength:TEAM_UPLOAD_MAX_BYTES});}catch(error){if(error.code==='ERR_BUFFER_TOO_LARGE')fail(400,'发布上传解压后超过 500 MiB');fail(400,'发布上传 gzip 压缩包损坏或无效');}
  else if(row.encoding!=='json')fail(400,'发布上传编码无效');
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(expanded));}catch{fail(400,'发布上传不是有效 UTF-8 JSON');}
  if(!body||typeof body!=='object'||Array.isArray(body)||body.key!==row.key)fail(400,'发布上传重试标识不匹配');
  const result=await publish(body);
  // If this update fails after publish commits, the original request-key table
  // returns exactly the same result when complete is explicitly retried.
  db.prepare('UPDATE publish_uploads SET result=? WHERE id=?').run(JSON.stringify(result),row.id);
  cleanup(row);return result;
 }
 return {start,chunk,complete};
}
