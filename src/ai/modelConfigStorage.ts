import type {ModelConfig} from './provider';
import {normalizeTaskBudget} from './taskBudget';

export const MODEL_CONFIG_KEY = 'chat3d.modelConfig';
let storageError: string | null = null;
export const modelConfigStorageError = () => storageError;

/** Persist preferences, and credentials only after explicit consent. */
export function saveModelConfig(config: ModelConfig | null): void {
  storageError = null;
  try {
    if (!config) { localStorage.removeItem(MODEL_CONFIG_KEY); return; }
    const {apiKey,baseURL,model,useMock,reasoningEffort,taskBudget,agentMode,parallelDrafts,stream} = config;
    localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify({
      baseURL,model,useMock,reasoningEffort,taskBudget,agentMode,parallelDrafts,stream,
      rememberApiKey: config.rememberApiKey === true,
      ...(config.rememberApiKey === true ? {apiKey} : {}),
    }));
  } catch {
    // Best effort removal also handles a quota error when replacing an old key.
    let removed = false;
    try { localStorage.removeItem(MODEL_CONFIG_KEY); removed = true; } catch { /* report below */ }
    storageError = removed
      ? '配置仅在本次会话生效，本机保存失败；旧的模型配置已移除。'
      : '无法更新本机配置。旧密钥可能仍在浏览器存储中，请允许存储访问后重试或清除本站模型配置。';
  }
}

/** Legacy keys remain usable this session, but are removed from durable storage. */
export function loadModelConfig(): ModelConfig | null {
  storageError = null;
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<ModelConfig>;
    if (!c || c.useMock === true || typeof c.baseURL !== 'string' || typeof c.model !== 'string') {
      // An unusable legacy configuration must not strand an unapproved key.
      saveModelConfig(null);
      return null;
    }
    const config: ModelConfig = {
      reasoningEffort: c.reasoningEffort === 'low' || c.reasoningEffort === 'medium' || c.reasoningEffort === 'high' || c.reasoningEffort === 'xhigh' ? c.reasoningEffort : undefined,
      taskBudget: normalizeTaskBudget(c.taskBudget), baseURL: c.baseURL, model: c.model,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey : '', rememberApiKey: c.rememberApiKey === true,
      agentMode: c.agentMode === 'single' ? 'single' : 'pi', parallelDrafts: c.parallelDrafts === true,
      stream: c.stream !== false, useMock: false,
    };
    if ((!config.rememberApiKey && typeof c.apiKey === 'string') || 'generationQuality' in c || 'generationStyle' in c || 'style' in c) saveModelConfig(config);
    return config;
  } catch { return null; }
}
