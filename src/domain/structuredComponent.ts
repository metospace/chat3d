import {STRUCTURED_PART_LIMIT, STRUCTURED_BYTES_LIMIT} from './structureLimits';
import {assemblyBounds} from './assemblyEditing';
import {Matrix4,Quaternion,Vector3,Euler} from 'three';
import {nodeMatrix} from './assetContract';
import {matchesGeometryApproach} from './geometryApproach';
import {AssemblyValidationError,buildAssembly,type AssemblyDefinition} from './assembly';
import {validateBlueprints,validateFeatureBindings,type ObjectBlueprint,type FeatureBinding} from './objectBlueprint';
import type {SceneDocument,SceneNode} from './types';
export interface FeatureParts {key:string;partNames:string[]}
export interface BlueprintDimensionCheck {axis:string;expected:number;actual:number;tolerance:number;source:'user'|'estimated';matches:boolean;blocksCompletion:boolean}
export type StructuredValidationStage='parts'|'structure'|'dimensions';
export class StructuredValidationError extends AssemblyValidationError {
 constructor(issues:string[],public stage:StructuredValidationStage,public stageIssueCount:number){super(issues);this.name='StructuredValidationError';}
}
export function inspectBlueprintDimensions(plan:ObjectBlueprint,nodes:SceneNode[],frame?:{origin:[number,number,number];yaw:number}):BlueprintDimensionCheck[]{
 if(!plan.dimensions)return [];
 let local=nodes;
 if(frame){const inverse=new Matrix4().compose(new Vector3(...frame.origin),new Quaternion().setFromEuler(new Euler(0,frame.yaw*Math.PI/180,0)),new Vector3(1,1,1)).invert();local=nodes.map(n=>{const p=new Vector3(),q=new Quaternion(),scale=new Vector3();nodeMatrix(n).premultiply(inverse).decompose(p,q,scale);return {...n,transform:{position:p.toArray() as [number,number,number],rotationQuaternion:q.toArray() as [number,number,number,number],scale:scale.toArray() as [number,number,number]}};});}
 const size=assemblyBounds(local).getSize(new Vector3()).toArray(),source=plan.dimensionsSource??'user';
 return Object.entries(plan.dimensions).map(([axis,expected])=>{const actual=size[['x','y','z'].indexOf(axis)],tolerance=Math.max(.002,expected*.02),matches=Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance;return {axis,expected,actual,tolerance,source,matches,blocksCompletion:source==='user'&&!matches};});
}
export function validateBlueprintDimensions(plan:ObjectBlueprint,nodes:SceneNode[],frame?:{origin:[number,number,number];yaw:number}):void{
 const issues=inspectBlueprintDimensions(plan,nodes,frame).filter(check=>check.blocksCompletion).map(check=>`整体${check.axis}轴尺寸${check.actual.toFixed(4)}m与用户声明${check.expected}m不符（容差2%或2mm）；请调整真实几何，不要仅修改验收文字`);
 if(issues.length)throw new StructuredValidationError(issues,'dimensions',issues.length);
}
export function validateStructuredRecipe(plan:ObjectBlueprint,definition:AssemblyDefinition,features:FeatureParts[],requiredKeys?:string[]):void{
 validateBlueprints([plan]);if(!Array.isArray(definition.parts)||!definition.parts.length||definition.parts.length>100)throw Error('单体需1–100条部件定义');let expanded=0,bytes=0;for(const p of definition.parts){const n=p.repeat?.count??1;if(!Number.isSafeInteger(n)||n<1||n>STRUCTURED_PART_LIMIT)throw Error('repeat.count需为1–1000整数');expanded+=n;bytes+=new TextEncoder().encode(JSON.stringify(p)).length*n;if(expanded>STRUCTURED_PART_LIMIT||bytes>STRUCTURED_BYTES_LIMIT)throw Error(`单体展开超过1000零件或${STRUCTURED_BYTES_LIMIT/(1024*1024)}MB预算，保留要求的数量，按真实组件分批生成；不要截断或减少数量`);}
 const issues:string[]=[],partIssues:string[]=[],dimensionIssues:string[]=[];let localNodes:SceneNode[]|undefined;
 // Bindings and method compatibility do not depend on successful mesh construction.
 if(new Set(definition.parts.map(p=>p.name)).size!==definition.parts.length)issues.push('部件名称必须唯一，重复件请使用repeat');
 const required=requiredKeys??plan.features.map(f=>f.key);
 if(!required.length||new Set(required).size!==required.length||required.some(k=>!plan.features.some(f=>f.key===k)))issues.push('待修复特征不存在或重复');
 if(!Array.isArray(features)||features.length!==required.length||features.some(f=>!required.includes(f.key))||new Set(features.map(f=>f.key)).size!==features.length)issues.push('必须覆盖全部规划特征，不能遗漏或重复');
 const lookup=new Map(definition.parts.map(part=>[part.name,part]));
 for(const feature of Array.isArray(features)?features:[]){
  const spec=plan.features.find(f=>f.key===feature.key);
  if(!spec||!Array.isArray(feature.partNames)||!feature.partNames.length||feature.partNames.length>100||new Set(feature.partNames).size!==feature.partNames.length||feature.partNames.some(name=>!lookup.has(name))){issues.push('特征必须引用本单体真实且不重复的部件名称');continue;}
  const linked=feature.partNames.flatMap(name=>{const part=lookup.get(name)!;return Array.from({length:part.repeat?.count??1},()=>({geometry:part.geometry} as SceneNode));});
  if(linked.length>STRUCTURED_PART_LIMIT){issues.push('每项特征最多关联1000个展开部件');continue;}
  if(!matchesGeometryApproach(spec.geometryApproach,linked))issues.push(`特征“${spec.name}”规划为${spec.geometryApproach}，实际造型方法不匹配（关联${linked.length}件：${[...new Set(linked.map(node=>node.geometry?.type))].join('、')}）；${spec.geometryApproach==='assembly'?'assembly表示至少两个真实独立零件；若实际为一个连续实体，请用plan_object_structure保持特征key/name/role，明确改为匹配的profile/lathe/sweep/mesh方案，再重新调用构建。':'请修改实际几何，或按真实用途明确修订方案，不能只改标签。'}`);
 }
 try{localNodes=buildAssembly({...definition,position:[0,0,0],yaw:0});}catch(error){partIssues.push(...(error instanceof AssemblyValidationError?error.issues:[error instanceof Error?error.message:String(error)]));}
 if(localNodes&&!requiredKeys){try{validateBlueprintDimensions(plan,localNodes);}catch(error){dimensionIssues.push(...(error instanceof AssemblyValidationError?error.issues:[error instanceof Error?error.message:String(error)]));}}
 const all=[...partIssues,...issues,...dimensionIssues];
 if(all.length){const stage:StructuredValidationStage=partIssues.length?'parts':issues.length?'structure':'dimensions';throw new StructuredValidationError([...all,...(partIssues.length&&plan.dimensions?['整体尺寸须在部件几何修正后测量；当前尚未执行，不代表已符合声明。']:[])],stage,stage==='parts'?partIssues.length:stage==='structure'?issues.length:dimensionIssues.length);}
}
export function structuredFeatureBinding(doc:SceneDocument,beforeIds:Set<string>,plan:ObjectBlueprint,definition:AssemblyDefinition,features:FeatureParts[]):FeatureBinding{
 const nodes=doc.nodes.filter(n=>!beforeIds.has(n.id));if(nodes.length!==definition.parts.reduce((n,p)=>n+(p.repeat?.count??1),0)||new Set(nodes.map(n=>n.assemblyId)).size!==1)throw Error('生成结果与单体结构数量或分组不一致');
 const lookup=new Map<string,string[]>();let cursor=0;for(const part of definition.parts){const count=part.repeat?.count??1;lookup.set(part.name,nodes.slice(cursor,cursor+count).map(n=>n.id));cursor+=count;}
 const binding={blueprintKey:plan.key,componentId:nodes[0].assemblyId??nodes[0].id,features:features.map(f=>({key:f.key,nodeIds:f.partNames.flatMap(n=>lookup.get(n)!)}))};validateFeatureBindings(doc,[plan],[binding]);return binding;
}

