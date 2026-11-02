import {validateProfile} from './profileValidation';
import type {Vec3} from './types';

type Point=[number,number];
type RoundedSection={center:Vec3;width:number;depth:number;cornerRadius:number};
type PolygonSection={center:Vec3;points:Point[]};
export type SectionLoftParams=
 | {shape:'roundedRectangle';sections:RoundedSection[];segments:number}
 | {shape:'polygon';sections:PolygonSection[]};
const EPS=1e-9;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=100;
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=(p:Point[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0);
const mix=(a:Point,b:Point,t:number):Point=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const on=(a:Point,b:Point,p:Point)=>Math.abs(cross(a,b,p))<=EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
const intersects=(a:Point,b:Point,c:Point,d:Point)=>on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)||(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0);

/** Event times of a quadratic; orientation signs cannot change between these events. */
function roots(f:(t:number)=>number):number[]{
 const c=f(0),end=f(1),mid=f(.5),a=2*(end+c-2*mid),b=end-c-a;
 if(Math.abs(a)<1e-12)return Math.abs(b)<1e-12?[]:[-c/b].filter(t=>t>0&&t<1);
 // Exact endpoint zeros arise from the deliberately split strip edges. Factor
 // them out rather than turning roundoff near t=1 into a false collapse event.
 if(c===0)return [-b/a].filter(t=>t>0&&t<1);
 if(end===0)return [c/a].filter(t=>t>0&&t<1);
 const d=b*b-4*a*c;if(d<0)return [];
 const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(d));
 return (q===0?[-b/(2*a)]:[q/a,c/q]).filter(t=>t>0&&t<1);
}
function events(times:number[]):number[]{
 const sorted=[0,...times,1].sort((a,b)=>a-b),out:number[]=[];
 for(let i=0;i<sorted.length-1;i++)if(sorted[i+1]-sorted[i]>1e-12){out.push((sorted[i]+sorted[i+1])/2);if(sorted[i]>0)out.push(sorted[i]);}
 return out;
}

/** Validate the actual triangulated strip, not just a few sampled interpolated rings.
 * Every horizontal slice has two vertices per original edge (the second lies on
 * the triangle diagonal). Segment intersections can only change at orientation
 * roots, so checking those events and their intervals covers the full height.
 */
function validateStrip(bottom:Point[],top:Point[]):void{
 const from:Point[]=[],to:Point[]=[];
 for(let i=0;i<bottom.length;i++){from.push(bottom[i],bottom[(i+1)%bottom.length]);to.push(top[i],top[i]);}
 const at=(i:number,t:number)=>mix(from[i],to[i],t),n=from.length;
 // Swept endpoint boxes are conservative for linear motion. Most disjoint
 // perimeter edges never need polynomial events (including 64-segment shells).
 const boxes=from.map((a,i)=>{const next=(i+1)%n,b=from[next],c=to[i],d=to[next];return [Math.min(a[0],b[0],c[0],d[0]),Math.max(a[0],b[0],c[0],d[0]),Math.min(a[1],b[1],c[1],d[1]),Math.max(a[1],b[1],c[1],d[1])];});
 const signedArea=(t:number)=>area(from.map((_,i)=>at(i,t)));
 if(events(roots(signedArea)).some(t=>signedArea(t)<=EPS))throw Error('sectionLoft截面对应导致中间面积退化或绕序翻转');
 for(let i=0;i<n;i++){
  const next=(i+1)%n,after=(i+2)%n;
  const turn=(t:number)=>cross(at(i,t),at(next,t),at(after,t));
  for(const t of events(roots(turn))){const a=at(i,t),b=at(next,t),c=at(after,t);if(Math.abs(cross(a,b,c))<=EPS&&(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]) < -EPS)throw Error('sectionLoft截面对应导致侧面折返');}
  // A collapsing side edge is also a degenerate surface triangle.
  const length=(t:number)=>{const a=at(i,t),b=at(next,t);return (a[0]-b[0])**2+(a[1]-b[1])**2;};
  if(events(roots(length)).some(t=>length(t)<1e-16))throw Error('sectionLoft截面对应导致侧面退化');
  for(let j=i+2;j<n;j++){
   if(i===0&&j===n-1)continue;
   const jn=(j+1)%n;
   const aBox=boxes[i],bBox=boxes[j];
   if(aBox[1]<bBox[0]||bBox[1]<aBox[0]||aBox[3]<bBox[2]||bBox[3]<aBox[2])continue;
   const tests=[(t:number)=>cross(at(i,t),at(next,t),at(j,t)),(t:number)=>cross(at(i,t),at(next,t),at(jn,t)),(t:number)=>cross(at(j,t),at(jn,t),at(i,t)),(t:number)=>cross(at(j,t),at(jn,t),at(next,t))];
   // Collinear motions also need endpoint-order events.
   const times=tests.flatMap(roots);
   for(const a of [i,next])for(const b of [j,jn])for(const axis of [0,1])times.push(...roots(t=>at(a,t)[axis]-at(b,t)[axis]));
   if(events(times).some(t=>intersects(at(i,t),at(next,t),at(j,t),at(jn,t))))throw Error('sectionLoft截面对应导致层间自交或自接触');
  }
 }
}

