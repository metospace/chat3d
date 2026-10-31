import {modelConfigStorageError} from '../ai/modelConfigStorage';
import {normalizeTaskBudget,TASK_BUDGET_PRESETS} from '../ai/taskBudget';
import {SiteAccessRecovery} from './SiteAccessRecovery';
import {AGENT_LIMITS} from '../ai/agentPolicy';
import {Button,Checkbox,Input,Modal} from 'antd';
import {Cross1Icon} from '@radix-ui/react-icons';
import { useEffect, useRef, useState } from 'react';
import { ModelConfig, fetchModels, testConnection } from '../ai/provider';
import { useEditorStore } from '../store';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const config = useEditorStore((s) => s.aiConfig);
  const [baseURL, setBaseURL] = useState(config?.baseURL ?? 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [rememberApiKey,setRememberApiKey]=useState(config?.rememberApiKey===true);
  const [model, setModel] = useState(config?.model ?? '');
  const [agentMode, setAgentMode] = useState<'pi'|'single'>(config?.agentMode ?? 'pi');
  const [taskBudget,setTaskBudget]=useState(()=>normalizeTaskBudget(config?.taskBudget));
  const [parallelDrafts,setParallelDrafts]=useState(config?.parallelDrafts===true);
  const [stream, setStream] = useState(config?.agentMode === 'single' ? config.stream !== false : true);
  const [models, setModels] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(modelConfigStorageError()??'');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ok:boolean;text:string}|null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastCredentials = useRef('');
  const inputClass = 'settings-input';
  const ready = !!baseURL.trim() && !!apiKey.trim();
  const valid = (ready && !!model.trim() && (manual || !!models?.includes(model)));

  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  const invalidate = () => {
    sequence.current++; controller.current?.abort(); setFetching(false); setTesting(false);
    setModels(null); setModel(''); setError(''); setResult(null); setManual(false); setQuery('');
    lastCredentials.current = '';
  };
  const load = async (force = true) => {
    if (!ready) return;
    const credentialId = `${baseURL.trim()}\n${apiKey.trim()}`;
    if (!force && lastCredentials.current === credentialId) return;
    lastCredentials.current = credentialId;
    const id = ++sequence.current;
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setFetching(true); setError(''); setResult(null); setModels(null); setManual(false);
    const timeout = window.setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetchModels({baseURL:baseURL.trim(),apiKey:apiKey.trim(),model:'',useMock:false}, c.signal);
      if (id !== sequence.current) return;
      setModels(r.models);
      if (r.error) { setError(c.signal.aborted ? '获取模型超时，请检查接口或稍后重试' : r.error); setModel(''); }
      else { setModel((previous) => r.models.includes(previous) ? previous : (r.models.length === 1 ? r.models[0] : '')); }
    } catch (e) { if (id === sequence.current) setError(e instanceof Error ? e.message : '获取模型失败'); }
    finally { window.clearTimeout(timeout); if (id === sequence.current) setFetching(false); }
  };
  useEffect(() => { if (ready) void load(true); }, []);
  const test = async () => {
    if (!valid) return;
    const id = ++sequence.current;
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    const timeout = window.setTimeout(() => c.abort(), 20000);
    setTesting(true); setResult(null);
    try {
      const r = await testConnection({baseURL:baseURL.trim(),apiKey:apiKey.trim(),model:model.trim(),useMock:false}, c.signal);
      if (id === sequence.current) setResult(c.signal.aborted ? {ok:false,text:'连接测试超时，请检查服务响应后重试'} : r);
    } finally { window.clearTimeout(timeout); if (id === sequence.current) setTesting(false); }
  };
  const save = () => {
    if (!valid) return;
    const cfg: ModelConfig = {rememberApiKey,generationQuality:useEditorStore.getState().aiConfig?.generationQuality==='fast'?'fast':'fine',taskBudget:normalizeTaskBudget(taskBudget),baseURL:baseURL.trim(),apiKey:apiKey.trim(),model:model.trim(),useMock:false,stream,agentMode,parallelDrafts:agentMode==='pi'&&parallelDrafts};
    useEditorStore.getState().setAiConfig(cfg);
    const storageFailure=modelConfigStorageError();
    if(storageFailure){setError(storageFailure);return;}
    onClose();
  };
  const shown = (models ?? []).filter((id) => id.toLowerCase().includes(query.toLowerCase()));
  const originBlocked = error.includes('origin not allowed');
  return <Modal open onCancel={onClose} footer={null} closable={false} width={680} mask={{closable:false}} className="settings-dialog model-settings-module" title={<div className="settings-dialog-head"><h2 id="model-settings-title" className="settings-dialog-title">连接模型服务</h2><Button type="text" aria-label="关闭模型配置" onClick={onClose} icon={<Cross1Icon/>}/></div>}>
      <div className="settings-dialog-body">
        <p className="settings-lede">1. 填写接口和密钥　2. 获取并选择模型　3. 保存配置（可先测试连接）</p>
        <label className="settings-field"><span>API 根地址</span><Input className={inputClass} type="url" value={baseURL} onChange={(e)=>{invalidate();setBaseURL(e.target.value);setApiKey('')}} onBlur={()=>void load(false)} placeholder="https://你的服务/v1" /><span className="settings-hint">填写到 /v1 或服务提供的 API 根路径，不要包含 /models 或 /chat/completions。更换地址后请重新输入对应密钥，避免将旧密钥发送给新服务</span></label>
        <label className="settings-field"><span>API Key</span><Input.Password className={inputClass} autoComplete="off" value={apiKey} onChange={(e)=>{invalidate();setApiKey(e.target.value)}} onBlur={()=>void load(false)} placeholder="填写服务提供的密钥" /></label>
        <Checkbox checked={rememberApiKey} onChange={e=>setRememberApiKey(e.target.checked)}><span>在此设备记住密钥</span></Checkbox>
        <p className="settings-hint">默认仅本次会话使用，刷新或关闭后需重新输入。勾选后会以明文保存在本机浏览器中，请仅在可信设备使用。</p>
        <div className="settings-stack">
          <Button type="primary" block onClick={()=>void load()} disabled={!ready || fetching} className="settings-fetch">{fetching ? '正在获取模型列表…' : models?.length ? '重新获取模型列表' : '获取可用模型'}</Button>
          <SiteAccessRecovery error={error}/>
          {error && <div role="alert" className="settings-error">{error}</div>}
          {!!models?.length && !manual && <>
            <label className="settings-field"><span>筛选模型（共 {models.length} 个）</span><Input className={inputClass} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="输入名称筛选" /></label>
            <label className="settings-field"><span>选择模型</span><select className="settings-select" value={model} onChange={(e)=>{sequence.current++;controller.current?.abort();setTesting(false);setModel(e.target.value);setResult(null)}}><option value="">请选择一个模型</option>{model && !shown.includes(model) && <option value={model}>{model}（当前选择）</option>}{shown.map((id)=><option key={id} value={id}>{id}</option>)}</select></label>
            {shown.length === 0 && <p className="settings-lede">没有匹配的模型，请修改筛选词</p>}
          </>}
          {!fetching && models !== null && !models.length && !originBlocked && !manual && <Button type="link" className="settings-manual" onClick={()=>setManual(true)}>服务不提供列表？手动填写模型名</Button>}
          {manual && <label className="settings-field"><span>手动模型名（请以服务文档为准）</span><Input className={inputClass} value={model} onChange={(e)=>{sequence.current++;controller.current?.abort();setTesting(false);setResult(null);setModel(e.target.value)}} placeholder="服务实际支持的模型 ID" /></label>}
        </div>
        <details className="settings-advanced"><summary>高级设置 · 执行方式与流式输出</summary><div className="settings-stack">        <label className="settings-field"><span>建模执行方式</span><select aria-label="建模执行方式" className="settings-select" value={agentMode} onChange={e=>{setAgentMode(e.target.value as 'pi'|'single');if(e.target.value==='pi')setStream(true);}}><option value="pi">连续建模（推荐）</option><option value="single">单次生成（兼容模式）</option></select><span className="settings-hint">连续建模需要模型支持图片、工具调用与流式输出；在任务预算内有有效进展就继续，到限后保留未验收草稿。连续 {AGENT_LIMITS.noProgressTurns} 轮无进展或 {AGENT_LIMITS.consecutiveErrorTurns} 轮工具失败且无进展会暂停；连续 {AGENT_LIMITS.idleTimeoutMs/60000} 分钟无活动会停止。每轮最多 {AGENT_LIMITS.outputPerTurn} 输出 Token。会将场景截图发送至你配置的同一接口，实际费用以网关为准。</span></label>
        <fieldset disabled={agentMode!=='pi'} className="settings-budget"><legend>每次建模任务预算</legend>
          <div className="settings-presets" role="group" aria-label="预算预设">{([['small','小改动'],['standard','常规建模'],['extended','复杂场景']] as const).map(([key,label])=><Button key={key} type="default" aria-pressed={taskBudget.maxMinutes===TASK_BUDGET_PRESETS[key].maxMinutes&&taskBudget.maxRounds===TASK_BUDGET_PRESETS[key].maxRounds&&taskBudget.maxReportedTokens===TASK_BUDGET_PRESETS[key].maxReportedTokens} onClick={()=>setTaskBudget({...TASK_BUDGET_PRESETS[key]})}>{label}</Button>)}</div>
          <label className="settings-field"><span>时间上限（分钟）</span><Input className={inputClass} aria-label="任务时间上限（分钟）" type="number" min="1" max="120" value={taskBudget.maxMinutes} onChange={e=>setTaskBudget(b=>({...b,maxMinutes:Number(e.target.value)}))}/></label>
          <label className="settings-field"><span>模型请求轮数上限</span><Input className={inputClass} aria-label="任务轮数上限" type="number" min="1" max="200" value={taskBudget.maxRounds} onChange={e=>setTaskBudget(b=>({...b,maxRounds:Number(e.target.value)}))}/></label>
          <label className="settings-field"><span>已报告 Token 上限</span><Input className={inputClass} aria-label="任务已报告Token上限" type="number" min="1" max="20000000" value={taskBudget.maxReportedTokens} onChange={e=>setTaskBudget(b=>({...b,maxReportedTokens:Number(e.target.value)}))}/></label>
          <p className="settings-hint">含实验并行子任务。每次发送或继续生成使用一份新预算，执行中补充要求不重置；修改配置从下一次任务生效。「已报告 Token 上限」是本机本次任务的软上限（模型回报的输入+输出合计），不是单个资产的价格或账单；实际费用以服务方为准。Token 在服务返回用量后检查，可能超过限额一个在途请求（并行时为多个）；未报告用量时依靠时间和轮数限制。到限会暂停并保留草稿，可用「继续调整」开新一轮额度，不代表验收通过。</p>
        </fieldset>
        <Checkbox disabled={agentMode!=='pi'} checked={parallelDrafts} onChange={e=>setParallelDrafts(e.target.checked)}><span>实验：独立组件并行建模</span></Checkbox>
        <p className="settings-hint">最多两个子代理，仅接收组件任务；主代理合并后统一验收。总 Token 包含子代理，可能增加用量；简单任务仍串行。</p>
        <Checkbox disabled={agentMode==='pi'} checked={stream} onChange={e=>setStream(e.target.checked)}><span>实时接收模型输出</span></Checkbox>
        <p className="settings-hint">显示实际接收进度；服务不支持流式时可关闭，仍保留计时和超时保护</p>
</div></details>
        {result && <p role="status" data-testid="test-result" className={`settings-result ${result.ok?'is-ok':'is-error'}`}>{result.text}</p>}
      </div>
      <footer className="settings-dialog-foot">
        <Button onClick={()=>void test()} disabled={!valid || testing || fetching}>{testing?'测试中…':'测试连接'}</Button>
        <div className="settings-foot-actions"><Button onClick={onClose}>取消</Button><Button type="primary" onClick={save} disabled={!valid || fetching}>保存配置</Button></div>
      </footer>
  </Modal>;
}
