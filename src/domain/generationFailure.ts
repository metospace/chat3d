export interface GenerationFailureOptions {previewRetained?:boolean}
const unchanged='本次调整未成功，场景未修改。';
const retained='本次调整未成功，已保留之前的预览。';
const continueEditing='你可以继续描述要修改的地方。';

/** Raw failures belong in task diagnostics, never in normal chat or preview text. */
export function generationFailureMessage(error:unknown,options:GenerationFailureOptions={}):string {
 const raw=error instanceof Error?error.message:String(error??'');
 if(/^(?:本次调整未成功，(?:场景未修改|已保留之前的预览)。|已停止(?:本次调整|生成)，|场景已变化，本次结果未应用。)/.test(raw)&&!technicalPayload.test(raw))return raw;
 const outcome=options.previewRetained?retained:unchanged;
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
 if(/已停止|用户停止|你已停止/.test(raw))return (options.previewRetained?'已停止本次调整，已保留之前的预览。':'已停止生成，场景未修改。')+'继续调整需由你重新发送描述，不会自动生成。';
 return outcome+continueEditing;
}

const technicalPayload=/(?:\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b(?:HTTP\s*\d{3}|Error|TypeError|SyntaxError|JSON|nodeIds?|materialId|requestId|baseRevision|projectId|parentId|rotationQuaternion|createPrimitive|updateNode|editScope|operations|tool_calls)\b|\b(?:unknown|invalid|missing|required|failed|exception)\b|(?:[A-Za-z]:[\\/]|https?:\/\/|\/(?:src|api|v1|tmp)\/)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23,}|\b(?:node|component|assembly|capture|toolcall)-[a-z0-9-]+\b|[{}\[\]]|["'][^"']+["']\s*:|\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)|(?:工具|命令|参数|字段).{0,18}(?:失败|错误|无效|缺失)|中断原因[：:])/i;

/** Presentation-only sanitization also protects projects saved by older versions. */
export function sanitizeGenerationText(value:string,options:GenerationFailureOptions&{failed?:boolean;fallback?:string}={}):string {
 if(options.failed)return generationFailureMessage(value,options);
 const text=value.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi,'').replace(/```[\s\S]*?(?:```|$)/g,'');
 const safe=text.split(/\n/).filter(line=>!technicalPayload.test(line)).join('\n').trim();
 return safe||options.fallback||generationFailureMessage('',options);
}
