import {useEffect,useRef,useState} from 'react';
import {Button,Input,Popover} from 'antd';
import {CheckIcon,ChevronDownIcon,ChevronRightIcon,MagnifyingGlassIcon,ReloadIcon,GearIcon} from '@radix-ui/react-icons';
import {fetchModels,type ModelConfig} from '../ai/provider';
import {useEditorStore} from '../store';

const REASONING_OPTIONS=[{value:undefined,label:'默认'},{value:'low',label:'低'},{value:'medium',label:'中'},{value:'high',label:'高'},{value:'xhigh',label:'超高'}] as const;
export function ModelPicker({onConfigure,forNewProject=false}:{onConfigure?:()=>void;forNewProject?:boolean}){
 const config=useEditorStore(s=>s.aiConfig),status=useEditorStore(s=>s.aiStatus);
 const locked=!forNewProject&&['capturing','context','generating','validating','applying'].includes(status);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[catalog,setCatalog]=useState<{baseURL:string;apiKey:string;models:string[]}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const [reasoningOpen,setReasoningOpen]=useState(false);
 const sequence=useRef(0),requestedRefresh=useRef(0);
 const matchingCatalog=catalog?.baseURL===config?.baseURL&&catalog?.apiKey===config?.apiKey?catalog:null;
 const models=matchingCatalog?.models??[];
 const trigger=useRef<HTMLButtonElement>(null),options=useRef<HTMLDivElement>(null),[availableHeight,setAvailableHeight]=useState(360);
 useEffect(()=>{if(!open)return;const measure=()=>{const box=trigger.current?.getBoundingClientRect();if(box)setAvailableHeight(Math.min(400,Math.max(box.top,window.innerHeight-box.bottom)-32));};measure();window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);},[open]);
 useEffect(()=>{if(!open||loading||query)return;const frame=requestAnimationFrame(()=>{const list=options.current,item=list?.querySelector<HTMLElement>('[aria-pressed="true"]');if(list&&item)list.scrollTop=item.offsetTop-list.offsetTop-(list.clientHeight-item.offsetHeight)/2;});return()=>cancelAnimationFrame(frame);},[open,loading,query,models]);
 useEffect(()=>{
  if(!open||!config?.baseURL||!config.apiKey)return;
  if(matchingCatalog&&requestedRefresh.current===refresh){setLoading(false);return;}
  const seq=++sequence.current,c=new AbortController(),scope={baseURL:config.baseURL,apiKey:config.apiKey};
  setLoading(true);setError('');const timer=setTimeout(()=>c.abort(),20000);
  void fetchModels(config,c.signal).then(result=>{
   if(seq!==sequence.current||c.signal.aborted)return;
   if(result.error)setError(result.error);
   else {requestedRefresh.current=refresh;setCatalog({...scope,models:[...new Set(result.models)]});}
  }).catch(()=>{if(seq===sequence.current)setError('获取模型失败，请检查连接配置');}).finally(()=>{clearTimeout(timer);if(seq===sequence.current){setLoading(false);if(c.signal.aborted)setError('获取模型超时，可重试；当前模型和推理强度仍保留');}});
  return()=>{sequence.current++;c.abort();clearTimeout(timer);};
 },[open,refresh,config?.baseURL,config?.apiKey]);
 useEffect(()=>{if(locked)setOpen(false);if(!open)setReasoningOpen(false)},[locked,open]);
 const configured=!!config?.baseURL&&!!config.apiKey&&!config.useMock;
 function choose(model:string){const current=useEditorStore.getState();if((!forNewProject&&['capturing','context','generating','validating','applying'].includes(current.aiStatus))||current.aiConfig?.baseURL!==config?.baseURL||current.aiConfig?.apiKey!==config?.apiKey||!matchingCatalog||!models.includes(model))return;current.setAiConfig({...current.aiConfig!,model});setOpen(false);setQuery('')}
 function chooseReasoning(reasoningEffort:ModelConfig['reasoningEffort']){const current=useEditorStore.getState();if((!forNewProject&&['capturing','context','generating','validating','applying'].includes(current.aiStatus))||!current.aiConfig||current.aiConfig.baseURL!==config?.baseURL||current.aiConfig.apiKey!==config?.apiKey)return;current.setAiConfig({...current.aiConfig,reasoningEffort});setReasoningOpen(false);}
 const effortLabel=REASONING_OPTIONS.find(option=>option.value===config?.reasoningEffort)?.label??'默认';
 const currentModel=config?.model?.trim();
 const visibleModels=currentModel&&!models.includes(currentModel)?[currentModel,...models]:models;
 const shown=visibleModels.filter(model=>model.toLowerCase().includes(query.toLowerCase()));
 return <Popover
  open={open}
  onOpenChange={value=>{if(locked)return;if(value&&!configured){onConfigure?.();return;}setOpen(value)}}
  trigger={['click']}
  placement="topLeft"
  destroyOnHidden
  classNames={{root:'model-picker-popover'}}
  content={<div className="model-picker-menu" role="dialog" aria-label="选择模型" style={{maxHeight:availableHeight}}>
   <header className="model-picker-heading"><strong>选择模型</strong><span>{loading?'正在获取…':`${models.length} 个可用`}</span><Button type="text" size="small" aria-label="刷新模型列表" title="刷新模型列表" loading={loading} disabled={loading} onClick={()=>setRefresh(x=>x+1)} icon={<ReloadIcon/>}/></header>
   <Input aria-label="搜索模型" placeholder="搜索模型名称" value={query} onChange={e=>setQuery(e.target.value)} allowClear prefix={<MagnifyingGlassIcon/>}/>
   <div ref={options} className="model-picker-options" role="group" aria-label="可用模型">{shown.map(m=><div key={m} className={'model-picker-row'+(config?.model===m?' is-current':'')}><Button type="text" className="model-picker-option" title={m} aria-label={`使用模型 ${m}`} aria-pressed={config?.model===m} onClick={()=>choose(m)}><span>{m}</span>{config?.model===m&&<CheckIcon/>}</Button>{config?.model===m&&<Popover open={reasoningOpen} onOpenChange={setReasoningOpen} trigger="click" placement="rightTop" destroyOnHidden classNames={{root:'model-reasoning-popover'}} content={<div className="model-reasoning-menu" role="menu" aria-label="推理强度"><strong>推理强度</strong>{REASONING_OPTIONS.map(option=><Button key={option.label} type="text" role="menuitemradio" aria-checked={config?.reasoningEffort===option.value} aria-label={option.label} onClick={()=>chooseReasoning(option.value)}><span>{option.label}</span>{config?.reasoningEffort===option.value&&<CheckIcon/>}</Button>)}<p>需要模型及网关支持。默认不传参数。</p></div>}><Button type="text" className="model-reasoning-trigger" aria-label={`推理强度，当前${effortLabel}`} aria-expanded={reasoningOpen}>{effortLabel}<ChevronRightIcon/></Button></Popover>}</div>)}
    {loading&&<p role="status">正在获取模型…</p>}
    {error&&<p role="alert">{error}</p>}
    {!loading&&!error&&!shown.length&&<p className="model-picker-empty">{query?'没有匹配的模型':'服务暂未提供可用模型'}</p>}
   </div>
   <footer className="model-picker-footer"><span title={config?.model?`${config.model} · 推理${effortLabel}`:undefined}>{config?.model?`当前：${config.model} · 推理${effortLabel}`:'尚未选择'}</span><Button type="text" className="model-picker-connect" icon={<GearIcon/>} onClick={()=>{setOpen(false);onConfigure?.()}}>连接设置</Button></footer>
  </div>}>
  <Button ref={trigger} type="text" className="model-picker-trigger" disabled={locked} aria-label={configured?`切换模型，当前 ${config?.model||'未选择'}`:'连接并选择模型'} title={locked?'生成中不能切换模型':configured?`${config?.model||'未选择'} · 推理${effortLabel}`:'连接并选择模型'}><span className="model-picker-name">{configured?(config?.model||'选择模型'):'连接模型'}</span>{configured&&<small className="model-picker-effort" aria-label={`推理强度：${effortLabel}`}>{effortLabel}</small>}<ChevronDownIcon/></Button>
 </Popover>;
}