export function withStructuredParts(plan:ObjectBlueprint,definition:AssemblyDefinition,features:FeatureParts[]):AssemblyDefinition{return {...definition,blueprint:plan,parts:definition.parts.map(p=>({...p,structureFeatures:features.filter(f=>f.partNames.includes(p.name)).map(f=>f.key)}))};}
export function restoreModelStructure(doc:SceneDocument){
 const plans=new Map<string,ObjectBlueprint>(),conflicts=new Set<string>();for(const n of doc.nodes){const p=n.modelStructure?.blueprint;if(!p)continue;try{validateBlueprints([p]);}catch{continue;}if(plans.has(p.key)&&JSON.stringify(plans.get(p.key))!==JSON.stringify(p))conflicts.add(p.key);else plans.set(p.key,p);}
 for(const key of conflicts)plans.delete(key);const blueprints=[...plans.values()].slice(0,24),bindings:FeatureBinding[]=[];
 const groups=new Map<string,SceneNode[]>();for(const n of doc.nodes)if(n.modelStructure){const id=n.assemblyId??n.id;groups.set(id,[...(groups.get(id)??[]),n]);}
 for(const [componentId,nodes] of groups)for(const p of blueprints){const members=nodes.filter(n=>n.modelStructure?.blueprintKey===p.key);if(!members.length)continue;const features=p.features.map(f=>({key:f.key,nodeIds:members.filter(n=>n.modelStructure!.featureKeys.includes(f.key)).map(n=>n.id)})).filter(f=>f.nodeIds.length&&f.nodeIds.length<=STRUCTURED_PART_LIMIT);if(features.length&&bindings.length<128)bindings.push({blueprintKey:p.key,componentId,features});}
 return {blueprints,bindings,conflicts:[...conflicts]};
}

