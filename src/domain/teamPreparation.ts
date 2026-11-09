/// <reference lib="es2024.promise" />
import {readModelAsset} from './modelAssetStorage';
import {constructTeamPreparation,fingerprintSavedTeamContent,teamPreparationRequest,type TeamPreparationInput,type TeamPreparationResult} from './teamPreparationCore';
import {fingerprintTeamContent,type TeamFingerprintInput} from './teamFingerprint';
import {preparationRecords,type PreparationWireRecord,type PreparationWireValue} from './teamPreparationWire';
import type {TeamPreparationWorkerRequest} from './teamPreparationWorker';
import type {TeamPublish} from './teamLibrary';
export type {TeamPreparationProgress} from './teamPreparationCore';
type WorkerReply={type:'ack'}|{type:'progress';stage:string}|{type:'error';message:string}|{type:'fingerprint';fingerprint:string}|({type:'result'}&Omit<TeamPreparationResult,'request'>&{request:Omit<TeamPublish,'payload'>});
export function yieldTeamPreparationPaint():Promise<void>{
 const {promise,resolve}=Promise.withResolvers<void>();let frame:number|undefined,done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);setTimeout(resolve,0);};const timer=setTimeout(finish,50);if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(finish);return promise;
}
async function runPreparationWorker(input:TeamPreparationInput|undefined,content:unknown,onStage?:(stage:string)=>void,saved?:Pick<TeamPreparationInput,'kind'|'name'|'description'|'category'|'asset'>){
 await yieldTeamPreparationPaint();
 const worker=new Worker(new URL('./teamPreparationWorker.ts',import.meta.url),{type:'module',name:'team-publication-preparation'});
 let failure:Error|undefined;
 const failed=(event:ErrorEvent)=>{event.preventDefault();failure=Error(event.message||'发布后台准备失败，请重新准备');};
 const unreadable=()=>{failure=Error('无法接收发布后台结果，请重新准备');};
 worker.addEventListener('error',failed);worker.addEventListener('messageerror',unreadable);
 worker.addEventListener('message',(event:MessageEvent<WorkerReply>)=>{if(event.data.type==='progress')onStage?.(event.data.stage);});
 const exchange=(request:TeamPreparationWorkerRequest,expected:'ack'|'result'|'fingerprint')=>{
  const {promise,resolve,reject}=Promise.withResolvers<WorkerReply>();
  if(failure){reject(failure);return promise;}
  const cleanup=()=>{worker.removeEventListener('message',message);worker.removeEventListener('error',error);worker.removeEventListener('messageerror',messageError);};
  const message=(event:MessageEvent<WorkerReply>)=>{if(event.data.type==='error'){cleanup();reject(Error(event.data.message));}else if(event.data.type===expected){cleanup();resolve(event.data);}};
  const error=(event:ErrorEvent)=>{event.preventDefault();cleanup();reject(Error(event.message||'发布后台准备失败，请重新准备'));};
  const messageError=()=>{cleanup();reject(Error('无法接收发布后台结果，请重新准备'));};
  worker.addEventListener('message',message);worker.addEventListener('error',error);worker.addEventListener('messageerror',messageError);
  try{worker.postMessage(request);}catch(error){cleanup();reject(error);}
  return promise;
 };
 try{
  let root:PreparationWireValue=undefined;
  if(content!==undefined){
   onStage?.('transferring');let records:PreparationWireRecord[]=[],size=0,deadline=performance.now()+4;
   const flush=async()=>{if(records.length){await exchange({type:'chunk',records},'ack');records=[];size=0;}const {promise,resolve}=Promise.withResolvers<void>();setTimeout(resolve,0);await promise;deadline=performance.now()+4;};
   for(const record of preparationRecords(content,value=>{root=value;})){records.push(record);size+=record.op==='numbers'?record.values.length*8:record.op==='string'?record.part.length*2:record.op==='set'&&typeof record.value==='string'?record.value.length*2:64;if(size>=131072||records.length>=1024||performance.now()>=deadline)await flush();}
   await flush();
  }
  return await exchange(input?{type:'prepare',input,root}:saved?{type:'savedFingerprint',input:saved,root}:{type:'fingerprint',root},input?'result':'fingerprint');
 }finally{worker.terminate();}
}
export async function prepareTeamPublicationSnapshot(input:TeamPreparationInput,onStage?:(stage:string)=>void):Promise<TeamPreparationResult>{
 if(import.meta.env.SSR||typeof window==='undefined'){
  const local=input.asset?await readModelAsset(input.asset.id,input.asset.version):input.scene;
  return constructTeamPreparation(input,local,onStage);
 }
 if(typeof Worker==='undefined')throw Error('当前浏览器不支持后台发布准备，请使用支持 Web Worker 的浏览器');
 const {scene,...metadata}=input;
 const result=await runPreparationWorker(metadata,scene,onStage);
 if(result.type!=='result')throw Error('发布后台没有返回准备结果');
 return {...result,request:teamPreparationRequest(result.request,result.publication)};
}
export async function asyncTeamLocalFingerprint(input:TeamFingerprintInput){
 if(import.meta.env.SSR||typeof window==='undefined')return fingerprintTeamContent(input);
 if(typeof Worker==='undefined')throw Error('当前浏览器不支持后台指纹计算，请使用支持 Web Worker 的浏览器');
 const result=await runPreparationWorker(undefined,input);
 if(result.type!=='fingerprint')throw Error('发布后台没有返回指纹');
 return result.fingerprint;
}
export async function fingerprintSavedTeamResource(input:Pick<TeamPreparationInput,'kind'|'name'|'description'|'category'|'asset'|'scene'>){
 if(import.meta.env.SSR||typeof window==='undefined')return fingerprintSavedTeamContent(input,input.asset?await readModelAsset(input.asset.id,input.asset.version):input.scene);
 if(typeof Worker==='undefined')throw Error('当前浏览器不支持后台指纹计算，请使用支持 Web Worker 的浏览器');
 const {scene,...metadata}=input,result=await runPreparationWorker(undefined,scene,undefined,metadata);
 if(result.type!=='fingerprint')throw Error('发布后台没有返回指纹');
 return result.fingerprint;
}
