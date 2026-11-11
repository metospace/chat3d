import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encode} from 'fast-png';
import {backfillScreenshots} from '../scripts/dashboard-screenshot-backfill.mjs';
const dir=await mkdtemp(join(tmpdir(),'dashboard-backfill-'));
try{
 const pixels=new Uint8Array(320*180*4);pixels.fill(190);const png=encode({width:320,height:180,data:pixels,channels:4,depth:8});await writeFile(join(dir,'shot.png'),png);
 const rows=Array.from({length:6},(_,index)=>({templateId:'historical-'+index,version:1,packageHash:'a'.repeat(64),screenshotFile:'shot.png',source:'受控桌面实际渲染，人工核对固定版本',capturedAt:'2026-11-10T12:00:00Z',confirmed:true,expectedScreenshotId:null}));const path=join(dir,'manifest.json');await writeFile(path,JSON.stringify(rows));
 const original=await readFile(path),results=await backfillScreenshots(path,{fetcher:()=>assert.fail('dry-run must not use network')});assert.equal(results.length,6);assert.ok(results.every(row=>row.action.startsWith('dry-run')&&row.width===320&&row.height===180));assert.deepEqual(await readFile(path),original);
 const cli=spawnSync(process.execPath,['scripts/dashboard-screenshot-backfill.mjs',path],{cwd:process.cwd(),encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).length,6);console.log(cli.stdout.trim());
 for(const base of ['https://production.invalid','http://192.0.2.1','http://127.0.0.1/remote','http://user:pass@localhost/'])await assert.rejects(backfillScreenshots(path,{apply:true,base,token:'not-real',fetcher:()=>assert.fail('remote apply must fail before network')}),/仅允许本地/);
 await writeFile(path,JSON.stringify([{...rows[0],confirmed:false}]));await assert.rejects(backfillScreenshots(path),/每条记录/);
 await writeFile(join(dir,'shot.png'),'<svg onload="alert(1)"/>');await writeFile(path,JSON.stringify(rows));await assert.rejects(backfillScreenshots(path),/PNG/);
 console.log('PASS six-record offline dry-run CLI, no file mutation/network, explicit confirmation and remote-apply/image rejection; no real backfill executed');
}finally{await rm(dir,{recursive:true,force:true});}
