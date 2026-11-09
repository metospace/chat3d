import {useEffect,useState} from 'react';
import {ReloadIcon} from '@radix-ui/react-icons';
import './operation-progress.css';

/** Give React and the browser a paint opportunity before synchronous preparation. */
export function nextProgressPaint():Promise<void>{
 const {promise,resolve}=Promise.withResolvers<void>();let frame:number|undefined;let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(frame!==undefined)cancelAnimationFrame(frame);setTimeout(resolve,0);};const timer=setTimeout(finish,50);if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(finish);return promise;
}
export interface OperationProgressProps {title:string;stage:string;completed?:number;total?:number;detail?:string}
export function OperationProgress({title,stage,completed,total,detail}:OperationProgressProps){
 const [startedAt]=useState(Date.now),[now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const determinate=completed!==undefined&&total!==undefined&&Number.isFinite(completed)&&Number.isFinite(total)&&total>0;
 const value=determinate?Math.min(total,Math.max(0,completed)):undefined;
 return <section className="operation-progress" aria-label={title} aria-busy="true">
  <div className="operation-progress-heading"><strong><ReloadIcon aria-hidden="true"/>{title}</strong><span>已用 {Math.max(0,Math.floor((now-startedAt)/1000))} 秒</span></div>
  <div className="operation-progress-stage" role="status" aria-live="polite" aria-atomic="true"><span>{stage}</span>{determinate&&<span>{value} / {total}</span>}</div>
  <progress aria-label={`${title}：${stage}`} aria-valuetext={determinate?`${stage}，已完成 ${value} / ${total}`:stage} max={determinate?total:undefined} value={value}/>
  {detail&&<p>{detail}</p>}
 </section>;
}
