import {createReadStream,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fail,loadManifest} from './dashboard-files.mjs';
import {screenshotPng} from './dashboard-screenshot.mjs';

export function openDashboardScreenshots(db,root,{admin,versionRow}){
 mkdirSync(join(root,'screenshots'),{recursive:true,mode:0o700});
 db.exec(`CREATE TABLE IF NOT EXISTS dashboard_package_hashes(item TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(item,version),FOREIGN KEY(item,version) REFERENCES dashboard_versions(item,version));
 CREATE TABLE IF NOT EXISTS dashboard_screenshots(id TEXT PRIMARY KEY,item TEXT NOT NULL,version INTEGER NOT NULL,package_hash TEXT NOT NULL,sha256 TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,source TEXT NOT NULL,captured TEXT NOT NULL,confirmed_by TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,FOREIGN KEY(item,version) REFERENCES dashboard_versions(item,version));
 CREATE TABLE IF NOT EXISTS dashboard_screenshot_bindings(item TEXT NOT NULL,version INTEGER NOT NULL,screenshot TEXT NOT NULL REFERENCES dashboard_screenshots(id),PRIMARY KEY(item,version),FOREIGN KEY(item,version) REFERENCES dashboard_versions(item,version));`);
 const hashRow=(id,version)=>db.prepare('SELECT hash FROM dashboard_package_hashes WHERE item=? AND version=?').get(id,version)?.hash;
 function current(id,version){
  const row=db.prepare(`SELECT s.* FROM dashboard_screenshot_bindings b JOIN dashboard_screenshots s ON s.id=b.screenshot JOIN dashboard_package_hashes h ON h.item=b.item AND h.version=b.version AND h.hash=s.package_hash WHERE b.item=? AND b.version=? AND s.item=b.item AND s.version=b.version`).get(id,version);
  return row?{id:row.id,templateId:row.item,version:row.version,packageHash:row.package_hash,sha256:row.sha256,width:row.width,height:row.height,bytes:row.bytes,source:row.source,capturedAt:row.captured,confirmedBy:row.confirmed_by,created:row.created,provenance:'admin-confirmed-local-render'}:undefined;
 }
 function metadata(row){return {...row,packageHash:hashRow(row.id,row.version),screenshot:current(row.id,row.version)};}
 async function info(user,id,version){
  const row=versionRow(user,id,version);let packageHash=hashRow(id,version);
  if(!packageHash){
   // Legacy versions stay immutable. Fingerprint the preserved source, never infer an image.
   const directory=join(root,'versions',row.manifest),manifest=loadManifest(directory);
   const files=manifest.sourceKind==='file'?[{path:manifest.fileName,storage:manifest.source,bytes:manifest.bytes}]:manifest.files;
   const hashes=[];
   for(const file of [...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){const hash=createHash('sha256');for await(const chunk of createReadStream(join(directory,file.storage)))hash.update(chunk);hashes.push({path:file.path,size:file.bytes,sha256:hash.digest('hex')});}
   packageHash=createHash('sha256').update(JSON.stringify({entry:row.entry,sourceKind:row.sourceKind,fileName:row.fileName,files:hashes})).digest('hex');
   db.prepare('INSERT OR IGNORE INTO dashboard_package_hashes VALUES(?,?,?)').run(id,version,packageHash);
   packageHash=hashRow(id,version);
  }
  return {templateId:id,version,packageHash,screenshot:current(id,version)};
 }
 async function bind(user,id,version,body){
  admin(user);versionRow(user,id,version);
  if(!body||Object.keys(body).some(key=>!['packageHash','expectedScreenshotId','base64','source','capturedAt','confirmed'].includes(key))||!/^[a-f0-9]{64}$/.test(body.packageHash)||!(body.expectedScreenshotId===null||typeof body.expectedScreenshotId==='string')||body.confirmed!==true||typeof body.source!=='string'||!body.source.trim()||body.source.length>1000||/[\u0000-\u001f\u007f-\u009f]/.test(body.source)||typeof body.capturedAt!=='string'||!Number.isFinite(Date.parse(body.capturedAt))||Date.parse(body.capturedAt)>Date.now()+300000)fail(400,'请填写实际渲染来源、拍摄时间并明确确认固定版本');
  const identity=await info(user,id,version);
  if(identity.packageHash!==body.packageHash)fail(409,'截图包内容 hash 不匹配');
  const image=screenshotPng(body.base64),screenshotId=randomUUID(),path=join(root,'screenshots',screenshotId+'.png');
  writeFileSync(path,image.bytes,{mode:0o600,flag:'wx',flush:true});
  try{
   db.exec('BEGIN IMMEDIATE');
   try{
    if((current(id,version)?.id??null)!==body.expectedScreenshotId)fail(409,'截图已变更，请刷新后重试');
    db.prepare('INSERT INTO dashboard_screenshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(screenshotId,id,version,body.packageHash,image.sha256,image.width,image.height,image.bytes.length,body.source.trim(),new Date(body.capturedAt).toISOString(),user.id,new Date().toISOString());
    db.prepare('INSERT INTO dashboard_screenshot_bindings VALUES(?,?,?) ON CONFLICT(item,version) DO UPDATE SET screenshot=excluded.screenshot').run(id,version,screenshotId);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }catch(error){rmSync(path,{force:true});throw error;}
  return current(id,version);
 }
 function unbind(user,id,version,body){admin(user);versionRow(user,id,version);if(!body||typeof body.expectedScreenshotId!=='string'||Object.keys(body).some(key=>key!=='expectedScreenshotId'))fail(400,'截图解绑参数无效');const result=db.prepare('DELETE FROM dashboard_screenshot_bindings WHERE item=? AND version=? AND screenshot=?').run(id,version,body.expectedScreenshotId);if(!result.changes)fail(409,'截图已变更，请刷新后重试');return {ok:true};}
 function image(user,id,version,screenshotId){versionRow(user,id,version);const value=current(id,version);if(!value||screenshotId!==undefined&&value.id!==screenshotId)fail(404,'暂无截图');return {path:join(root,'screenshots',value.id+'.png'),bytes:value.bytes,type:'image/png',fileName:'dashboard-screenshot.png'};}
 return {metadata,info,bind,unbind,image};
}
