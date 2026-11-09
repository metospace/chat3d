import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ReloadIcon} from '@radix-ui/react-icons';
import {readDashboard,type DashboardItem} from '../domain/dashboard';
import type {TeamClient} from '../domain/teamLibrary';
import {buildDashboardPreview} from '../scene/dashboardRuntime';

/** A real, isolated large-screen view scaled down without changing the template layout. */
export function DashboardCardPreview({client,item,disabled,onOpen}:{client:TeamClient;item:DashboardItem;disabled:boolean;onOpen:()=>void}){
 const host=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[width,setWidth]=useState(0);
 const [html,setHtml]=useState(''),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const resize=()=>setWidth(element.getBoundingClientRect().width);resize();
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(element);
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'100px'});observer.observe(element);
  return()=>{observer.disconnect();sizeObserver.disconnect();};
 },[]);
 useEffect(()=>{
  let active=true;setHtml('');setError('');setLoaded(false);
  if(visible)void readDashboard(client,item.id,item.version).then(value=>buildDashboardPreview(value.package)).then(value=>{if(active)setHtml(value.html);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:String(reason));});
  return()=>{active=false;};
 },[client,item.id,item.version,visible,attempt]);
 const style={'--dashboard-cover-scale':width/1920} as CSSProperties;
 return <div ref={host} className="dashboard-card-cover" style={style}>
  <button type="button" className="dashboard-card-cover-button" aria-label={`预览 ${item.name} v${item.version}`} disabled={disabled} onClick={onOpen}>
   {html&&width>0&&<iframe className="dashboard-card-cover-frame" title={`${item.name} 缩略预览`} srcDoc={html} sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" onLoad={()=>setLoaded(true)}/>}
   {(!html||!loaded)&&<span className="dashboard-card-cover-status">{error?'缩略预览暂不可用':visible?'正在加载真实预览…':'看板预览'}</span>}
   <span className="dashboard-card-cover-open">查看模板</span>
  </button>
  {error&&<div className="dashboard-card-cover-error"><span title={error}>可点击打开详情查看原因</span><button type="button" aria-label={`重试 ${item.name} 缩略预览`} onClick={()=>setAttempt(value=>value+1)}><ReloadIcon/>重试</button></div>}
 </div>;
}
