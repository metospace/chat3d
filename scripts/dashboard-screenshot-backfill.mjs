import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {screenshotPng} from '../server/team/dashboard-screenshot.mjs';

/** Default dry-run is entirely offline; apply is deliberately restricted to a local service. */
export async function backfillScreenshots(manifestPath,{apply=false,base,token,fetcher=fetch}={}){
 const records=JSON.parse(await readFile(manifestPath,'utf8'));
 if(!Array.isArray(records)||!records.length)throw Error('回填清单必须为非空数组');
 let origin;
 if(apply){const url=new URL(base);if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!token)throw Error('仅允许本地 HTTP 服务，且须提供 DASHBOARD_BACKFILL_TOKEN；禁止生产回填');origin=url.origin;}
 const seen=new Set(),prepared=[];
 for(const row of records){
  if(!row||typeof row.templateId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(row.templateId)||!Number.isSafeInteger(row.version)||row.version<1||!/^[a-f0-9]{64}$/.test(row.packageHash)||typeof row.screenshotFile!=='string'||typeof row.source!=='string'||!row.source.trim()||row.source.length>1000||/[\u0000-\u001f\u007f-\u009f]/.test(row.source)||!Number.isFinite(Date.parse(row.capturedAt))||Date.parse(row.capturedAt)>Date.now()+300000||row.confirmed!==true||!(row.expectedScreenshotId===null||typeof row.expectedScreenshotId==='string'))throw Error('每条记录须明确 ID、版本、包 hash、图片路径、来源、拍摄时间、confirmed:true、expectedScreenshotId');
  const key=row.templateId+'/'+row.version;if(seen.has(key))throw Error('重复版本：'+key);seen.add(key);
  const bytes=await readFile(resolve(dirname(manifestPath),row.screenshotFile)),image=screenshotPng(bytes.toString('base64'));
  prepared.push({row,image,base64:bytes.toString('base64')});
 }
 const results=[];
 for(const {row,image,base64} of prepared){
  const report={templateId:row.templateId,version:row.version,packageHash:row.packageHash,width:image.width,height:image.height,screenshotSha256:image.sha256,action:apply?'bound':'dry-run (未联网、未写库，包 hash 仅为清单声明)'};
  if(apply){
   const path=`${origin}/api/team/dashboards/${row.templateId}/${row.version}/screenshot`,headers={Authorization:'Bearer '+token};
   const response=await fetcher(path+'/info',{headers,redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('读取本地版本失败：HTTP '+response.status);const identity=await response.json();
   if(identity.templateId!==row.templateId||identity.version!==row.version||identity.packageHash!==row.packageHash||(identity.screenshot?.id??null)!==row.expectedScreenshotId)throw Error('本地固定版本或现有绑定与清单不匹配：'+row.templateId);
   const saved=await fetcher(path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({packageHash:row.packageHash,expectedScreenshotId:row.expectedScreenshotId,base64,source:row.source,capturedAt:row.capturedAt,confirmed:true}),redirect:'error',signal:AbortSignal.timeout(60000)});
   if(!saved.ok)throw Error('本地截图绑定失败：HTTP '+saved.status+' '+await saved.text());
   report.screenshotId=(await saved.json()).id;
  }
  results.push(report);
 }
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2),apply=args.includes('--apply'),manifest=args.find(arg=>!arg.startsWith('--'));
  if(!manifest||args.some(arg=>arg.startsWith('--')&&!['--apply','--dry-run'].includes(arg))||apply&&args.includes('--dry-run'))throw Error('用法：node scripts/dashboard-screenshot-backfill.mjs 清单.json [--dry-run | --apply]');
  console.log(JSON.stringify(await backfillScreenshots(resolve(manifest),{apply,base:process.env.DASHBOARD_BACKFILL_BASE,token:process.env.DASHBOARD_BACKFILL_TOKEN}),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
