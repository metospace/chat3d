import {Type, type TSchema} from 'typebox';
import {Check, Errors} from 'typebox/value';
import type {Command} from '../domain/commands';
import {SCENE_ROLES, validateGeometry, validateQuaternion, type Geometry, type Quaternion} from '../domain/types';
import {PHYSICAL_MATERIAL_LIMITS} from '../domain/physicalMaterial';
import {STRUCTURED_PART_LIMIT} from '../domain/structureLimits';
import {structuredGeometrySchema} from './structuredGeometrySchema';

export interface CommandIssue {path:(string|number)[];code:string;message:string;expected?:string}
type Schema=TSchema & {type?:string;properties?:Record<string,Schema>;required?:string[];items?:Schema|Schema[]|boolean;prefixItems?:Schema[];anyOf?:Schema[];allOf?:Schema[];oneOf?:Schema[];const?:unknown;description?:string;additionalProperties?:boolean;minimum?:number;maximum?:number;exclusiveMinimum?:number;exclusiveMaximum?:number;minLength?:number;maxLength?:number;pattern?:string;minItems?:number;maxItems?:number;multipleOf?:number};
const text=(maxLength?:number)=>Type.String({minLength:1,pattern:'\\S',...(maxLength===undefined?{}:{maxLength})});
const number=()=>Type.Number();
const vec3=()=>Type.Tuple([number(),number(),number()]);
const scale=()=>Type.Tuple([Type.Number({exclusiveMinimum:0}),Type.Number({exclusiveMinimum:0}),Type.Number({exclusiveMinimum:0})]);
const quaternion=()=>Type.Tuple([number(),number(),number(),number()],{description:'Normalized quaternion [x,y,z,w], norm within 0.001 of 1.'});
const strings=()=>Type.Array(text(),{minItems:1});
const optional=Type.Optional;
const object=(properties:Record<string,TSchema>,description?:string,options:Record<string,unknown>={})=>Type.Object(properties,{additionalProperties:false,...options,...(description?{description:[description,options.description].filter(Boolean).join(' ')}:{})});
const atLeastOne=(keys:string[])=>({anyOf:keys.map(key=>({required:[key]})),description:'Provide at least one of: '+keys.join(', ')});
const exactlyOne=(keys:string[])=>({oneOf:keys.map(key=>({required:[key]})),description:'Provide exactly one of: '+keys.join(', ')});
const transformFields={position:optional(vec3()),rotationQuaternion:optional(quaternion()),scale:optional(scale())};
const createTransform=object({...transformFields,rotationDegrees:optional(vec3())},'Optional components default to origin, identity rotation and unit scale; quaternion takes precedence over rotationDegrees.');
const transformPatch=object(transformFields,'Absolute transform patch; omitted components are unchanged.',{...atLeastOne(Object.keys(transformFields))});

// Reuse the geometry contract, closing all object records and excluding manual mesh imports.
function closedGeometry(schema:Schema):Schema {
 const result:Schema={...schema};
 if(schema.properties){result.additionalProperties=false;result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,closedGeometry(value)]));}
 if(schema.anyOf)result.anyOf=schema.anyOf.filter(branch=>branch.properties?.type?.const!=='mesh').map(closedGeometry);
 if(Array.isArray(schema.items))result.items=schema.items.map(closedGeometry);
 else if(schema.items&&typeof schema.items==='object')result.items=closedGeometry(schema.items);
 if(schema.prefixItems)result.prefixItems=schema.prefixItems.map(closedGeometry);
 return result;
}
const geometry=closedGeometry(structuredGeometrySchema as Schema);
const part=object({name:text(100),geometry,materialId:optional(text()),label:optional(Type.String({maxLength:80})),transform:optional(createTransform),repeat:optional(object({count:Type.Integer({minimum:1,maximum:STRUCTURED_PART_LIMIT}),step:vec3()}))},'A local assembly part. Omitted transform components and material use creation defaults.');
const parts=Type.Array(part,{minItems:1,maxItems:100,description:'1–100 definitions; expanded repeats must total no more than 2000 parts.'});
const sceneRole=Type.Union(SCENE_ROLES.map(role=>Type.Literal(role)));
const metadata={sceneRole:optional(sceneRole),planKey:optional(Type.String({maxLength:120})),zone:optional(Type.String({maxLength:120}))};
const target={targetId:text()};
const appearanceFields={baseColor:optional(Type.String({pattern:'^#[0-9a-fA-F]{6}$'})),roughness:optional(Type.Number({minimum:0,maximum:1})),metalness:optional(Type.Number({minimum:0,maximum:1})),opacity:optional(Type.Number({minimum:0,maximum:1})),materialId:optional(text()),...Object.fromEntries(Object.entries(PHYSICAL_MATERIAL_LIMITS).map(([key,[minimum,maximum]])=>[key,optional(Type.Number({minimum,maximum}))]))};