export function structureFrame(nodes:SceneNode[]):{origin:[number,number,number];yaw:number}{
 if(!nodes.length||nodes.some(n=>!n.modelStructure?.localTransform))throw Error('无法确定单体局部坐标，请明确origin与yaw，不猜测');
 const frames=nodes.map(n=>{const t=n.modelStructure!.localTransform!;return nodeMatrix(n).multiply(new Matrix4().compose(new Vector3(...t.position),new Quaternion(...t.rotationQuaternion),new Vector3(...t.scale)).invert());});
 const first=frames[0];if(frames.some(m=>m.elements.some((v,i)=>Math.abs(v-first.elements[i])>1e-5)))throw Error('单体部件相对姿态已改变，请明确本次重建的origin与yaw');
 const p=new Vector3(),q=new Quaternion(),scale=new Vector3();first.decompose(p,q,scale);const e=new Euler().setFromQuaternion(q,'YXZ');if(scale.toArray().some(n=>Math.abs(n-1)>1e-5)||Math.abs(e.x)>1e-5||Math.abs(e.z)>1e-5)throw Error('单体有缩放或倾斜，请明确重建坐标，不能按平面刚体猜测');
 return {origin:p.toArray() as [number,number,number],yaw:e.y*180/Math.PI};
}

/** Persist explicit real-node bindings for models created through ordinary edit/import tools. */
export function persistFeatureBinding(doc:SceneDocument,plan:ObjectBlueprint,binding:FeatureBinding):SceneNode[]{
 validateBlueprints([plan]);validateFeatureBindings(doc,[plan],[binding]);
 const members=doc.nodes.filter(n=>(n.assemblyId??n.id)===binding.componentId);
 if(members.some(n=>n.parentId!==null))throw Error('结构关联仅支持平级组件，请先明确层级变换');
 if(members.some(n=>n.modelStructure&&n.modelStructure.blueprintKey!==plan.key))throw Error('该组件已关联其他结构方案，不能隐式覆盖');
 const preserveFrame=members.every(n=>n.modelStructure?.blueprintKey===plan.key&&n.modelStructure.localTransform);
 const bounds=assemblyBounds(members);if(bounds.isEmpty())throw Error('无法建立结构局部坐标');
 const origin=[(bounds.min.x+bounds.max.x)/2,bounds.min.y,(bounds.min.z+bounds.max.z)/2];
 const updates=new Map(members.map((n,i)=>{const localTransform=preserveFrame?structuredClone(n.modelStructure!.localTransform!):{...structuredClone(n.transform),position:n.transform.position.map((v,k)=>v-origin[k]) as [number,number,number]};return [n.id,{...n,modelStructure:{blueprintKey:plan.key,featureKeys:binding.features.filter(f=>f.nodeIds.includes(n.id)).map(f=>f.key),localTransform,...(i===0?{blueprint:structuredClone(plan)}:{})}}];}));
 return doc.nodes.map(n=>updates.get(n.id)??n);
}