export function prepareSectionLoft(params:SectionLoftParams):{rings:Point[][];heights:number[]}{
 if(!params||typeof params!=='object'||!['roundedRectangle','polygon'].includes(params.shape))throw Error('sectionLoft.shape需为roundedRectangle或polygon');
 const allowed=params.shape==='polygon'?['shape','sections']:['shape','sections','segments'];
 if(Object.keys(params).some(k=>!allowed.includes(k)))throw Error('sectionLoft包含未知参数');
 if(!Array.isArray(params.sections)||params.sections.length<2||params.sections.length>32)throw Error('sectionLoft需要2–32个截面');
 if(params.shape==='roundedRectangle'&&(!Number.isInteger(params.segments)||params.segments<8||params.segments>64||params.segments%4))throw Error('sectionLoft.segments需为8–64之间的4倍数');
 const rings:Point[][]=[],heights:number[]=[];
 let winding=0,count=0;
 for(const section of params.sections){
  if(!section||typeof section!=='object'||!Array.isArray(section.center)||section.center.length!==3||!section.center.every(finite))throw Error('sectionLoft截面center需为±100米内有限三维坐标');
  const [x,y,z]=section.center;
  if(heights.length&&y-heights[heights.length-1]<1e-6)throw Error('sectionLoft截面Y需严格递增，层距至少0.000001米');
  let points:Point[];
  if(params.shape==='roundedRectangle'){
   const s=section as RoundedSection;
   if(Object.keys(s).some(k=>!['center','width','depth','cornerRadius'].includes(k)))throw Error('sectionLoft圆角矩形截面包含未知字段');
   if(!finite(s.width)||!finite(s.depth)||!finite(s.cornerRadius)||s.width<=0||s.depth<=0||s.cornerRadius<1e-6||s.cornerRadius>=Math.min(s.width,s.depth)/2-1e-6)throw Error('sectionLoft宽深需为0–100米，圆角至少0.000001米且严格小于短边一半；直角截面请用polygon');
   const k=params.segments/4,r=s.cornerRadius;points=[];
   for(let corner=0;corner<4;corner++)for(let j=0;j<k;j++){
    const angle=(corner+j/(k-1))*Math.PI/2,cx=(corner===0||corner===3?1:-1)*(s.width/2-r),cz=(corner<2?1:-1)*(s.depth/2-r);
    points.push([cx+r*Math.cos(angle),cz+r*Math.sin(angle)]);
   }
  }else{
   const s=section as PolygonSection;
   if(Object.keys(s).some(k=>!['center','points'].includes(k)))throw Error('sectionLoft多边形截面包含未知字段');
   points=s.points;
  }
  const errors=validateProfile(points);if(errors.length)throw Error('sectionLoft截面：'+errors[0].message);
  const sign=Math.sign(area(points));
  if(count&&(points.length!==count||sign!==winding))throw Error('sectionLoft截面需要同点数、同绕序，逐点对应且不重复首点');
  count=points.length;winding=sign;
  const ring=points.map(([a,b]):Point=>[Math.fround(a+x),Math.fround(b+z)]);
  if(ring.some(p=>p.some(v=>Math.abs(v)>100)))throw Error('sectionLoft截面顶点需在±100米内');
  const renderedErrors=validateProfile(ring);if(renderedErrors.length)throw Error('sectionLoft截面在渲染精度下退化：'+renderedErrors[0].message);
  if(heights.length&&Math.fround(y)<=heights[heights.length-1])throw Error('sectionLoft层距在渲染精度下退化');
  rings.push(sign>0?ring:ring.reverse());heights.push(Math.fround(y));
 }
 for(let i=1;i<rings.length;i++)validateStrip(rings[i-1],rings[i]);
 return {rings,heights};
}
export function validateSectionLoft(params:SectionLoftParams):Error[]{
 try{prepareSectionLoft(params);return [];}catch(error){return [error instanceof Error?error:new Error(String(error))];}
}

/** Explicit portable copy; no arbitrary nested fields cross model/team boundaries. */
export function sanitizeSectionLoftParams(raw:unknown):SectionLoftParams|null{
 if(!raw||typeof raw!=='object')return null;
 const p=raw as SectionLoftParams;
 if(validateSectionLoft(p).length)return null;
 if(p.shape==='roundedRectangle')return {shape:p.shape,segments:p.segments,sections:p.sections.map(s=>({center:[...s.center],width:s.width,depth:s.depth,cornerRadius:s.cornerRadius}))};
 return {shape:p.shape,sections:p.sections.map(s=>({center:[...s.center],points:s.points.map(([x,z])=>[x,z])}))};
}
