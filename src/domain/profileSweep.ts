import {validateProfile} from './profileValidation';
export type SweepPoint=[number,number];
export interface ProfileSweepParams {profile:SweepPoint[];path:SweepPoint[];closed?:boolean}
const EPS=1e-8;
const area=(p:SweepPoint[])=>p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const cross=(a:SweepPoint,b:SweepPoint,c:SweepPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const distance=(p:SweepPoint,a:SweepPoint,b:SweepPoint)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y)));return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y);};
const intersects=(a:SweepPoint,b:SweepPoint,c:SweepPoint,d:SweepPoint)=>{
 if(Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<EPS)return true;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
};

/** Bounded planar sweeps, with explicit errors instead of clamped miters or
 * silently self-intersecting solids. This is not a general CAD offset solver. */
export function prepareProfileSweep(params:ProfileSweepParams){
 if(!params||typeof params!=='object')throw Error('profileSweep.params缺失');
 if(Object.keys(params).some(key=>!['profile','path','closed'].includes(key)))throw Error('profileSweep仅支持profile/path/closed；截面孔请使用合适的profile或tube，高度用截面坐标或节点位置设置');
 const {profile,path,closed=false}=params;
 const errors=validateProfile(profile);if(errors.length)throw Error('扫掠截面：'+errors[0].message);
 if(typeof closed!=='boolean')throw Error('profileSweep.closed必须是布尔值');
 if(!Array.isArray(path)||path.length<(closed?3:2)||path.length>64||path.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100)))throw Error('扫掠路径需要2–64个[X,Z]有限米制点；闭合路径至少3点，坐标不超过±100米');
 const count=closed?path.length:path.length-1;
 const directions:SweepPoint[]=[],lengths:number[]=[];
 for(let i=0;i<count;i++){
  const a=path[i],b=path[(i+1)%path.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(length<1e-5)throw Error('扫掠路径不能有重合点；闭合路径不重复首点');
  directions.push([(b[0]-a[0])/length,(b[1]-a[1])/length]);lengths.push(length);
 }
 const profileLength=profile.reduce((sum,a,i)=>{const b=profile[(i+1)%profile.length];return sum+Math.hypot(b[0]-a[0],b[1]-a[1]);},0);
 if(lengths.reduce((sum,n)=>sum+n,0)>10000||profileLength>10000)throw Error('扫掠展开距离超过10000米，请拆分路径或截面，以保持网格UV可导入');
 if(closed&&Math.abs(area(path))<EPS)throw Error('闭合扫掠路径面积退化');
 const width=Math.max(...profile.map(p=>Math.abs(p[0])));
 for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
  if(j===i+1||closed&&i===0&&j===count-1)continue;
  const a=path[i],b=path[(i+1)%path.length],c=path[j],d=path[(j+1)%path.length];
  if(intersects(a,b,c,d))throw Error('扫掠路径不能自交或自接触');
  if(Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<=width*2+EPS)throw Error('扫掠路径间距不足以容纳当前截面，请缩小截面或调整路径');
 }
 // Open paths use the left normal in XZ; closed paths orient offsets outward.
 const side=closed&&area(path)>0?-1:1;
 const normal=(d:SweepPoint):SweepPoint=>[-d[1]*side,d[0]*side];
 const frames=path.map((_p,i):SweepPoint=>{
  if(!closed&&i===0)return normal(directions[0]);
  if(!closed&&i===path.length-1)return normal(directions[count-1]);
  const a=normal(directions[(i-1+count)%count]),b=normal(directions[i%count]);
  const denominator=1+a[0]*b[0]+a[1]*b[1];
  if(denominator<EPS)throw Error('扫掠路径不能折返');
  const frame:SweepPoint=[(a[0]+b[0])/denominator,(a[1]+b[1])/denominator];
  if(Math.hypot(...frame)>4)throw Error('扫掠拐角过尖，请增加过渡路径，避免斜接尖刺');
  return frame;
 });
 const offsets=[Math.min(...profile.map(p=>p[0])),Math.max(...profile.map(p=>p[0]))];
 for(let i=0;i<count;i++)for(const offset of offsets){const j=(i+1)%path.length,d=directions[i];
  if((path[j][0]+frames[j][0]*offset-path[i][0]-frames[i][0]*offset)*d[0]+(path[j][1]+frames[j][1]*offset-path[i][1]-frames[i][1]*offset)*d[1]<=EPS)throw Error('截面与路径拐角发生折叠，请缩小截面或延长路径');
 }
 return {profile:area(profile)>0?profile.map(p=>[...p] as SweepPoint):[...profile].reverse().map(p=>[...p] as SweepPoint),path,closed,frames,side,lengths};
}
export function validateProfileSweep(params:ProfileSweepParams):Error[]{
 try{prepareProfileSweep(params);return [];}catch(error){return [error instanceof Error?error:new Error('扫掠参数无效')];}
}
