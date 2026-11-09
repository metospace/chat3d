import {useEffect,useRef,useState} from 'react';
import {Button} from 'antd';
import type {TeamItem} from '../domain/teamLibrary';
import type {TeamPreviewLoader,TeamThumbnail} from '../scene/teamPreview';

export function TeamResourceImage({row,load,onOpen}:{row:TeamItem;load:TeamPreviewLoader;onOpen?:()=>void}){
 const host=useRef<HTMLDivElement>(null),[thumbnail,setThumbnail]=useState<TeamThumbnail>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),render=useRef(false);
 const lazy=!!onOpen;
 useEffect(()=>{
  let controller:AbortController|undefined,complete=false;
  setThumbnail(undefined);setError('');
  const start=()=>{
   if(controller||complete)return;
   const current=controller=new AbortController();
   void load(row,current.signal,render.current).then(value=>{if(!current.signal.aborted){complete=true;setThumbnail(value);}}).catch(reason=>{if(!current.signal.aborted){complete=true;setError(reason instanceof Error?reason.message:'预览暂不可用');}});
  };
  const stop=()=>{controller?.abort();controller=undefined;};
  if(!lazy||typeof IntersectionObserver==='undefined')start();
  const observer=lazy&&typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))start();else stop();}):undefined;
  if(host.current)observer?.observe(host.current);
  return ()=>{stop();observer?.disconnect();};
 },[load,row,attempt,lazy]);
 const content=thumbnail?<img src={thumbnail.image} alt={`${row.name} 团队固定版本 v${row.version}${onOpen?'缩略图':'预览'}`} onError={()=>{render.current=true;setThumbnail(undefined);setError('预览图片无法显示，请重试生成');}}/>:<span className="team-resource-image-status">{error?'预览不可用':'正在读取真实预览…'}</span>;
 return <div ref={host} className={onOpen?'team-resource-cover':'team-preview-image'}>{onOpen?<button className="team-resource-preview-button" aria-label={`预览 ${row.name}`} onClick={onOpen}>{content}</button>:content}{error?<div className="team-resource-image-error"><span role="status">{error}</span><Button size="small" aria-label={`重试 ${row.name} 预览`} onClick={()=>setAttempt(value=>value+1)}>重试预览</Button></div>:thumbnail?.notice&&<span className="team-resource-image-notice">{thumbnail.notice}</span>}</div>;
}
