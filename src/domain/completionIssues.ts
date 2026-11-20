/** Separate explicit defects from a lack of acceptance evidence; neither implies a pass. */
export function confirmedCompletionIssues(values:string[],reportedDefects=false){
 return [...new Set(values.flatMap(value=>value.split(/[；;，,\n]+/)).map(value=>value.trim()).filter(Boolean))].filter(value=>{
  if(/^(?:无|没有|未发现)(?:明显|新的|已知)?(?:问题|缺陷|差异|异常|穿插)/.test(value))return false;
  if(/原图|参考图/.test(value)&&/模糊|看不清|未提供|无法辨认|分辨率不足/.test(value))return false;
  if(/无法判断|不能判断|无法确认|无法验证|是否|可能|疑似/.test(value)&&!/已确认|明确存在/.test(value))return false;
  const missingImplementation=/未(?:能)?(?:恢复|实现|修复|解决|配置|生成|补齐|还原)|未同步|已确认|明确存在|已发现|仍有/.test(value);
  if(/(?:尚未|未).{0,10}(?:验证|验收|核对)|待核对|待验收|证据不足|(?:缺少|缺失).{0,10}(?:证据|截图|资料)/.test(value)&&!missingImplementation)return false;
  const defect=/未(?:能)?(?:恢复|实现|修复|解决|配置|生成|补齐|还原)|缺失|缺少|错误|不符合|不匹配|不清晰|穿插|悬空|断开|受遮挡|仍.{0,8}遮挡|未同步/.test(value);
  const unfinishedFunction=/(?:动作|流程|轨道|路线|同步|取货|放货|搬运|装卸|升降|转向|转弯|载货|货叉).{0,30}(?:未完成|尚无|没有|未覆盖)|(?:尚无|没有|缺少|未完成).{0,24}(?:动作|流程|轨道|路线|取货|放货|搬运)/.test(value);
  const onlyUnverified=/待核对|待验收|尚未.*验收|尚未.*验证|证据不足|缺少.*证据/.test(value);
  return defect||unfinishedFunction||(reportedDefects&&!onlyUnverified);
 });
}

/** A stated, visible reference mismatch on the shape is still open when
 * reported in observations or remaining issues rather than the issues field. */
export function reportedReferenceShapeIssues(values:string[]):string[]{
 const shape=/轮廓|剪影|比例|曲率|弧度|曲面|截面|收口|过渡|接缝|开口|凹腔|孔位|尺寸|结构|silhouette|proportion|curvature|contour|cross.section|opening/i;
 const reference=/参考|原图|照片|素材|图\s*[0-9一二三四五六七八九]|reference|photo/i;
 const disagreement=/(?:仍有|还存在|仍存在|还有|有明显|有细微).{0,12}(?:差别|差异|偏差)|(?:并非|并不|未能).{0,20}(?:一致|对齐|吻合|匹配)|不一致|不相符|differs? from|does not match|still.{0,20}(?:wider|narrower|taller|shorter)/i;
 return confirmedCompletionIssues(values,true).filter(value=>shape.test(value)&&reference.test(value)&&disagreement.test(value)
  &&!/未提供|缺少.{0,12}参考|未做.{0,12}校验|不可见|按(?:用户)?要求简化|上一版|修复前|(?:消除|修复了|没有|未发现).{0,12}(?:差异|差别|不一致)/.test(value));
}
