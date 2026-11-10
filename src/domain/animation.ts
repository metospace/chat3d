import {Matrix4,Quaternion as Q,Vector3} from 'three';
import type {SceneDocument,Transform,Vec3} from './types';
import {makeId} from '../util/ids';
export type MotionExpr=number|'t'|'pi'|{op:'add'|'sub'|'mul'|'div'|'mod'|'sin'|'cos'|'abs'|'min'|'max'|'clamp'|'gt'|'lt'|'if';args:MotionExpr[]};
export type MotionValue=number|boolean|Vec3;
export interface AnimationTrack {id:string;name:string;targetIds:string[];channel:'position'|'rotation'|'scale'|'visibility'|'follow';keyframes?:{time:number;value:MotionValue}[];expression?:MotionExpr|MotionExpr[];expressionYaw?:number;axis?:Vec3;pivot?:Vec3;sourceId?:string;start?:number;end?:number}
export interface AnimationProgram {version:1;name:string;duration:number;loop:boolean;tracks:AnimationTrack[]}
export interface AnimationPose {transform:Transform;visible:boolean}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6;
const vector=(v:unknown):v is Vec3=>Array.isArray(v)&&v.length===3&&v.every(finite);
const arity:Record<string,number>={add:2,sub:2,mul:2,div:2,mod:2,sin:1,cos:1,abs:1,min:2,max:2,clamp:3,gt:2,lt:2,if:3};
function exprValid(e:unknown,depth=0,budget={n:0}):boolean{if(++budget.n>64||depth>8)return false;if(finite(e)||e==='t'||e==='pi')return true;if(!e||typeof e!=='object'||Array.isArray(e))return false;const v=e as {op:string;args:unknown[]};return Object.prototype.hasOwnProperty.call(arity,v.op)&&Array.isArray(v.args)&&v.args.length===arity[v.op]&&v.args.every(x=>exprValid(x,depth+1,budget));}
export function evaluateExpression(e:MotionExpr,t:number):number{if(typeof e==='number')return e;if(e==='t')return t;if(e==='pi')return Math.PI;if(e.op==='if')return evaluateExpression(e.args[evaluateExpression(e.args[0],t)?1:2],t);const a=e.args.map(x=>evaluateExpression(x,t));let n=0;switch(e.op){case'add':n=a[0]+a[1];break;case'sub':n=a[0]-a[1];break;case'mul':n=a[0]*a[1];break;case'div':if(!a[1])throw Error('运动表达式除数为零');n=a[0]/a[1];break;case'mod':if(!a[1])throw Error('运动表达式模数为零');n=a[0]%a[1];break;case'sin':n=Math.sin(a[0]);break;case'cos':n=Math.cos(a[0]);break;case'abs':n=Math.abs(a[0]);break;case'min':n=Math.min(...a);break;case'max':n=Math.max(...a);break;case'clamp':n=Math.max(a[1],Math.min(a[2],a[0]));break;case'gt':n=+(a[0]>a[1]);break;case'lt':n=+(a[0]<a[1]);break;}if(!finite(n))throw Error('运动表达式结果超出安全范围');return n;}
export function validateAnimation(raw:unknown,nodes:SceneDocument['nodes']):Error[]{
 if(raw===undefined||raw===null)return [];const a=raw as AnimationProgram;const errors:Error[]=[];const fail=(s:string)=>errors.push(Error(s));
 if(!a||a.version!==1||typeof a.name!=='string'||!a.name.trim()||a.name.length>120||!finite(a.duration)||a.duration<=0||a.duration>3600||typeof a.loop!=='boolean'||!Array.isArray(a.tracks)||!a.tracks.length||a.tracks.length>128)return [Error('动画需要版本1、名称、0–3600秒时长、loop和1–128条轨道')];
 const ids=new Set(nodes.map(n=>n.id)),trackIds=new Set<string>(),channels=new Set<string>(),follow=new Map<string,string>();let bindings=0;
 for(const tr of a.tracks){
  if(!tr||typeof tr.id!=='string'||!tr.id||tr.id.length>120||trackIds.has(tr.id)||typeof tr.name!=='string'||tr.name.length>120){fail('动画轨道名称或ID无效/重复');continue;}trackIds.add(tr.id);
  if(tr.expressionYaw!==undefined&&(tr.channel!=='position'||tr.expression===undefined||typeof tr.expressionYaw!=='number'||!Number.isFinite(tr.expressionYaw)||Math.abs(tr.expressionYaw)>180))fail('表达式偏航仅支持位移表达式及-180–180度有限角度');
  if(!['position','rotation','scale','visibility','follow'].includes(tr.channel)||!Array.isArray(tr.targetIds)||!tr.targetIds.length||tr.targetIds.length>512||tr.targetIds.some(id=>!ids.has(id))||new Set(tr.targetIds).size!==tr.targetIds.length){fail(`轨道 ${tr.name} 类型或目标对象无效`);continue;}
  bindings+=tr.targetIds.length;
  for(const id of tr.targetIds){const key=id+':'+tr.channel;if(channels.has(key))fail('同一对象的同一动画通道只能有一条轨道，请合并关键帧');channels.add(key);}
  if(tr.channel==='follow'){
   if(!tr.sourceId||!ids.has(tr.sourceId)||!finite(tr.start)||!finite(tr.end)||tr.start<0||tr.end<=tr.start||tr.end>a.duration||tr.keyframes||tr.expression!==undefined)fail('绑定轨道需要sourceId及有效start/end，不接受表达式或关键帧');
   else for(const id of tr.targetIds)follow.set(id,tr.sourceId);
   continue;
  }
  if(tr.channel==='rotation'&&(!vector(tr.axis)||Math.hypot(...tr.axis)<1e-8||!vector(tr.pivot)))fail('旋转轨道需要非零世界轴axis和世界坐标pivot');
  const isVector=tr.channel==='position'||tr.channel==='scale';
  if((tr.keyframes===undefined)===(tr.expression===undefined)){fail('每条动画轨道必须在关键帧和受限表达式之间二选一');continue;}
  if(tr.expression!==undefined){if(tr.channel==='visibility'||!(isVector?Array.isArray(tr.expression)&&tr.expression.length===3&&tr.expression.every(x=>exprValid(x)):exprValid(tr.expression)))fail('表达式仅接受有界数学AST，不能执行JavaScript、网络或文件操作');}
  if(tr.keyframes!==undefined){if(!Array.isArray(tr.keyframes)||tr.keyframes.length<1||tr.keyframes.length>128){fail('关键帧数量需为1–128');continue;}let previous=-1;
   for(const k of tr.keyframes){if(!k||!finite(k.time)||k.time<0||k.time>a.duration||k.time<=previous)fail('关键帧时间必须递增且位于动画时长内');previous=k?.time;
    if(tr.channel==='visibility'?typeof k?.value!=='boolean':isVector?!vector(k?.value):!finite(k?.value))fail('关键帧数值类型错误');
    if(tr.channel==='scale'&&vector(k?.value)&&k.value.some(x=>x<=0))fail('动画缩放倍率必须为正');
   }if(tr.keyframes[0]?.time!==0)fail('首个关键帧必须从0秒开始；停留用相同数值的不同时间关键帧');
  }
 }
 if(bindings>2048)fail('动画绑定总数超过2048，请减少同时运动对象');
 for(const id of follow.keys()){const seen=new Set<string>();let next:string|undefined=id;while(next&&follow.has(next)){if(seen.has(next)){fail('动画绑定不能自引用或形成循环');break;}seen.add(next);if(seen.size>16){fail('动画绑定层级不得超过16层');break;}next=follow.get(next);}}
 return errors.slice(0,12);
}

