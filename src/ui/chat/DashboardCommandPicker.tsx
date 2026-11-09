import {forwardRef,useEffect,useId,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type ComponentRef,type KeyboardEvent,type RefObject} from 'react';
import {Button,Spin} from 'antd';
import {Sender} from '@ant-design/x';
import {listDashboards,type DashboardItem} from '../../domain/dashboard';
import {getTeamSession,getTeamSessionStatus,subscribeTeamSession} from '../../domain/teamLibrary';

export function dashboardPickerCommand(text:string):{query:string;mode?:'嵌入'|'叠加';skills?:boolean}|undefined {
  const prefix=text.trim();
  if(prefix.startsWith('/')&&'/看板'.startsWith(prefix)&&prefix!=='/看板')return {query:prefix.slice(1),skills:true};
  if(/^\s*\/看板\*\s*$/.test(text))return {query:'*'};
  const match=text.match(/^\s*\/看板(?:\s+([\s\S]*))?$/);
  if(!match)return;
  const rest=(match[1]??'').trim();
  if(rest==='移除')return;
  const mode=rest.match(/^(嵌入|叠加)(?:\s+([\s\S]*))?$/);
  return mode?{mode:mode[1] as '嵌入'|'叠加',query:(mode[2]??'').trim()}:{query:rest};
}

export interface DashboardCommandPickerRef {onKeyDown:(event:KeyboardEvent)=>false|undefined}
interface DashboardCommandPickerProps {
  query:string;
  skills?:boolean;
  busy:boolean;
  locked:boolean;
  senderRef:RefObject<ComponentRef<typeof Sender>|null>;
  onSelect:(item:DashboardItem)=>void;
  onSelectSkill:()=>void;
  onDismiss:()=>void;
}

