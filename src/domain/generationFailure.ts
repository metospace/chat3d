export interface GenerationFailureOptions {previewRetained?:boolean}
const unchanged='本次调整未成功，场景未修改。';
const retained='本次调整未成功，已保留之前的预览。';

export type StopResult='unchanged'|'checkpoint'|'previous';
export function generationStopMessage(result:StopResult){
 return result==='checkpoint'?'已停止生成，已保留阶段草稿。':result==='previous'?'已停止本次调整，已保留之前的预览。':'已停止生成，场景未修改。';
}
export const STOP_PREVIEW_NEXT='可查看或放弃预览；不会自动继续生成。';
export const STOP_USAGE_NOTE='服务端可能仍在处理，停止不保证退还用量。';

/** Raw failures belong in task diagnostics, never in normal chat or preview text. */
export function generationFailureMessage(error:unknown,options:GenerationFailureOptions={}):string {
 const raw=error instanceof Error?error.message:String(error??'');
 if(/^(?:本次调整未成功，(?:场景未修改|已保留之前的预览)。|已停止(?:本次调整|生成)，|场景已变化，本次结果未应用。)/.test(raw)&&!technicalPayload.test(raw))return raw;
 const outcome=options.previewRetained?retained:unchanged;
 if(/failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|outdated optimize dep|unable to preload css/i.test(raw))return outcome+'本地程序模块加载失败，并非已确认的模型连接故障。请刷新页面后恢复输入；若仍失败，请重启或更新应用后再发送。';
 if(/未确认执行 Blender|BlenderScriptDeclined/.test(raw))return outcome+'本次 Blender 执行授权未通过，脚本没有发送。请重新选择 Blender 生成后发送。';
 if(/模型没有调用 Blender|本轮没有返回 Blender/.test(raw))return outcome+'模型未执行 Blender 建模工具，没有生成模型文件。请查看失败原因或任务记录中的模型回复。';
 if(/Blender Python 未启用|Blender Python is not enabled|执行令牌/.test(raw))return outcome+'本机 Blender Python 服务未开启或执行授权已失效，请重新连接本机 Blender。';
 if(/Blender worker busy/.test(raw))return outcome+'本机 Blender 正在执行另一个任务，请等待该任务结束后再发送。';
 if(/Blender executable not found/.test(raw))return outcome+'找不到本机 Blender 程序，请检查启动服务时配置的路径。';
 if(/Blender Python timed out/.test(raw))return outcome+'本机 Blender 执行超过 60 秒，已终止。请查看执行日志，减少单次建模或渲染工作量。';
 if(/Blender Python.*(?:failed|失败|execution)|Python (?:execution|artifact)/i.test(raw))return outcome+'Blender 脚本执行、导出或渲染失败。下方“失败原因”提供具体错误。';
 if(/体验页访问验证未通过|体验页要求重新登录/.test(raw))return outcome+'体验页访问验证未通过，请重新登录体验页后再发送。';
 if(/\b401\b|unauthori[sz]ed|invalid.{0,12}(?:api.?key|token)|authentication|密钥.{0,8}(?:无效|错误|过期)/i.test(raw))return outcome+'模型服务未能验证身份，请在模型配置中检查访问凭证后再发送。';
 if(/\b403\b|forbidden|permission denied|无权访问/i.test(raw))return outcome+'当前账号没有使用该模型的权限，请在模型配置中选择可用的模型后再发送。';
 if(/timeout|timed?\s*out|超时|(?:超过|连续)\s*3\s*分钟|等待.{0,12}3\s*分钟/i.test(raw))return outcome+'等待超过 3 分钟，已停止本次接收。请恢复输入后手动重试；不会自动重新生成，先前请求可能仍在处理。';
 if(/\b5\d\d\b|service unavailable|bad gateway/i.test(raw))return outcome+'模型服务暂时不可用，请稍后重试。';
 if(/failed to fetch|fetch failed|network|网络|连接失败|无法读取接口响应|跨域|ECONN|ENOTFOUND/i.test(raw))return outcome+'暂时无法连接模型服务，请检查网络连接后重试。';
 if(/\b429\b|rate.?limit|too many requests|额度|余额不足/i.test(raw))return outcome+'模型服务暂时无法接受本次请求，请检查可用额度或稍后重试。';
 if(/未接入模型代理|PROXY_UPSTREAM_DENIED|部署管理员|模型配置|baseURL|model.{0,10}(?:not found|does not exist)|\b404\b/i.test(raw))return outcome+'当前模型服务配置不可用，请检查模型配置或联系服务提供方后再发送。';
 if(/场景已变化/.test(raw))return '场景已变化，本次结果未应用。请根据当前场景重新描述要修改的地方。';
 if(/不允许新增|修改范围|范围外/.test(raw))return outcome+'本次修改超出了允许的范围，请调整修改范围或重新描述要修改的对象。';
 if(/已停止|用户停止|你已停止/.test(raw))return generationStopMessage(options.previewRetained?'previous':'unchanged')+(options.previewRetained?STOP_PREVIEW_NEXT:'可恢复输入后手动发送。');
 return outcome+'本次请求在执行过程中出现错误，请展开“失败原因”查看具体信息；完整记录可在任务记录中导出。';
}

const technicalPayload=/(?:\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b(?:HTTP\s*\d{3}|Error|TypeError|SyntaxError|JSON|nodeIds?|materialId|requestId|baseRevision|projectId|parentId|rotationQuaternion|createPrimitive|updateNode|editScope|operations|tool_calls)\b|\b(?:unknown|invalid|missing|required|failed|exception)\b|(?:[A-Za-z]:[\\/]|https?:\/\/|\/(?:src|api|v1|tmp)\/)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23,}|\b(?:node|component|assembly|capture|toolcall)-[a-z0-9-]+\b|[{}\[\]]|["'][^"']+["']\s*:|\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)|(?:工具|命令|参数|字段).{0,18}(?:失败|错误|无效|缺失)|中断原因[：:])/i;

/** Presentation-only sanitization also protects projects saved by older versions. */
export function sanitizeGenerationText(value:string,options:GenerationFailureOptions&{failed?:boolean;fallback?:string}={}):string {
 if(options.failed)return generationFailureMessage(value,options);
 const text=value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi,'').replace(/```[\s\S]*?(?:```|$)/g,'');
 const safe=text.split(/\n/).filter(line=>!technicalPayload.test(line)).join('\n').trim();
 return safe||options.fallback||generationFailureMessage('',options);
}