/** Keep motion references valid when editable assembly geometry is replaced. */
export function remapAnimationForReplacement(program:AnimationProgram|undefined,removedIds:string[],replacementIds:string[]):AnimationProgram|undefined {
 if(!program)return program;
 const removed=new Set(removedIds),replacements=[...new Set(replacementIds)],retained=new Set(replacements);
 const deleted=removedIds.filter(id=>!retained.has(id)),newIds=replacements.filter(id=>!removed.has(id));
 const positional=new Map(deleted.length===newIds.length?deleted.map((id,i)=>[id,newIds[i]]):[]);
 let changed=false;
 const tracks=program.tracks.map(track=>{
  let targetIds=track.targetIds,sourceId=track.sourceId;
  if(targetIds.some(id=>removed.has(id))){
   if(removedIds.every(id=>targetIds.includes(id))){
    // A shared motion belongs to the replaced group, including all of its new geometry.
    targetIds=[...new Set(targetIds.flatMap(id=>removed.has(id)?replacements:[id]))];
   }else if(targetIds.some(id=>deleted.includes(id))){
    if(deleted.length!==1&&positional.size!==deleted.length)throw Error(`轨道 ${track.name} 的替换零件有不同动画，无法明确对应新零件；请先调整动画绑定再替换`);
    targetIds=[...new Set(targetIds.flatMap(id=>!deleted.includes(id)?[id]:deleted.length===1?newIds:[positional.get(id)!]))];
   }
  }
  if(sourceId&&deleted.includes(sourceId)){
   const mapped=positional.get(sourceId)??(deleted.length===1?newIds[0]:undefined);
   if(!mapped)throw Error(`轨道 ${track.name} 的跟随源 ${sourceId} 无法明确对应新零件；请先调整动画绑定再替换`);
   sourceId=mapped;
  }
  if(sourceId===track.sourceId&&targetIds.length===track.targetIds.length&&targetIds.every((id,i)=>id===track.targetIds[i]))return track;
  changed=true;return {...track,targetIds,...(sourceId!==track.sourceId?{sourceId}:{})};
 });
 return changed?{...program,tracks}:program;
}
/** Copy only selected bindings; an external follow source cannot be copied implicitly. */
export function copyAnimationTracks(program:AnimationProgram|undefined,ids:Map<string,string>,offset:Vec3):AnimationTrack[]{
 return (program?.tracks??[]).filter(t=>t.targetIds.some(id=>ids.has(id))).map(t=>{
  if(t.channel==='follow'&&!ids.has(t.sourceId!))throw Error('动画跟随源在复制范围之外，请一并选择跟随源');
  const copy=structuredClone(t);copy.id=makeId();copy.targetIds=t.targetIds.filter(id=>ids.has(id)).map(id=>ids.get(id)!);
  if(copy.sourceId)copy.sourceId=ids.get(copy.sourceId)!;
  if(copy.pivot)copy.pivot=copy.pivot.map((v,i)=>v+offset[i]) as Vec3;
  return copy;
 });
}