export const DashboardCommandPicker=forwardRef<DashboardCommandPickerRef,DashboardCommandPickerProps>(function DashboardCommandPicker({query,skills=false,busy,locked,senderRef,onSelect,onSelectSkill,onDismiss},ref){
  const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
  const sessionStatus=useSyncExternalStore(subscribeTeamSession,getTeamSessionStatus,getTeamSessionStatus);
  const [items,setItems]=useState<DashboardItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [active,setActive]=useState(0);
  const listId=useId();
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    let current=true;
    setItems([]);setError('');setLoading(!skills&&!!client?.user);
    if(!skills&&client?.user)void listDashboards(client).then(values=>{if(current)setItems(values.filter(item=>!item.archived));},reason=>{if(current)setError(reason instanceof Error?reason.message:String(reason));}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[client,retry,skills]);
  const visible=useMemo(()=>{
    const needle=query==='*'?'':query.replace(/^[“「"]|[”」"]$/g,'').toLocaleLowerCase();
    return items.filter(item=>`${item.name} ${item.system} ${item.id}`.toLocaleLowerCase().includes(needle));
  },[items,query]);
  const skillVisible=skills&&'看板'.includes(query);
  const count=skills?(skillVisible?1:0):visible.length;
  const selected=Math.min(active,Math.max(0,count-1));
  const available=skills||!!client?.user&&!loading&&!error;
  const activeId=available&&count?`${listId}-${selected}`:undefined;
  useEffect(()=>{
    const list=listRef.current,option=list?.children[selected];
    if(!activeId||!list||!(option instanceof HTMLElement))return;
    const bounds=list.getBoundingClientRect(),row=option.getBoundingClientRect();
    if(row.top<bounds.top)list.scrollTop-=bounds.top-row.top;
    else if(row.bottom>bounds.bottom)list.scrollTop+=row.bottom-bounds.bottom;
  },[activeId,selected]);
  useEffect(()=>{setActive(0);},[query,items,skills]);
  useLayoutEffect(()=>{
    const input=senderRef.current?.inputElement;
    if(!input)return;
    const attributes={'role':'combobox','aria-autocomplete':'list','aria-expanded':'true','aria-controls':listId,'aria-activedescendant':activeId};
    const previous=Object.keys(attributes).map(name=>[name,input.getAttribute(name)] as const);
    for(const [name,value] of Object.entries(attributes)){if(value===undefined)input.removeAttribute(name);else input.setAttribute(name,value);}
    return()=>{for(const [name,value] of previous){if(value===null)input.removeAttribute(name);else input.setAttribute(name,value);}};
  },[senderRef,listId,activeId]);
  useImperativeHandle(ref,()=>({onKeyDown(event){
    if(event.nativeEvent.isComposing||event.keyCode===229)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onDismiss();return false;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      if(available&&count)setActive((selected+(event.key==='ArrowDown'?1:-1)+count)%count);
      return false;
    }
    if(event.key==='Enter'){
      event.preventDefault();
      if(!busy&&!locked&&available){if(skills&&skillVisible)onSelectSkill();else if(!skills&&visible[selected])onSelect(visible[selected]);}
      return false;
    }
  }}),[busy,locked,available,count,visible,selected,skills,skillVisible,onSelect,onSelectSkill,onDismiss]);
  return <section className="dashboard-command-picker" aria-label={skills?'选择技能':'选择看板模板 · 接入当前场景'} aria-busy={!skills&&loading||busy}>
    <header className="dashboard-command-picker-header"><strong>{skills?'选择技能':'选择看板模板 · 接入当前场景'}</strong><span>{busy?'正在接入…':`${count} 个${skills?'技能':'模板'}`}</span></header>
    {locked&&<p className="dashboard-command-picker-warning" role="status">请先结束当前任务或处理修改预览；输入与模板列表会保留。</p>}
    {busy&&<div className="dashboard-command-picker-state" role="status"><Spin size="small"/><span>正在读取固定版本并接入当前场景…</span></div>}
    <div ref={listRef} id={listId} className="dashboard-command-picker-list" role="listbox" aria-label={skills?'可用技能':'已发布看板模板'} aria-busy={!skills&&loading}>
      {skillVisible&&<div id={`${listId}-0`} role="option" aria-selected={selected===0} aria-disabled={busy||locked} className="dashboard-command-picker-option is-active" onMouseDown={event=>event.preventDefault()} onClick={()=>{if(!busy&&!locked)onSelectSkill();}}>
        <span className="dashboard-command-picker-skill"><span className="dashboard-command-picker-name">看板</span><span className="dashboard-command-picker-description">选择已发布模板，接入当前场景</span></span><span className="dashboard-command-picker-meta">/看板</span>
      </div>}
      {!skills&&available&&visible.map((item,index)=><div id={`${listId}-${index}`} key={item.id} role="option" aria-selected={index===selected} aria-disabled={busy||locked} className={`dashboard-command-picker-option${index===selected?' is-active':''}`} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>{if(!busy&&!locked)onSelect(item);}}>
        <span className="dashboard-command-picker-name">{item.name}</span><span className="dashboard-command-picker-meta">{item.system||'未分类'} · v{item.version}</span>
      </div>)}
    </div>
    {!skills&&(!client?.user?<p className="dashboard-command-picker-state" role="status">{sessionStatus==='restoring'?'正在恢复团队登录…':sessionStatus==='expired'?'团队登录已失效，请通过左下角账户重新登录。输入已保留。':'请通过左下角账户登录团队服务，即可选择看板；无需配置模型。'}</p>:loading?<div className="dashboard-command-picker-state" role="status"><Spin size="small"/><span>正在加载全部已发布看板…</span></div>:error?<div className="dashboard-command-picker-state" role="alert"><span>{error}</span><Button size="small" onClick={()=>setRetry(value=>value+1)}>重试</Button></div>:!visible.length?<p className="dashboard-command-picker-state" role="status">{items.length?'没有匹配的看板，请修改名称或系统关键词。':'暂无已发布的看板模板。'}<Button size="small" type="text" onClick={()=>setRetry(value=>value+1)}>刷新</Button></p>:null)}
    <footer>{skills?'↑↓ 选择 · Enter 查看模板 · Esc 收起':'按名称或系统筛选 · ↑↓ 选择 · Enter 接入 · Esc 收起'}</footer>
  </section>;
});