const motionNumber=()=>Type.Number({minimum:-1e6,maximum:1e6});
const motionVector=()=>Type.Tuple([motionNumber(),motionNumber(),motionNumber()]);
const expressionOps=['add','sub','mul','div','mod','sin','cos','abs','min','max','clamp','gt','lt','if'] as const;
const expression=Type.Union([motionNumber(),Type.Literal('t'),Type.Literal('pi'),object({op:Type.Union(expressionOps.map(op=>Type.Literal(op))),args:Type.Array(Type.Unknown(),{minItems:1,maxItems:3})},'Bounded mathematical AST. Nested args are validated by the animation domain validator (depth ≤8, ≤64 nodes and operator-specific arity).')]);
const trackBase={id:text(120),name:Type.String({maxLength:120}),targetIds:Type.Array(text(),{minItems:1,maxItems:512})};
const keyframes=(value:TSchema)=>Type.Array(object({time:Type.Number({minimum:0,maximum:3600}),value}),{minItems:1,maxItems:128});
const motionTrack=(channel:'position'|'scale'|'rotation')=>object({...trackBase,channel:Type.Literal(channel),keyframes:optional(keyframes(channel==='rotation'?motionNumber():channel==='scale'?scale():motionVector())),expression:optional(channel==='rotation'?expression:Type.Tuple([expression,expression,expression])),...(channel==='rotation'?{axis:motionVector(),pivot:motionVector()}:{})},'Motion track; exactly one of keyframes or expression. Expressions allow depth ≤8 and ≤64 nodes; operator arity and timeline/reference relationships are checked on apply.',exactlyOne(['keyframes','expression']));
const animation=object({version:Type.Literal(1),name:text(120),duration:Type.Number({exclusiveMinimum:0,maximum:3600}),loop:Type.Boolean(),tracks:Type.Array(Type.Union([motionTrack('position'),motionTrack('scale'),motionTrack('rotation'),object({...trackBase,channel:Type.Literal('visibility'),keyframes:keyframes(Type.Boolean())}),object({...trackBase,channel:Type.Literal('follow'),sourceId:text(),start:Type.Number({minimum:0,maximum:3600}),end:Type.Number({minimum:0,maximum:3600})})]),{minItems:1,maxItems:128})},'Complete animation replacement. Dynamic references, time ordering, channel conflicts, expression arity and follow dependencies remain validated atomically by applyBatch.');
const contract=<Name extends Command['op']>(op:Name,fields:Record<string,TSchema>,description:string,options:Record<string,unknown>={})=>object({op:Type.Literal(op),...fields},description,options);

