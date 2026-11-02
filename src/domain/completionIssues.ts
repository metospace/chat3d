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
