import {useEffect,useRef,useState} from 'react';
import type {DashboardItem} from '../domain/dashboard';
import type {TeamClient} from '../domain/teamLibrary';

/** Both browsing surfaces accept only an explicitly bound screenshot, never package assets. */
export function DashboardScreenshot({client,item,lazy=false}:{client:TeamClient;item:DashboardItem;lazy?:boolean}){
 const host=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(!lazy),[image,setImage]=useState<{key:string;url:string}>(),[loading,setLoading]=useState(false);
 const shot=item.screenshot;
 const trusted=shot?.templateId===item.id&&shot.version===item.version&&shot.packageHash===item.packageHash&&/^[a-f0-9]{64}$/.test(shot.packageHash)&&/^[a-zA-Z0-9-]+$/.test(shot.id)&&shot.provenance==='admin-confirmed-local-render';
 const key=`${client.base}/${item.id}/${item.version}/${trusted?shot!.id:''}`;
 useEffect(()=>{
  const element=host.current;if(!lazy||!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});observer.observe(element);
  return()=>observer.disconnect();
 },[lazy]);
 useEffect(()=>{
  let active=true,url='';const controller=new AbortController();setImage(undefined);setLoading(visible&&!!trusted);
  if(visible&&trusted)void client.raw(`dashboards/${encodeURIComponent(item.id)}/${item.version}/screenshot/${shot!.id}`,undefined,controller.signal).then(async response=>{
   if(response.headers.get('content-type')?.split(';')[0]!=='image/png')throw Error('截图类型无效');
   const blob=await response.blob();if(blob.size!==shot!.bytes)throw Error('截图未完整返回');
   if(active){url=URL.createObjectURL(blob);setImage({key,url});}
  }).catch(()=>{/* Missing, revoked and failed images stay local placeholders. */}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
 },[client,key,visible,trusted,shot?.bytes]);
 return <div ref={host} className="dashboard-screenshot">
  {image?.key===key&&<img className="dashboard-card-cover-image" src={image.url} alt={`${item.name} v${item.version} 实际渲染截图`} onError={()=>setImage(undefined)}/>}
  {image?.key!==key&&<span className="dashboard-card-cover-status">{loading?'正在加载截图…':'暂无截图'}</span>}
 </div>;
}

export function DashboardCardPreview({client,item,disabled,onOpen}:{client:TeamClient;item:DashboardItem;disabled:boolean;onOpen:()=>void}){
 return <div className="dashboard-card-cover"><button type="button" className="dashboard-card-cover-button" aria-label={`预览 ${item.name} v${item.version}`} disabled={disabled} onClick={onOpen}>
  <DashboardScreenshot client={client} item={item} lazy/>
  <span className="dashboard-card-cover-open">查看模板</span>
 </button></div>;
}
