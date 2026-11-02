import type {SceneDocument,SceneNode,Vec3} from './types';
import {applyBatch,type Command,type CommandBatch} from './commands';
import {checkEditScope,type EditScope} from './editScope';
import {makeId} from '../util/ids';
/** Deliberately narrow, whole-string grammar. Ambiguous or compound instructions go to the real model. */
export function quickEdit(text:string,doc:SceneDocument,selection:string[],scope?:EditScope){
 const source=text.trim().replace(/[。！!]$/,'');
 if(/[?？]|不要|别|如果|或者|还是|并且|然后|先|再|动画|标牌|文字/.test(source))return null;
 const colors:Record<string,string>={红色:'#ef4444',蓝色:'#3b82f6',绿色:'#22c55e',黄色:'#eab308',白色:'#ffffff',黑色:'#111111',灰色:'#a5abb4',深灰色:'#41474f'};
 const target=(name:string):{node:SceneNode;assembly:boolean}|null=>{
  name=name.trim().replace(/^(?:请)?(?:只)?(?:把|将)?/,'').replace(/^刚才的?/,'').trim();
  if(/^(?:当前)?选中(?:的)?(?:对象|零件)?$/.test(name))return selection.length===1?{node:doc.nodes.find(n=>n.id===selection[0])!,assembly:false}:null;
  const assemblies=new Map<string,SceneNode>();for(const n of doc.nodes)if(n.assemblyId&&(n.assemblyName===name||n.name.split(' · ')[0]===name))assemblies.set(n.assemblyId,n);
  if(assemblies.size===1)return {node:[...assemblies.values()][0],assembly:true};
  const nodes=doc.nodes.filter(n=>n.name===name||n.name.split(' · ').slice(-1)[0]===name||(n.assemblyName&&[n.assemblyName+'的'+n.name.split(' · ').slice(-1)[0],n.assemblyName+n.name.split(' · ').slice(-1)[0]].includes(name)));
  return nodes.length===1?{node:nodes[0],assembly:false}:null;
 };
 let operations:Command[]=[];let m:RegExpMatchArray|null;
 if((m=source.match(/^(?:请)?(?:删除|删掉|移除)\s*(.+)$/))){
  const name=m[1].trim();
  if(/^(?:当前)?选中(?:的)?(?:对象|模型|零件|组件)?$/.test(name)){
    if(!selection.length||selection.some(id=>!doc.nodes.some(n=>n.id===id)))return null;
    operations=[{op:'delete',targetIds:[...new Set(selection)]}];
  }else{
    const t=target(name);if(!t?.node)return null;
    operations=[{op:'delete',targetId:t.node.id,...(t.assembly?{scope:'assembly' as const}:{})}];
  }
 }else if((m=source.match(/^(.*?)\s*(?:改成|改为|变成|设为)\s*(红色|蓝色|绿色|黄色|白色|黑色|灰色|深灰色|#[\da-fA-F]{6})(?:[，,]\s*保留(?:所有|全部)?尺寸[、,，]位置和其他零件)?$/))){
  const t=target(m[1]);if(!t?.node)return null;operations=[{op:'setAppearance',targetId:t.node.id,...(t.assembly?{scope:'assembly' as const}:{}),baseColor:colors[m[2]]??m[2]}];
 }else if((m=source.match(/^(.*?)\s*(?:向|往)(左|右|前|后|上|下)(?:移动|挪动|挪|移)\s*(\d+(?:\.\d+)?)\s*(米|厘米|毫米)$/))){
  const t=target(m[1]);if(!t?.node)return null;const v=Number(m[3])*(m[4]==='厘米'?.01:m[4]==='毫米'?.001:1);if(v<=0||v>100)return null;
  const dirs:Record<string,Vec3>={左:[-v,0,0],右:[v,0,0],前:[0,0,v],后:[0,0,-v],上:[0,v,0],下:[0,-v,0]};
  operations=t.assembly?[{op:'translateAssembly',targetId:t.node.id,value:dirs[m[2]]}]:[{op:'translate',targetId:t.node.id,space:'world',mode:'delta',value:dirs[m[2]]}];
 }else if((m=source.match(/^(.*?)\s*(?:改名为|重命名为)\s*[“「"]([^”」"\n]{1,80})[”」"]$/))){
  const t=target(m[1]);if(!t?.node||t.assembly)return null;operations=[{op:'rename',targetId:t.node.id,name:m[2]}];
 }else if((m=source.match(/^(.*?)的(宽度|高度|深度)(?:改为|设为)\s*(\d+(?:\.\d+)?)\s*(米|厘米|毫米)$/))){
  const t=target(m[1]);if(!t?.node||t.assembly||t.node.geometry?.type!=='box')return null;const v=Number(m[3])*(m[4]==='厘米'?.01:m[4]==='毫米'?.001:1);if(v<=0||v>100)return null;
  const key={宽度:'width',高度:'height',深度:'depth'}[m[2]]!;operations=[{op:'updateParameters',targetId:t.node.id,geometry:{type:'box',params:{...t.node.geometry.params,[key]:v}}}];
 }else return null;
 const batch:CommandBatch={requestId:makeId(),projectId:doc.projectId,baseRevision:doc.revision,selectedIds:[...selection],editScope:scope,taskStatus:'submitted',summary:'明确编辑已完成数据校验（本地执行）。请检查预览后应用；尚未做视觉验收。',operations};
 const result=applyBatch(doc,batch);if(result.errors.length||checkEditScope(doc,result.doc,scope).length)return null;
 if(!operations.every(op=>op.op==='delete')&&JSON.stringify(doc.animation)!==JSON.stringify(result.doc.animation))return null;
 return {batch,result};
}
