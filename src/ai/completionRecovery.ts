/** Actionable recovery instructions; these never edit the document or claim a fix. */
export function completionRecoveryPlan(issues:string[],state:{animation:boolean;changed:boolean;sampled:boolean;captured:boolean;reviewed:boolean;lastError:string}){
 const dynamic=issues.some(issue=>/动画|运动|同步|轨道|流程|搬运|货叉|托盘|转向|升降|取货|落货|退叉|animation|motion|synchron|track|transport/i.test(issue));
 const stage=!state.changed?'repair':!state.sampled&&dynamic?'sample':!state.captured?'capture':!state.reviewed?'review':'repair';
 return {
  stage,
  issues:issues.map((issue,index)=>({id:index+1,issue,status:'unresolved'})),
  next:stage==='sample'?'调用preview_animation，用包含0的3–6个时间点覆盖本次修复涉及的动作阶段；遮挡时换side/top等视角。':stage==='capture'?'调用capture_view({view:"perspective",scope:"scene"})获取修复后当前版本的图片，下一轮再review_model；不能复用修改前的图片。':stage==='review'?'读取刚返回的当前版本图片，调用review_model逐项核对；还存在明确缺陷就继续修改，不能只清空问题列表。':dynamic?(state.animation?'先read_animation读取现有轨道和真实目标ID，再按需read_scene读取相关组件。用configure_animation修正绑定、关键帧或时序，保留其余轨道；不能只做短程诊断替代原任务。':'先read_scene获取真实对象ID，用configure_animation补齐缺失的动画，再preview_animation；不能用文字代替实现。'):'用read_scene或find_scene_parts定位缺陷对应的真实部件，再用edit_scene等编辑工具局部修复；保留其他有效部分。',
  verification:dynamic?'核对相关对象绑定、同步、运动方向、时序和任务终态；搬运任务还需核对载荷随动及取放货。按用户实际需求核对，不强加额外工序。':'修改后按工具返回的review范围获取最新截图，再review_model；未知项不冒充通过。',
  ...(state.lastError?{toolError:state.lastError.slice(0,700)}:{}),
  rule:'下一步必须执行工具动作；文字描述、改名、重复读取同一数据和重复提交都不能代替修复。无法继续时保留未完成状态和具体错误。',
 };
}
