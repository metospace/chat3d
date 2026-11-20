import {normalizeContext,type ImageContent,type TextContent} from '@earendil-works/pi-ai';

interface Feature {featureKey:string;name:string;reference:string}

/** A new vision context sees the user's inputs and rendered pixels without the builder's verdict. */
export function referenceComparisonContext(request:string,features:Feature[],references:ImageContent[],frames:{view:string;image:ImageContent}[],phase:'silhouette'|'detailed'='detailed'){
 const content:(TextContent|ImageContent)[]=[{type:'text',text:JSON.stringify({
  request:request.slice(0,1800),phase,
  features:features.map(({featureKey,name,reference})=>({key:featureKey,name,observation:reference})),
 })}];
 for(const [index,image] of references.entries())content.push({type:'text',text:'参考图 '+(index+1)},image);
 for(const [index,frame] of frames.entries())content.push({type:'text',text:`模型图 ${index+1}，${frame.view}`},frame.image);
 return normalizeContext({
  systemPrompt:'独立审核参考图还原度。结合用户要求，将真实参考图与最接近方向的模型图逐项对照。预先记录的观察只用来定位，结论以图像为准。'+(phase==='silhouette'
   ?'当前是未完成的主形阶段。仅核对主体剪影、相对比例、主要体积分区、截面起伏与影响轮廓的关键负空间。key为空的整体项主动发现漏掉的主体比例或曲面差异。允许灰模，忽略尚未制作的灯饰、文字、接缝、紧固件、内饰与材质差异，不能因这些细节缺失判mismatch或unknown；不可把主形缺失当装饰略过。'
   :'key为空的整体项还需主动检查计划漏掉的可见识别特征。关注主轮廓和相对比例、开口凹凸及接合、材质对比和高光。')+'特别区分真实开孔与表面贴片、贴边与悬浮构件、连续曲面与拼接折痕。只记录影响辨识的可见差异，避免用光照和透视差异误判。缺可比方向或资料填unknown。每项给出参考图、模型图编号和具体比较。mismatch须写明确的局部几何或材质修法。仅返回JSON数组，每项格式为 {"key":"特征键","reference":1,"frame":1,"status":"match|mismatch|unknown","difference":"具体比较","repair":"修法，非mismatch可为空"}。',
  messages:[{role:'user',content,timestamp:Date.now()}],
 });
}

export function parseReferenceComparison(text:string,features:Feature[],frameCount:number,referenceCount:number){
 const rows:unknown=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
 if(!Array.isArray(rows)||rows.length!==features.length)throw Error('参考对照记录缺项');
 const expected=new Map(features.map(feature=>[feature.featureKey,feature.name]));
 return rows.map(row=>{
  const {key,status,reference,frame,difference,repair}=row??{};
  const name=expected.get(key);
  if(!name||!['match','mismatch','unknown'].includes(status)||
   !Number.isInteger(reference)||reference<1||reference>referenceCount||
   !Number.isInteger(frame)||frame<1||frame>frameCount||
   typeof difference!=='string'||difference.trim().length<5||difference.length>300||
   (status==='mismatch'&&(typeof repair!=='string'||repair.trim().length<5||repair.length>300)))throw Error('参考对照记录无效');
  expected.delete(key);
  return {status,description:`${name}（参考图 ${reference}、模型图 ${frame}）${difference}${status==='mismatch'?'，修复建议 '+repair:''}`};
 });
}