/** The public AI operation registry. Manual-only domain commands are intentionally absent. */
export const commandContracts={
 createPrimitive:contract('createPrimitive',{tempId:optional(text()),name:optional(text()),parentId:optional(Type.Null()),geometry,materialId:optional(text()),transform:optional(createTransform)},'Create a primitive; geometry required. Omitted name, material and transform retain creation defaults.'),
 createAssembly:contract('createAssembly',{tempId:optional(text()),name:text(120),position:optional(vec3()),yaw:optional(number()),parts,...metadata},'Create an assembly from named local parts; name and parts required. Placement defaults to origin/yaw 0.'),
 duplicateAssembly:contract('duplicateAssembly',{...target,offset:vec3(),name:optional(text()),tempId:optional(text())},'Duplicate a whole assembly; targetId and world offset required.'),
 translateAssembly:contract('translateAssembly',{...target,value:vec3()},'Move a whole assembly; targetId and world delta value required (not offset, delta, position or assemblyId).'),
 transformAssembly:contract('transformAssembly',{...target,rotationDegrees:optional(vec3()),scaleFactor:optional(Type.Number({minimum:.001,maximum:1000})),pivot:optional(vec3())},'Rotate and/or uniformly scale an assembly; targetId plus rotationDegrees or scaleFactor required.',atLeastOne(['rotationDegrees','scaleFactor'])),
 appendAssemblyParts:contract('appendAssemblyParts',{...target,parts,origin:optional(vec3()),yaw:optional(number())},'Append local parts to target assembly. origin is a world position, default origin/yaw 0.'),
 replaceAssemblyParts:contract('replaceAssemblyParts',{...target,partIds:strings(),parts,origin:optional(vec3()),yaw:optional(number())},'Replace only the listed partIds; targetId, nonempty partIds and parts required.'),
 updateParameters:contract('updateParameters',{...target,geometry:optional(geometry),name:optional(text())},'Replace geometry and/or name; targetId plus geometry or name required.',atLeastOne(['geometry','name'])),
 setTransform:contract('setTransform',{...target,transform:transformPatch},'Set explicit absolute transform components; targetId and a nonempty transform patch required.'),
 translate:contract('translate',{...target,value:vec3(),space:optional(Type.Literal('world')),mode:optional(Type.Union([Type.Literal('set'),Type.Literal('delta')]))},'Translate targetId by value; space defaults to world and mode to delta. mode set uses an absolute world position.'),
 rename:contract('rename',{...target,name:text()},'Rename targetId; nonempty name required.'),
 setVisibility:contract('setVisibility',{...target,visible:Type.Boolean()},'Set target visibility; visible is a required boolean, not a default.'),
 delete:contract('delete',{targetId:optional(text()),targetIds:optional(strings()),scope:optional(Type.Literal('assembly'))},'Delete exactly one targetId or nonempty targetIds; scope assembly deletes whole assemblies.',exactlyOne(['targetId','targetIds'])),
 setMaterial:contract('setMaterial',{...target,materialId:text()},'Assign an existing material; targetId and nonempty materialId required. Unknown material references fail on apply, never fall back.'),
 setAppearance:contract('setAppearance',{...target,scope:optional(Type.Literal('assembly')),sourceMaterialIds:optional(strings()),...appearanceFields},'Patch appearance; targetId plus at least one appearance/material field required. Scope/filter alone is not a change.',atLeastOne(Object.keys(appearanceFields))),
 setAssemblyMetadata:contract('setAssemblyMetadata',{...target,...metadata},'Patch design metadata; targetId plus sceneRole, planKey or zone required.',atLeastOne(Object.keys(metadata))),
 setAnimation:contract('setAnimation',{animation},'Replace animation with a typed version-1 animation program.'),
 clearAnimation:contract('clearAnimation',{},'Remove animation; accepts only op.'),
} satisfies Partial<Record<Command['op'],TSchema>>;
export type AICommandOp=keyof typeof commandContracts;
export type AICommand=Extract<Command,{op:AICommandOp}>;
export const commandNames=Object.keys(commandContracts) as AICommandOp[];
export const commandSchema=Type.Union(Object.values(commandContracts),{description:'Scene edit operation. Every operation requires op and its command-specific fields. Unknown fields are rejected. A batch with any invalid operation is rejected atomically.'});
/** Useful when a tool validator reports only a union failure: op stays independently required. */
export const commandEnvelopeSchema=Type.Intersect([Type.Object({op:Type.Union(commandNames.map(op=>Type.Literal(op)))}),commandSchema]);

