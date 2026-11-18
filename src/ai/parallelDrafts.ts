import type {SceneDocument,Vec3} from '../domain/types';
import {validateDocument} from '../domain/types';
import type {Command} from '../domain/commands';
import {makeId} from '../util/ids';
export interface ComponentJob {name:string;brief:string;position:Vec3}
export interface ChildRun {id:string;name:string;status:'queued'|'running'|'ready'|'done'|'failed'|'cancelled';startedAt?:number;endedAt?:number;inputTokens:number;outputTokens:number;usageReported:boolean;rounds:number;toolCalls:number;error?:string}
export function isolatedDocument(base:SceneDocument):SceneDocument{
 const materials=base.materials.filter(m=>m.id.startsWith('mat_')).slice(0,20).map(m=>{const {maps,surface,...plain}=m;return plain;});
 return {schemaVersion:base.schemaVersion,unit:base.unit,upAxis:base.upAxis,projectId:makeId(),revision:0,nodes:[],assets:[],materials:materials.length?materials:[{id:'mat_default',baseColor:'#85909c',roughness:.55,metalness:0}],animation:undefined};
}
export function componentDraftCommand(doc:SceneDocument,job:ComponentJob):Command{
 const errors=validateDocument(doc);if(errors.length)throw errors[0];
 if(!doc.nodes.length||doc.nodes.some(n=>!n.visible||n.kind!=='primitive'||!n.geometry||n.parentId!==null)||doc.animation)throw Error('子草稿必须包含可见静态平级部件');
 if(!Array.isArray(job.position)||job.position.length!==3||job.position.some(v=>!Number.isFinite(v)||Math.abs(v)>10000))throw Error('子草稿放置坐标无效');
 const group=makeId(),nodes=doc.nodes.map(n=>({...n,assemblyId:group,assemblyName:job.name,planKey:job.name,transform:{...n.transform,position:n.transform.position.map((v,i)=>v+job.position[i]) as Vec3}}));
 const used=new Set(nodes.map(n=>n.materialId));return {op:'importComponentDraft',nodes,materials:doc.materials.filter(m=>used.has(m.id))};
}
/** Only two workers can run. Abort stops queued work and rejects late results. */
export async function runBoundedJobs<T>(jobs:ComponentJob[],worker:(job:ComponentJob,index:number)=>Promise<T>,signal?:AbortSignal):Promise<PromiseSettledResult<T>[]>{
 if(jobs.length<2||jobs.length>4||new Set(jobs.map(j=>j.name)).size!==jobs.length)throw Error('并行任务需要2–4个不重名的独立组件');
 const results:PromiseSettledResult<T>[]=[];let next=0;
 const check=()=>{if(signal?.aborted)throw new DOMException('已停止子代理','AbortError');};check();
 await Promise.all(Array.from({length:2},async()=>{while(next<jobs.length){check();const i=next++;try{const value=await worker(jobs[i],i);check();results[i]={status:'fulfilled',value};}catch(reason){check();results[i]={status:'rejected',reason};}}}));check();return results;
}
