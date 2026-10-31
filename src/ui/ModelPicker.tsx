import {useEffect,useRef,useState} from 'react';
import {Button,Input,Popover} from 'antd';
import {CheckIcon,ChevronDownIcon,MagnifyingGlassIcon,ReloadIcon} from '@radix-ui/react-icons';
import {fetchModels} from '../ai/provider';
import {useEditorStore} from '../store';

export function ModelPicker({onConfigure,forNewProject=false}:{onConfigure?:()=>void;forNewProject?:boolean}){
 const config=useEditorStore(s=>s.aiConfig),status=useEditorStore(s=>s.aiStatus);
 const locked=!forNewProject&&['capturing','context','generating','validating','applying'].includes(status);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[models,setModels]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const sequence=useRef(0),catalogScope=useRef<{baseURL:string;apiKey:string}|null>(null);
 useEffect(()=>{if(!open||!config?.baseURL||!config.apiKey)return;const seq=++sequence.current,c=new AbortController();catalogScope.current=null;setLoading(true);setError('');setModels([]);const timer=setTimeout(()=>c.abort(),20000);void fetchModels(config,c.signal).then(r=>{if(seq!==sequence.current||c.signal.aborted)return;if(r.error)setError(r.error);else {catalogScope.current={baseURL:config.baseURL,apiKey:config.apiKey};setModels([...new Set(r.models)]);}}).catch(()=>{if(seq===sequence.current)setError('获取模型失败，请检查连接配置');}).finally(()=>{clearTimeout(timer);if(seq===sequence.current){setLoading(false);if(c.signal.aborted)setError('获取模型超时，请重试');}});return()=>{sequence.current++;c.abort();clearTimeout(timer)};},[open,refresh,config?.baseURL,config?.apiKey]);
 useEffect(()=>{if(locked)setOpen(false)},[locked]);
 const configured=!!config?.baseURL&&!!config.apiKey&&!config.useMock;
 function choose(model:string){const current=useEditorStore.getState();if((!forNewProject&&['capturing','context','generating','validating','applying'].includes(current.aiStatus))||current.aiConfig?.baseURL!==config?.baseURL||current.aiConfig?.apiKey!==config?.apiKey||catalogScope.current?.baseURL!==current.aiConfig?.baseURL||catalogScope.current?.apiKey!==current.aiConfig?.apiKey||!models.includes(model))return;current.setAiConfig({...current.aiConfig!,model});setOpen(false);setQuery('')}
 const shown=models.filter(m=>m.toLowerCase().includes(query.toLowerCase()));
 return <Popover
  open={open}
  onOpenChange={value=>{if(locked)return;if(value&&!configured){onConfigure?.();return;}setOpen(value)}}
  trigger={['click']}
  placement="topLeft"
  destroyOnHidden
  content={<div className="model-picker-menu" aria-label="选择模型">
   <Input aria-label="搜索模型" placeholder="搜索模型…" value={query} onChange={e=>setQuery(e.target.value)} prefix={<MagnifyingGlassIcon/>} suffix={<Button type="text" size="small" aria-label="刷新模型列表" title="刷新模型列表" disabled={loading} onClick={()=>setRefresh(x=>x+1)} icon={<ReloadIcon/>}/>}/>
   <div className="model-picker-options" role="group" aria-label="可用模型">{shown.map(m=><Button type="text" key={m} className="model-picker-option" aria-label={`使用模型 ${m}`} aria-pressed={config?.model===m} onClick={()=>choose(m)}><span>{m}</span>{config?.model===m&&<CheckIcon/>}</Button>)}</div>
   {loading&&<p role="status">正在获取模型…</p>}
   {error&&<p role="alert">{error}</p>}
   {!loading&&!error&&!shown.length&&<p>没有匹配的模型</p>}
   <Button type="text" className="model-picker-connect" onClick={()=>{setOpen(false);onConfigure?.()}}>连接设置</Button>
  </div>}>
  <Button type="text" className="model-picker-trigger" disabled={locked} aria-label={configured?`切换模型，当前 ${config?.model||'未选择'}`:'连接并选择模型'} title={locked?'生成中不能切换模型':config?.model||'连接并选择模型'}><span>{configured?(config?.model||'选择模型'):'连接模型'}</span><ChevronDownIcon/></Button>
 </Popover>;
}
