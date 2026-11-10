import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,rmSync,createReadStream,linkSync} from 'node:fs';
import {open,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fail,safePath,pathIndex,extension,extractZip,validateHtml,migratePackage,loadManifest,folderZip,contentType} from './dashboard-files.mjs';

const admin=user=>{if(!user?.id)fail(401,'请重新登录团队服务');if(user.role!=='admin')fail(403,'只有管理员可以管理看板');};
const member=user=>{if(!user?.id)fail(401,'请重新登录团队服务');};
const metadata=row=>({...row,archived:!!row.archived});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const controls=/[\u0000-\u001f\u007f-\u009f]/;
const versionsSchema=`CREATE TABLE dashboard_versions(item TEXT NOT NULL REFERENCES dashboard_items(id),version INTEGER NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,system TEXT NOT NULL,created TEXT NOT NULL,manifest TEXT NOT NULL,file_name TEXT NOT NULL,entry TEXT NOT NULL,source_kind TEXT NOT NULL,bytes INTEGER NOT NULL,file_count INTEGER NOT NULL,PRIMARY KEY(item,version));`;

/** Back up the SQLite database AND this content root together while the service is stopped. */
export function openDashboardStore(db,root){
 if(typeof root!=='string'||!root)throw new Error('Dashboard content root is required');
 mkdirSync(root,{recursive:true,mode:0o700});mkdirSync(join(root,'uploads'),{recursive:true,mode:0o700});mkdirSync(join(root,'versions'),{recursive:true,mode:0o700});
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 db.exec(`CREATE TABLE IF NOT EXISTS dashboard_items(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),head INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)));
 CREATE TABLE IF NOT EXISTS dashboard_requests(user TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));`);
 const oldColumns=db.prepare('PRAGMA table_info(dashboard_versions)').all();
 if(oldColumns.some(column=>column.name==='package')){
  const staged=[];
  try{
   const rows=[];
   for(const row of db.prepare('SELECT * FROM dashboard_versions ORDER BY item,version').iterate()){
    const ref=randomUUID(),directory=join(root,'versions',ref);staged.push(directory);
    const manifest=migratePackage(JSON.parse(row.package),directory);delete row.package;
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest),{mode:0o600,flush:true});row.disk={ref,manifest};rows.push(row);
   }
   transaction(()=>{
    db.exec('DROP TRIGGER IF EXISTS dashboard_versions_no_update; DROP TRIGGER IF EXISTS dashboard_versions_no_delete; ALTER TABLE dashboard_versions RENAME TO dashboard_versions_legacy;');
    db.exec(versionsSchema);
    const insert=db.prepare('INSERT INTO dashboard_versions(item,version,name,description,system,created,manifest,file_name,entry,source_kind,bytes,file_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const row of rows){const {ref,manifest}=row.disk;insert.run(row.item,row.version,row.name,row.description,row.system,row.created,ref,row.file_name,row.entry,manifest.sourceKind,manifest.bytes,manifest.fileCount);}
    db.exec('DROP TABLE dashboard_versions_legacy');
   });
  }catch(error){for(const directory of staged)rmSync(directory,{recursive:true,force:true});throw error;}
 }else if(!oldColumns.length)db.exec(versionsSchema);
 db.exec(`CREATE TRIGGER IF NOT EXISTS dashboard_versions_no_update BEFORE UPDATE ON dashboard_versions BEGIN SELECT RAISE(ABORT,'Dashboard versions are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS dashboard_versions_no_delete BEFORE DELETE ON dashboard_versions BEGIN SELECT RAISE(ABORT,'Dashboard versions are immutable'); END;
 CREATE TABLE IF NOT EXISTS dashboard_uploads(id TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),key TEXT NOT NULL,metadata TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created TEXT NOT NULL,UNIQUE(user,key));
 CREATE TABLE IF NOT EXISTS dashboard_upload_files(id TEXT PRIMARY KEY,upload TEXT NOT NULL REFERENCES dashboard_uploads(id),path TEXT NOT NULL,size INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,UNIQUE(upload,path));
 UPDATE dashboard_uploads SET state='active' WHERE state='processing';`);
 const columns='i.id,i.owner,i.archived,v.version,v.name,v.description,v.system,v.created,v.file_name AS fileName,v.entry,v.source_kind AS sourceKind,v.bytes,v.file_count AS fileCount';
 const busy=new Map(),controllers=new Map();
 function owned(user,id){admin(user);const upload=db.prepare('SELECT * FROM dashboard_uploads WHERE id=? AND user=?').get(id,user.id);if(!upload)fail(404,'上传任务不存在');return upload;}
 function active(upload){if(upload.state!=='active')fail(409,'上传任务已完成、取消或正在处理');}
 async function exclusive(id,fn){
  if(busy.has(id))fail(409,'上传任务正在写入，请稍后重试');
  let release;const done=new Promise(resolve=>{release=resolve;});busy.set(id,done);
  try{return await fn();}finally{busy.delete(id);release();}
 }
 function list(user,{all=false}={}){member(user);return db.prepare(`SELECT ${columns} FROM dashboard_items i JOIN dashboard_versions v ON v.item=i.id AND v.version=i.head WHERE i.archived=0 OR ?=1 ORDER BY v.created DESC,i.id`).all(user.role==='admin'&&all?1:0).map(metadata);}
 function versionRow(user,id,version){member(user);if(typeof id!=='string'||!Number.isSafeInteger(version)||version<1)fail(400,'看板版本无效');const row=db.prepare(`SELECT ${columns},v.manifest FROM dashboard_items i JOIN dashboard_versions v ON v.item=i.id WHERE i.id=? AND v.version=?`).get(id,version);if(!row)fail(404,'找不到看板发布版本');return row;}
 function read(user,id,version){const {manifest:ref,...row}=versionRow(user,id,version);const manifest=loadManifest(join(root,'versions',ref));return {...metadata(row),files:manifest.files.map(({path,bytes})=>({path,bytes}))};}
 function validateMetadata(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['name','description','system','entry','itemId','expectedVersion','key','sourceKind','fileName'].includes(key)))fail(400,'看板发布信息无效');
  const {name,description='',system,entry,itemId,expectedVersion,key,sourceKind,fileName}=body;
  if(typeof name!=='string'||!name.trim()||name.length>80||controls.test(name)||typeof description!=='string'||description.length>2000||typeof system!=='string'||!system.trim()||system.trim().length>80||controls.test(system)||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||itemId!==undefined&&(typeof itemId!=='string'||!itemId||itemId.length>80)||!['file','folder'].includes(sourceKind))fail(400,'看板发布信息无效');
  safePath(entry);if(!['html','htm'].includes(extension(entry)))fail(400,'看板入口必须是 HTML');
  safePath(fileName,{directory:sourceKind==='folder',source:true});if(fileName.includes('/'))fail(400,'看板原包文件名无效');
  if(sourceKind==='file'&&!['html','htm','zip'].includes(extension(fileName)))fail(400,'只接受 HTML 文件或静态 ZIP');
  if(sourceKind==='file'&&extension(fileName)!=='zip'&&entry!==fileName)fail(400,'HTML 原包入口必须与文件名相同');
  return {name:name.trim(),description,system:system.trim(),entry,...(itemId===undefined?{}:{itemId}),expectedVersion,key,sourceKind,fileName};
 }
 function createUpload(user,body){
  admin(user);const meta=validateMetadata(body),serialized=JSON.stringify(meta);
  const previous=db.prepare('SELECT id,metadata,state,result FROM dashboard_uploads WHERE user=? AND key=?').get(user.id,meta.key);
  if(previous){if(previous.metadata!==serialized||previous.state==='cancelled')fail(409,'重试标识已用于其他内容或已取消');return {uploadId:previous.id,...(previous.state==='completed'?JSON.parse(previous.result):{})};}
  if(db.prepare('SELECT 1 FROM dashboard_requests WHERE user=? AND key=?').get(user.id,meta.key))fail(409,'重试标识已用于已发布内容');
  const id=randomUUID();mkdirSync(join(root,'uploads',id),{mode:0o700});
  try{db.prepare('INSERT INTO dashboard_uploads(id,user,key,metadata,state,created) VALUES(?,?,?,?,?,?)').run(id,user.id,meta.key,serialized,'active',new Date().toISOString());}catch(error){rmSync(join(root,'uploads',id),{recursive:true,force:true});throw error;}
  return {uploadId:id};
 }
 async function registerFile(user,id,body){
  owned(user,id);return exclusive(id,async()=>{
   const upload=owned(user,id);active(upload);const meta=JSON.parse(upload.metadata);
   if(!body||Object.keys(body).some(key=>!['path','size'].includes(key))||!Number.isSafeInteger(body.size)||body.size<0)fail(400,'上传文件信息无效');
   const path=safePath(body.path,{source:meta.sourceKind==='file'});
   if(meta.sourceKind==='file'&&path!==meta.fileName)fail(400,'原包文件名不匹配');
   const files=db.prepare('SELECT * FROM dashboard_upload_files WHERE upload=?').all(id),existing=files.find(file=>file.path===path);
   if(existing){if(existing.size!==body.size)fail(409,'文件声明大小不一致');return {fileId:existing.id,offset:existing.offset};}
   if(meta.sourceKind==='file'&&files.length)fail(400,'原包只能包含一个上传文件');
   const index=pathIndex();for(const file of files)index(file.path);index(path);
   const fileId=randomUUID(),handle=await open(join(root,'uploads',id,fileId),'wx',0o600);await handle.close();
   active(owned(user,id));db.prepare('INSERT INTO dashboard_upload_files(id,upload,path,size) VALUES(?,?,?,?)').run(fileId,id,path,body.size);return {fileId,offset:0};
  });
 }
 async function writeChunk(user,id,fileId,body){
  owned(user,id);return exclusive(id,async()=>{
   active(owned(user,id));
   if(!body||Object.keys(body).some(key=>!['offset','base64'].includes(key))||!Number.isSafeInteger(body.offset)||body.offset<0||typeof body.base64!=='string'||!body.base64.length||body.base64.length>Math.ceil(1048576/3)*4||body.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64))fail(400,'上传分块无效');
   const bytes=Buffer.from(body.base64,'base64');if(!bytes.length||bytes.length>1048576||bytes.toString('base64')!==body.base64)fail(400,'上传分块不能超过 1 MiB，且必须使用规范 Base64');
   const file=db.prepare('SELECT * FROM dashboard_upload_files WHERE id=? AND upload=?').get(fileId,id);if(!file)fail(404,'上传文件不存在');
   if(file.offset!==body.offset)fail(409,'上传偏移不匹配，请重新获取文件偏移');if(bytes.length>file.size-file.offset)fail(400,'上传内容超过文件声明大小');
   const handle=await open(join(root,'uploads',id,file.id),'r+');
   try{await handle.truncate(file.offset);let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,file.offset+written);if(!result.bytesWritten)throw new Error('File write made no progress');written+=result.bytesWritten;}await handle.sync();}finally{await handle.close();}
   active(owned(user,id));const offset=file.offset+bytes.length;
   db.prepare('UPDATE dashboard_upload_files SET offset=? WHERE id=? AND offset=?').run(offset,file.id,file.offset);return {offset};
  });
 }
 async function completeUpload(user,id){
  const initial=owned(user,id);if(initial.state==='completed')return JSON.parse(initial.result);
  return exclusive(id,async()=>{
   const upload=owned(user,id);if(upload.state==='completed')return JSON.parse(upload.result);active(upload);
   const meta=JSON.parse(upload.metadata),files=db.prepare('SELECT * FROM dashboard_upload_files WHERE upload=? ORDER BY path').all(id);
   if(!files.length||files.some(file=>file.size!==file.offset))fail(409,'上传文件尚未完整接收');
   if(meta.sourceKind==='file'&&(files.length!==1||files[0].path!==meta.fileName))fail(400,'原包文件不匹配');
   db.prepare("UPDATE dashboard_uploads SET state='processing' WHERE id=?").run(id);
   const controller=new AbortController();controllers.set(id,controller);const sourceDirectory=join(root,'uploads',id),ref=randomUUID(),directory=join(root,'versions',ref);let committed=false;
   try{
    await mkdir(directory,{mode:0o700});let content,source;
    if(meta.sourceKind==='file'){
     source='source';linkSync(join(sourceDirectory,files[0].id),join(directory,source));
     if(extension(meta.fileName)==='zip')content=await extractZip(join(directory,source),directory,meta.entry,controller.signal);
     else{await validateHtml(join(directory,source),controller.signal);content=[{path:meta.fileName,bytes:files[0].size,storage:source}];}
    }else{
     if(!files.some(file=>file.path===meta.entry))fail(400,'找不到指定 HTML 入口');
     await validateHtml(join(sourceDirectory,files.find(file=>file.path===meta.entry).id),controller.signal);
     content=files.map(file=>({path:file.path,bytes:file.size,storage:file.id}));
     for(const file of files){if(controller.signal.aborted)fail(409,'上传已取消');linkSync(join(sourceDirectory,file.id),join(directory,file.id));}
    }
    const hashes=[];for(const file of files){const hash=createHash('sha256'),path=meta.sourceKind==='file'?join(directory,source):join(directory,file.id);for await(const chunk of createReadStream(path,{signal:controller.signal}))hash.update(chunk);hashes.push({path:file.path,size:file.size,sha256:hash.digest('hex')});}
    const bytes=files.reduce((sum,file)=>sum+file.size,0);if(!Number.isSafeInteger(bytes))fail(400,'上传总大小超过安全整数范围');
    const manifest={sourceKind:meta.sourceKind,fileName:meta.fileName,entry:meta.entry,bytes,fileCount:content.length,files:content,...(source?{source}:{})};
    writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx',flush:true});
    const requestDigest=digest({metadata:meta,files:hashes});
    const result=transaction(()=>{
     if(owned(user,id).state!=='processing'||controller.signal.aborted)fail(409,'上传已取消');
     const previous=db.prepare('SELECT digest,result FROM dashboard_requests WHERE user=? AND key=?').get(user.id,meta.key);
     if(previous){if(previous.digest!==requestDigest)fail(409,'重试标识已用于其他内容');return JSON.parse(previous.result);}
     const item=meta.itemId===undefined?null:db.prepare('SELECT id,head FROM dashboard_items WHERE id=?').get(meta.itemId);
     if(meta.itemId!==undefined&&!item)fail(404,'看板原件不存在');if(item?item.head!==meta.expectedVersion:meta.expectedVersion!==0)fail(409,'看板已有新版本，请刷新后重试');
     const itemId=item?.id??randomUUID(),version=(item?.head??0)+1;
     if(item)db.prepare('UPDATE dashboard_items SET head=? WHERE id=?').run(version,itemId);else db.prepare('INSERT INTO dashboard_items(id,owner,head) VALUES(?,?,?)').run(itemId,user.id,version);
     db.prepare('INSERT INTO dashboard_versions(item,version,name,description,system,created,manifest,file_name,entry,source_kind,bytes,file_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(itemId,version,meta.name,meta.description,meta.system,new Date().toISOString(),ref,meta.fileName,meta.entry,meta.sourceKind,bytes,content.length);
     const published={id:itemId,version};db.prepare('INSERT INTO dashboard_requests(user,key,digest,result) VALUES(?,?,?,?)').run(user.id,meta.key,requestDigest,JSON.stringify(published));
     db.prepare("UPDATE dashboard_uploads SET state='completed',result=? WHERE id=?").run(JSON.stringify(published),id);return published;
    });
    committed=true;await rm(sourceDirectory,{recursive:true,force:true});return result;
   }catch(error){
    // Staging links remain intact on validation or version conflicts.
    if(!committed&&owned(user,id).state!=='cancelled'){
     db.prepare("UPDATE dashboard_uploads SET state='active' WHERE id=? AND state='processing'").run(id);
    }
    throw error;
   }finally{controllers.delete(id);if(!committed)await rm(directory,{recursive:true,force:true});}
  });
 }
 async function cancelUpload(user,id){
  const upload=owned(user,id);if(upload.state==='completed')fail(409,'已发布的上传不能取消');
  db.prepare("UPDATE dashboard_uploads SET state='cancelled' WHERE id=?").run(id);controllers.get(id)?.abort();const pending=busy.get(id);if(pending)await pending;
  await rm(join(root,'uploads',id),{recursive:true,force:true});return {ok:true};
 }
 function file(user,id,version,path){
  const row=versionRow(user,id,version),directory=join(root,'versions',row.manifest),manifest=loadManifest(directory);
  const found=manifest.files.find(file=>file.path===path);if(!found)fail(404,'看板资源不存在');
  return {path:join(directory,found.storage),bytes:found.bytes,type:contentType(found.path),fileName:found.path.split('/').at(-1)};
 }
 function thumbnail(user,id,version){
  const row=versionRow(user,id,version),directory=join(root,'versions',row.manifest),manifest=loadManifest(directory);
  let selected,preferred=false;
  for(const file of manifest.files){
   if(!/\.(png|jpe?g|webp|gif)$/i.test(file.path))continue;
   const candidatePreferred=/thumbnail|preview|cover|poster|reference-full/i.test(file.path);
   if(!selected||(candidatePreferred&&!preferred)||(candidatePreferred===preferred&&(file.bytes>selected.bytes||(file.bytes===selected.bytes&&file.path<selected.path)))){selected=file;preferred=candidatePreferred;}
  }
  if(!selected)fail(404,'看板缩略图不存在');
  return {path:join(directory,selected.storage),bytes:selected.bytes,type:contentType(selected.path),fileName:selected.path.split('/').at(-1)};
 }
 async function source(user,id,version){
  const row=versionRow(user,id,version),directory=join(root,'versions',row.manifest),manifest=loadManifest(directory);
  if(manifest.sourceKind==='file')return {path:join(directory,manifest.source),bytes:manifest.bytes,type:extension(manifest.fileName)==='zip'?'application/zip':contentType(manifest.fileName),fileName:manifest.fileName};
  const path=join(root,'uploads',`export-${randomUUID()}.zip`);
  try{const bytes=await folderZip(directory,manifest,path);return {path,bytes,type:'application/zip',fileName:/\.zip$/i.test(manifest.fileName)?manifest.fileName:`${manifest.fileName}.zip`,cleanup:()=>rm(path,{force:true})};}catch(error){await rm(path,{force:true});throw error;}
 }
 function archive(user,id,archived){admin(user);if(typeof id!=='string'||typeof archived!=='boolean')fail(400,'看板归档参数无效');return transaction(()=>{const result=db.prepare('UPDATE dashboard_items SET archived=? WHERE id=?').run(archived?1:0,id);if(!result.changes)fail(404,'看板原件不存在');return {id,archived};});}
 return {list,read,createUpload,registerFile,writeChunk,completeUpload,cancelUpload,file,thumbnail,source,archive};
}