/** Rebase world-space motion in the same transaction as the editable base geometry. */
export function transformAnimation(program:AnimationProgram|undefined,before:SceneDocument['nodes'],after:SceneDocument['nodes']):AnimationProgram|undefined {
 if(!program)return program;
 const previous=new Map(before.map(n=>[n.id,n])),changes=new Map<string,Matrix4>();
 for(const node of after){const old=previous.get(node.id);if(!old||old.transform===node.transform)continue;const delta=matrix(node.transform).multiply(matrix(old.transform).invert());if(delta.elements.some((v,i)=>Math.abs(v-(i%5===0?1:0))>1e-8))changes.set(node.id,delta);}
 if(!changes.size)return program;
 const tracks=program.tracks.map(track=>{
  const selected=track.targetIds.filter(id=>changes.has(id));
  if(track.channel==='follow'&&(selected.length||changes.has(track.sourceId!))&&(!selected.length||selected.length!==track.targetIds.length||!changes.has(track.sourceId!)))throw Error('动画跟随依赖在变换范围之外，请一并选择跟随源和目标');
  if(!selected.length)return track;
  const delta=changes.get(selected[0])!;
  if(selected.length!==track.targetIds.length||selected.some(id=>changes.get(id)!.elements.some((v,i)=>Math.abs(v-delta.elements[i])>1e-7))||(track.channel==='follow'&&changes.get(track.sourceId!)!.elements.some((v,i)=>Math.abs(v-delta.elements[i])>1e-7)))throw Error('共享动画轨道的对象需整体变换，请一并选择关联对象');
  const copy=structuredClone(track),position=new Vector3(),rotation=new Q(),scale=new Vector3();delta.decompose(position,rotation,scale);
  if(copy.pivot)copy.pivot=new Vector3(...copy.pivot).applyMatrix4(delta).toArray() as Vec3;
  if(copy.axis){if(Math.max(...scale.toArray())-Math.min(...scale.toArray())>1e-7)throw Error('旋转动画对象不支持非等比整体缩放，请使用等比缩放');copy.axis=new Vector3(...copy.axis).applyQuaternion(rotation).normalize().toArray() as Vec3;}
  if(copy.channel==='position'){
   const linear=delta.clone();linear.setPosition(0,0,0);
   if(copy.keyframes)for(const key of copy.keyframes)key.value=new Vector3(...key.value as Vec3).applyMatrix4(linear).toArray() as Vec3;
   if(copy.expression){
    const yaw=new Matrix4().makeRotationY((copy.expressionYaw??0)*Math.PI/180);linear.multiply(yaw);delete copy.expressionYaw;
    const original=copy.expression as MotionExpr[];
    copy.expression=[0,1,2].map(row=>{const terms=original.flatMap((expr,col)=>{const coefficient=linear.elements[col*4+row];return Math.abs(coefficient)<1e-10?[]:[Math.abs(coefficient-1)<1e-10?expr:{op:'mul' as const,args:[coefficient,expr]}];});return terms.reduce<MotionExpr>((sum,term)=>sum===0?term:{op:'add',args:[sum,term]},0);});
   }
  }
  return copy;
 });
 return {...program,tracks};
}
function sample(tr:AnimationTrack,time:number):MotionValue{
 if(tr.expression!==undefined)return Array.isArray(tr.expression)?tr.expression.map(x=>evaluateExpression(x,time)) as Vec3:evaluateExpression(tr.expression,time);
 const keys=tr.keyframes!;if(time<=keys[0].time)return keys[0].value;
 for(let i=1;i<keys.length;i++){if(time<keys[i].time){const left=keys[i-1],right=keys[i],p=(time-left.time)/(right.time-left.time);if(tr.channel==='visibility')return left.value;if(Array.isArray(left.value))return left.value.map((v,j)=>v+((right.value as Vec3)[j]-v)*p) as Vec3;return (left.value as number)+((right.value as number)-(left.value as number))*p;}}
 return keys[keys.length-1].value;
}
const matrix=(t:Transform)=>new Matrix4().compose(new Vector3(...t.position),new Q(...t.rotationQuaternion),new Vector3(...t.scale));
export function createAnimationEvaluator(doc:SceneDocument){
 const program=doc.animation;const errors=validateAnimation(program,doc.nodes);if(errors.length)throw errors[0];
 const nodes=new Map(doc.nodes.map(n=>[n.id,n])),tracks=new Map<string,AnimationTrack[]>();for(const tr of program?.tracks??[])for(const id of tr.targetIds)tracks.set(id,[...(tracks.get(id)??[]),tr]);
 const expressionRotations=new Map((program?.tracks??[]).filter(tr=>tr.expressionYaw).map(tr=>{const angle=tr.expressionYaw!*Math.PI/180;return [tr,{cos:Math.cos(angle),sin:Math.sin(angle)}] as const;}));
 return (time:number):Map<string,AnimationPose>=>{
  if(!finite(time))throw Error('动画时间无效');const t=Math.max(0,Math.min(time,program?.duration??0)),memo=new Map<string,AnimationPose>();let evaluations=0;
  const evaluate=(id:string,at:number):AnimationPose=>{
   if(++evaluations>20000)throw Error('动画计算超过预算');const key=id+':'+at;if(memo.has(key))return memo.get(key)!;
   const node=nodes.get(id);if(!node)throw Error('动画对象已不存在');const transform=structuredClone(node.transform);let visible=node.visible;const list=tracks.get(id)??[];
   const rotation=list.find(x=>x.channel==='rotation');if(rotation){const angle=sample(rotation,at) as number,q=new Q().setFromAxisAngle(new Vector3(...rotation.axis!).normalize(),angle*Math.PI/180);transform.position=new Vector3(...transform.position).sub(new Vector3(...rotation.pivot!)).applyQuaternion(q).add(new Vector3(...rotation.pivot!)).toArray() as Vec3;transform.rotationQuaternion=q.multiply(new Q(...transform.rotationQuaternion)).toArray();}
   for(const tr of list){if(tr.channel==='position'){const offset=sample(tr,at) as Vec3,r=expressionRotations.get(tr);if(r){const [x,,z]=offset;offset[0]=r.cos*x+r.sin*z;offset[2]=-r.sin*x+r.cos*z;}transform.position=transform.position.map((v,i)=>v+offset[i]) as Vec3;}if(tr.channel==='scale'){const scale=sample(tr,at) as Vec3;transform.scale=transform.scale.map((v,i)=>v*scale[i]) as Vec3;}if(tr.channel==='visibility')visible=sample(tr,at) as boolean;}
   const binding=list.find(x=>x.channel==='follow');if(binding&&at>=binding.start!){const end=Math.min(at,binding.end!),delta=matrix(evaluate(binding.sourceId!,end).transform).multiply(matrix(evaluate(binding.sourceId!,binding.start!).transform).invert());const final=delta.multiply(matrix(transform)),p=new Vector3(),q=new Q(),s=new Vector3();final.decompose(p,q,s);transform.position=p.toArray();transform.rotationQuaternion=q.toArray();transform.scale=s.toArray();}
   if(!vector(transform.position)||!vector(transform.scale)||transform.scale.some(x=>x<=0)||!transform.rotationQuaternion.every(finite))throw Error('动画结果超出范围，已停止播放');const pose={transform,visible};memo.set(key,pose);return pose;
  };
  return new Map([...tracks.keys()].map(id=>[id,evaluate(id,t)]));
 };
}