const objectInput=Type.Object({}, {additionalProperties:true});
function expected(schema:Schema):string {
 if(schema.description)return schema.description;
 if(schema.const!==undefined)return JSON.stringify(schema.const);
 if(schema.anyOf)return schema.anyOf.map(expected).join(' or ');
 const constraints=(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','pattern','minItems','maxItems','multipleOf'] as const).filter(key=>schema[key]!==undefined).map(key=>`${key}=${String(schema[key])}`);
 return [schema.type??'valid value',...constraints].join('; ');
}

/** Schema-driven traversal validates each node independently, avoiding TypeBox's per-call error cap
 * and irrelevant errors from every branch of a discriminated union. No issue limit is applied here.
 */
function schemaIssues(schema:Schema,value:unknown,path:(string|number)[],issues:CommandIssue[]):void {
 if(schema.anyOf&&!schema.properties){
  const branches=schema.anyOf;
  // Discriminate objects using literal fields; otherwise choose an already-valid branch.
  const input=Check(objectInput,value)?value as Record<string,unknown>:undefined;
  const discriminator=branches[0]?.properties&&Object.keys(branches[0].properties).find(key=>branches.every(candidate=>candidate.properties?.[key]?.const!==undefined));
  if(input&&discriminator&& !branches.some(candidate=>candidate.properties?.[discriminator]?.const===input[discriminator])){
   const first=branches[0].properties!;
   const common=Object.fromEntries(Object.entries(first).filter(([key])=>branches.every(candidate=>candidate.properties?.[key]!==undefined)).map(([key,field])=>[key,key===discriminator?Type.Union(branches.map(candidate=>candidate.properties![key])):key==='params'?Type.Object({}, {additionalProperties:true}):field]));
   const required=(branches[0].required??[]).filter(key=>branches.every(candidate=>candidate.required?.includes(key)));
   schemaIssues({type:'object',properties:common,required},value,path,issues);return;
  }
  const branch=input?branches.find(candidate=>candidate.properties&&Object.entries(candidate.properties).some(([key,field])=>field.const!==undefined&&input[key]===field.const)):undefined;
  const valid=branch??branches.find(candidate=>Check(candidate,value));
  if(valid){schemaIssues(valid,value,path,issues);return;}
  const matching=branches.filter(candidate=>candidate.type===(Array.isArray(value)?'array':typeof value));
  if(matching.length===1){schemaIssues(matching[0],value,path,issues);return;}
  issues.push({path,code:'anyOf',message:'Value does not match an allowed shape.',expected:expected(schema)});return;
 }
 const shallow:Schema={...schema};
 if(schema.properties)shallow.properties=Object.fromEntries(Object.keys(schema.properties).map(key=>[key,{}]));
 if(schema.prefixItems)shallow.prefixItems=schema.prefixItems.map(()=>({}));
 if(Array.isArray(schema.items))shallow.items=schema.items.map(()=>({}));
 else if(schema.items&&typeof schema.items==='object')shallow.items={};
 // Logical required groups are intentionally evaluated by the schema library, then summarized once.
 const errors=Errors(shallow,value);
 const groupFailed=errors.some(error=>error.keyword==='anyOf'||error.keyword==='oneOf');
 for(const error of errors){
  if(groupFailed&&/\/(anyOf|oneOf)\//.test(error.schemaPath))continue;
  if(error.keyword==='required'){
   const keys=error.params.requiredProperties;
   for(const key of keys)issues.push({path:[...path,key],code:'required',message:'Required field is missing.',expected:expected(schema.properties?.[key]??{})});
  }else if(error.keyword==='additionalProperties'){
   for(const key of error.params.additionalProperties)issues.push({path:[...path,key],code:'additionalProperties',message:'Unknown field; use only documented fields for this operation.',expected:Object.keys(schema.properties??{}).join(', ')});
  }else{
   const group=error.keyword==='anyOf'||error.keyword==='oneOf';
   const alternatives=group?(schema.oneOf??schema.anyOf)?.flatMap(branch=>branch.required??[]):undefined;
   const input=Check(objectInput,value)?value as Record<string,unknown>:undefined;
   const missingSelector=error.keyword==='oneOf'&&alternatives?.length===2&&alternatives.includes('targetId')&&input&&input.targetId===undefined&&input.targetIds===undefined;
   const relativePath=error.instancePath.split('/').slice(1).map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~')).map(key=>/^\d+$/.test(key)?Number(key):key);
   issues.push({path:[...path,...relativePath,...(missingSelector?['targetId']:[])],code:error.keyword,message:group?'Required field alternative is not satisfied.':error.message,expected:expected(schema)});
  }
 }
 if(schema.properties&&Check(objectInput,value)){
  const input=value as Record<string,unknown>;
  for(const [key,child] of Object.entries(schema.properties))if(Object.prototype.hasOwnProperty.call(input,key))schemaIssues(child,input[key],[...path,key],issues);
 }
 if(Array.isArray(value)){
  if(schema.prefixItems)for(let index=0;index<Math.min(value.length,schema.prefixItems.length);index++)schemaIssues(schema.prefixItems[index],value[index],[...path,index],issues);
  if(Array.isArray(schema.items))for(let index=0;index<Math.min(value.length,schema.items.length);index++)schemaIssues(schema.items[index],value[index],[...path,index],issues);
  else if(schema.items&&typeof schema.items==='object')for(let index=schema.prefixItems?.length??0;index<value.length;index++)schemaIssues(schema.items,value[index],[...path,index],issues);
 }
}
function relationalIssues(value:unknown,path:(string|number)[],issues:CommandIssue[]):void {
 if(Array.isArray(value)){value.forEach((child,index)=>relationalIssues(child,[...path,index],issues));return;}
 if(!Check(objectInput,value))return;
 const input=value as Record<string,unknown>;
 if(Check(geometry,input.geometry)){
  for(const error of validateGeometry(input.geometry as Geometry))issues.push({path:[...path,'geometry'],code:'geometry',message:error.message,expected:'Geometry parameters must satisfy relational shape constraints.'});
 }
 if(Array.isArray(input.rotationQuaternion)&&Check(quaternion(),input.rotationQuaternion))for(const _error of validateQuaternion(input.rotationQuaternion as Quaternion,'rotationQuaternion'))issues.push({path:[...path,'rotationQuaternion'],code:'quaternion',message:'Quaternion must be normalized (norm within 0.001 of 1).',expected:'Normalized [x,y,z,w] quaternion.'});
 if(Array.isArray(input.parts)){
  let total=0;
  for(const child of input.parts)if(Check(part,child)){
   const definition=child as {repeat?:{count:number}};
   total+=definition.repeat?.count??1;
  }
  if(total>2000)issues.push({path:[...path,'parts'],code:'partBudget',message:'Expanded assembly exceeds 2000 parts.',expected:'Sum of repeat.count (or 1 for unrepeated parts) ≤2000.'});
 }
 for(const [key,child] of Object.entries(input))if(key!=='geometry')relationalIssues(child,[...path,key],issues);
}

/** Validate all operations and all nested fields without mutating, cleaning or allocating geometry.
 * Dynamic IDs, material existence, dependency order and animation relationships remain applyBatch's job.
 * Returns every discovered issue in deterministic operation/schema order, without silent truncation.
 */
export function validateCommandOperations(operations:unknown):CommandIssue[]{
 const issues:CommandIssue[]=[];
 if(!Array.isArray(operations))return [{path:['operations'],code:'type',message:'operations must be an array.',expected:'Array of supported scene edit operations.'}];
 for(let index=0;index<operations.length;index++){
  const raw=operations[index],path=['operations',index];
  if(!Check(objectInput,raw)){issues.push({path,code:'type',message:'Operation must be an object.',expected:'Object with a supported op and its fields.'});continue;}
  const value=raw as Record<string,unknown>;
  if(typeof value.op!=='string'||!Object.prototype.hasOwnProperty.call(commandContracts,value.op)){
   issues.push({path:[...path,'op'],code:value.op===undefined?'required':'operation',message:value.op===undefined?'Required field is missing.':'Unsupported operation name.',expected:commandNames.join(', ')});
   for(const key of Object.keys(value))if(['action','type','name'].includes(key))issues.push({path:[...path,key],code:'operationField',message:'This field cannot substitute for the required op discriminator.',expected:'op'});
   continue;
  }
  schemaIssues(commandContracts[value.op as AICommandOp] as Schema,value,path,issues);
  relationalIssues(value,path,issues);
 }
 return issues;
}

/** All issues remain available on CommandContractError. Human-readable output is explicitly bounded. */
export function formatCommandIssues(issues:readonly CommandIssue[],maxIssues=100):string {
 const limit=Math.max(1,Math.floor(maxIssues)||100),shown=issues.slice(0,limit);
 const lines=shown.map(issue=>`${issue.path.map((part,index)=>typeof part==='number'?`[${part}]`:index?`.${part}`:part).join('')}: ${issue.message}${issue.expected?` Expected: ${issue.expected}`:''}`);
 return `Command validation failed: ${issues.length} issue(s); showing ${shown.length}; omitted ${issues.length-shown.length}. No operations applied.\n${lines.join('\n')}`;
}
export class CommandContractError extends Error {
 readonly totalIssues:number;
 constructor(readonly issues:CommandIssue[]){super(formatCommandIssues(issues));this.name='CommandContractError';this.totalIssues=issues.length;}
}
/** Compact prompt guidance generated from the same registry, not a second command list. */
export function commandContractGuide():string {
 return commandNames.map(name=>{const schema=commandContracts[name] as Schema;return `${name}: required ${schema.required?.join(', ')??'op'}. ${schema.description??''}`;}).join('\n');
}
