import {useEffect,useRef,useState} from 'react';
import type {DashboardItem} from '../domain/dashboard';
import type {TeamClient} from '../domain/teamLibrary';

/** Cards fetch only a published image; opening a template loads its full package. */
export function DashboardCardPreview({client,item,disabled,onOpen}:{client:TeamClient;item:DashboardItem;disabled:boolean;onOpen:()=>void}){
 const host=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[image,setImage]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  const element=host.current;if(!element)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});observer.observe(element);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let active=true,url='';const controller=new AbortController();setImage('');setLoading(visible);
  if(visible)void client.raw(`dashboards/${item.id}/${item.version}/thumbnail`,undefined,controller.signal).then(response=>response.blob()).then(blob=>{
   if(active){url=URL.createObjectURL(blob);setImage(url);}
  }).catch(()=>{/* Missing images and transport failures are calm, card-local placeholders. */}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
 },[client,item.id,item.version,visible]);
 return <div ref={host} className="dashboard-card-cover">
  <button type="button" className="dashboard-card-cover-button" aria-label={`预览 ${item.name} v${item.version}`} disabled={disabled} onClick={onOpen}>
   {image&&<img className="dashboard-card-cover-image" src={image} alt={`${item.name} 缩略图`} onError={()=>setImage('')}/>}
   {!image&&<span className="dashboard-card-cover-status">{loading?'正在加载缩略图…':'暂无缩略图'}</span>}
   <span className="dashboard-card-cover-open">查看模板</span>
  </button>
 </div>;
}
