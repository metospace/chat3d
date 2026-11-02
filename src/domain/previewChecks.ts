export type PreviewCheckKind='shape'|'structure'|'connection'|'material'|'label'|'overall';
export const CHECK_GUIDES:Record<PreviewCheckKind,{title:string;method:string;limit:string}>={
 shape:{title:'外形与比例',method:'对照参考图，查看正面、侧面和斜侧面；比较外轮廓、分区高度、凹凸曲面及开口位置。需要精确尺寸时，在属性面板查看选中对象尺寸。',limit:'视角、遮挡和拍摄透视会影响观感。原图未给尺寸时，只能核对比例。'},
 structure:{title:'功能结构',method:'展开结构列表，检查图中可见的导轨、链条、支架和工作部件是否齐全，再从侧面检查前后层次与安装关系。',limit:'部件数量或命名正确不代表造型正确。看不到的背面结构需要补充资料。'},
 connection:{title:'连接与接触',method:'放大连接位置，从两个方向检查是否悬空、穿插、断开或偏离安装面；尤其检查支架端部和部件接缝。',limit:'画面检查不能替代实际装配、公差、强度或制造验收。'},
 material:{title:'材质与表面',method:'在实时三维画面中旋转模型，观察主色、金属反射、粗糙度和表面层次；用相近光照下的参考图对比。',limit:'软件几何预览不能验证材质，光照差异也不能直接当成配色错误。'},
 label:{title:'文字与标识',method:'打开原始参考图并放大对应区域，检查文字、警示图案的位置、方向和可读性。',limit:'原图模糊或文字不可辨认时，需补充清晰局部图，不能猜测品牌或标识内容。'},
 overall:{title:'综合检查',method:'按外形、结构、连接、材质、细节及场景关系逐项对照。已有明确差异应先修正，再检查其余未知项。',limit:'“尚未完成验收”表示证据不足，不等于每一项都错误，也不代表已经通过。'},
};
export function previewChecks(issues:string[],summary=''){
 const marker=summary.search(/\n(?:仍需改进|已知问题|细节验收未完成)[：:]/);
 const summaryIssues=marker<0?[]:summary.slice(marker).replace(/^\s*(?:仍需改进|已知问题|细节验收未完成)[：:]/,'').split(/[；;\n]+/);
 return [...new Set([...issues,...summaryIssues].map(text=>text.trim()).filter(Boolean))].map((text,index)=>{
  const kind:PreviewCheckKind=/文字|标识|标牌|字样|可读|警示/.test(text)?'label':/材质|配色|反射|粗糙|纹理/.test(text)?'material':/连接|接触|悬空|穿插|支架|链条端/.test(text)?'connection':/轮廓|曲面|比例|凹|凸|外形|形状|尺寸/.test(text)?'shape':/门架|导轨|链条|滑架|货叉|结构|开口/.test(text)?'structure':'overall';
  const reportedDifference=/未(?:还原|实现|生成|补齐)|缺失|不足|不清晰|不符合|差异|与.{0,24}(?:不同|不符)/.test(text);
  return {id:String(index),text,kind,reportedDifference};
 });
}
