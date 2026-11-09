import type {TeamClient} from './teamLibrary';
import {dashboardPath,type DashboardPackage} from '../../shared/dashboard-package.mjs';
import {exportFile} from '../util/exportFile';
export type DashboardMode='dashboard'|'overlay';
export interface DashboardView {zoom:number;offsetX:number;offsetY:number;azimuth:number;elevation:number}
export const DEFAULT_DASHBOARD_VIEW:DashboardView={zoom:1,offsetX:0,offsetY:0,azimuth:45,elevation:30};
export function validDashboardView(value:unknown):value is DashboardView {if(!value||typeof value!=='object')return false;const v=value as DashboardView;return [v.zoom,v.offsetX,v.offsetY,v.azimuth,v.elevation].every(Number.isFinite)&&v.zoom>=.25&&v.zoom<=4&&Math.abs(v.offsetX)<=1&&Math.abs(v.offsetY)<=1&&v.azimuth>=-180&&v.azimuth<=180&&v.elevation>=5&&v.elevation<=85;}
export interface DashboardRegion {x:number;y:number;width:number;height:number}
export function validDashboardRegion(value:unknown):value is DashboardRegion {if(!value||typeof value!=='object')return false;const r=value as DashboardRegion;return [r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.width>=5&&r.height>=5&&r.x+r.width<=100&&r.y+r.height<=100;}
export interface DashboardBinding {service:string;templateId:string;version:number;name:string;mode:DashboardMode;view?:DashboardView;region?:DashboardRegion;slot:DashboardRegion}
export interface DashboardItem {id:string;version:number;name:string;description:string;system:string;archived:boolean;fileName:string;entry:string;created:string;sourceKind?:'file'|'folder';bytes?:number;fileCount?:number}
export interface DashboardVersion extends DashboardItem {package:DashboardPackage}
export interface DashboardManifest extends DashboardItem {files:{path:string;bytes:number}[]}
export function validDashboardBinding(value:unknown):value is DashboardBinding {
 if(!value||typeof value!=='object')return false;
 const b=value as DashboardBinding;
 if(b.view!==undefined&&!validDashboardView(b.view))return false;
 if(b.region!==undefined&&!validDashboardRegion(b.region))return false;
 try{const u=new URL(b.service);if(u.origin!==b.service||u.username||u.password||!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))return false;}catch{return false;}
 return typeof b.templateId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(b.templateId)&&Number.isSafeInteger(b.version)&&b.version>0&&typeof b.name==='string'&&b.name.length>0&&b.name.length<=80&&['dashboard','overlay'].includes(b.mode)&&!!b.slot&&['x','y','width','height'].every(k=>Number.isFinite(b.slot[k as keyof typeof b.slot]))&&b.slot.x>=0&&b.slot.y>=0&&b.slot.width>=5&&b.slot.height>=5&&b.slot.x+b.slot.width<=100&&b.slot.y+b.slot.height<=100;
}
export function dashboardBinding(service:string,item:DashboardItem,mode:DashboardMode):DashboardBinding{return {service,templateId:item.id,version:item.version,name:item.name,mode,slot:mode==='dashboard'?{x:25,y:18,width:50,height:64}:{x:65,y:5,width:33,height:85}};}
export function listDashboards(client:TeamClient,all=false){return client.request<DashboardItem[]>('dashboards'+(all?'?all=1':''));}
export async function readDashboard(client:TeamClient,id:string,version:number):Promise<DashboardVersion>{
 const result=await client.request<DashboardManifest>(`dashboards/${encodeURIComponent(id)}/${version}`);if(result.id!==id||result.version!==version||!Array.isArray(result.files))throw Error('看板固定版本不匹配');
 const files:Record<string,Uint8Array>=Object.create(null);
 // Bound concurrent transfers; the preview necessarily needs its static resources in browser memory.
 for(let offset=0;offset<result.files.length;offset+=4)await Promise.all(result.files.slice(offset,offset+4).map(async file=>{dashboardPath(file.path);const response=await client.raw(`dashboards/${encodeURIComponent(id)}/${version}/files?path=${encodeURIComponent(file.path)}`);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==file.bytes)throw Error('看板资源未完整返回：'+file.path);files[file.path]=bytes;}));
 return {...result,package:{fileName:result.fileName,entry:result.entry,files}};
}
export async function downloadDashboardSource(client:TeamClient,item:DashboardItem):Promise<string|null>{
 return exportFile(async()=>{const response=await client.raw(`dashboards/${encodeURIComponent(item.id)}/${item.version}/source`,undefined,new AbortController().signal);return response.arrayBuffer();},/\.zip$/i.test(item.fileName)?'zip':'html',item.fileName);
}
/** Explicit local commands; arbitrary model prompts are never interpreted as bindings. */
export function parseDashboardCommand(text:string):{name?:string;mode:DashboardMode;remove?:boolean}|undefined {
 if(/^\s*\/看板\s+移除\s*$/.test(text))return {mode:'dashboard',remove:true};
 const match=text.match(/^\s*\/看板(?:\s+(?:(嵌入|叠加)\s+)?(.+?))?\s*$/);if(!match)return;
 return {mode:match[1]==='叠加'?'overlay':'dashboard',name:match[2]?.replace(/^[“「"]|[”」"]$/g,'')};
}
