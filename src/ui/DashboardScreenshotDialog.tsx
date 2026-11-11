import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Checkbox,Input,Modal} from 'antd';
import type {TeamClient} from '../domain/teamLibrary';
import type {DashboardItem,DashboardScreenshot} from '../domain/dashboard';

export function DashboardScreenshotDialog({client,item,onClose,onSaved}:{client:TeamClient;item:DashboardItem;onClose:()=>void;onSaved:()=>void}){
 const [identity,setIdentity]=useState<{templateId:string;version:number;packageHash:string;screenshot?:DashboardScreenshot}>();
 const [file,setFile]=useState<File>(),[source,setSource]=useState(''),[capturedAt,setCapturedAt]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState(''),[phase,setPhase]=useState<'idle'|'reading'|'saving'>('idle');
 const controller=useRef<AbortController|undefined>(undefined),locked=useRef(false);
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort;
  void client.raw(`dashboards/${encodeURIComponent(item.id)}/${item.version}/screenshot/info`,undefined,abort.signal).then(response=>response.json()).then(value=>{
   if(abort.signal.aborted)return;
   if(value.templateId!==item.id||value.version!==item.version||!/^[a-f0-9]{64}$/.test(value.packageHash))throw Error('固定版本不匹配');
   setIdentity(value);
  }).catch(reason=>{if(!abort.signal.aborted)setError(String(reason.message??reason));});
  return()=>{abort.abort();controller.current?.abort();};
 },[client,item.id,item.version]);
 async function save(remove=false){
  if(locked.current||!identity||!remove&&(!file||!source.trim()||!capturedAt||!confirmed))return;
  locked.current=true;setError('');
  const abort=new AbortController();controller.current=abort;
  try{
   let base64='';
   if(!remove){
    if(file!.type!=='image/png'||!file!.name.toLowerCase().endsWith('.png')||file!.size>8*1024*1024)throw Error('请选择不超过 8 MiB 的 PNG 截图');
    setPhase('reading');const bytes=new Uint8Array(await file!.arrayBuffer());abort.signal.throwIfAborted();
    let binary='';for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));base64=btoa(binary);
   }
   abort.signal.throwIfAborted();setPhase('saving');
   // Atomic binding: once sent, do not offer a misleading transport-only cancel.
   await client.request(`dashboards/${encodeURIComponent(item.id)}/${item.version}/screenshot${remove?'/unbind':''}`,remove?{expectedScreenshotId:identity.screenshot?.id}:{packageHash:identity.packageHash,expectedScreenshotId:identity.screenshot?.id??null,base64,source,capturedAt:new Date(capturedAt).toISOString(),confirmed});
   onSaved();
  }catch(reason){setError(abort.signal.aborted?'已取消上传，未发送绑定请求':`${reason instanceof Error?reason.message:String(reason)}；若已发送保存请求，结果可能尚未确认，请重新打开核对绑定后重试。`);}
  finally{locked.current=false;setPhase('idle');}
 }
 return <Modal open title={`管理截图 · ${item.name} v${item.version}`} onCancel={()=>{if(phase==='idle')onClose();}} closable={phase==='idle'} mask={{closable:phase==='idle'}} keyboard={phase==='idle'} footer={<>
  {identity?.screenshot&&<Button danger disabled={phase!=='idle'} onClick={()=>void save(true)}>取消截图绑定</Button>}
  <Button disabled={phase==='saving'} onClick={()=>phase==='reading'?controller.current?.abort():onClose()}>{phase==='reading'?'取消上传':'取消'}</Button>
  <Button type="primary" loading={phase!=='idle'} disabled={!identity||!file||!source.trim()||!capturedAt||!confirmed||phase!=='idle'} onClick={()=>void save()}>确认绑定截图</Button>
 </>}>
  <Alert type="info" showIcon title="请在受控本地/桌面实际渲染此固定版本后拍摄。不得上传 reference-full、设计参考图或任意封面。服务端校验图片与版本绑定，不能自动证明像素真实。"/>
  <p>固定版本：{item.id} / v{item.version}</p><p style={{overflowWrap:'anywhere'}}>包 SHA-256：{identity?.packageHash??'正在读取固定版本指纹…'}</p>
  {identity?.screenshot&&<p>当前截图来源（管理员声明）：{identity.screenshot.source}；拍摄于 {identity.screenshot.capturedAt}；{identity.screenshot.width}×{identity.screenshot.height}</p>}
  <label>实际渲染截图<input aria-label="实际渲染截图" type="file" accept="image/png,.png" disabled={phase!=='idle'} onChange={event=>{setFile(event.target.files?.[0]);setConfirmed(false);setError('');}}/></label>
  <p>仅 PNG，320×180 至 7680×4320，最多 1600 万像素、8 MiB；不接受 SVG、动画及交错 PNG。</p>
  <label>渲染来源说明<Input.TextArea aria-label="渲染来源说明" maxLength={1000} disabled={phase!=='idle'} value={source} onChange={event=>{setSource(event.target.value);setConfirmed(false);}} placeholder="本地包来源、版本核对、渲染环境、入口与拍摄方式"/></label>
  <label>拍摄时间<input aria-label="拍摄时间" type="datetime-local" value={capturedAt} disabled={phase!=='idle'} onChange={event=>{setCapturedAt(event.target.value);setConfirmed(false);}}/></label>
  <p><Checkbox checked={confirmed} disabled={phase!=='idle'} onChange={event=>setConfirmed(event.target.checked)}>我已核对模板 ID、版本和包指纹，确认这是该版本实际渲染的截图（人工声明）</Checkbox></p>
  {phase!=='idle'&&<p role="status">{phase==='reading'?'正在读取截图，可取消上传':'正在校验并原子保存绑定，请等待结果；网络失败时请重新打开核对绑定'}</p>}
  {error&&<Alert role="alert" type="error" title={error}/>}
 </Modal>;
}
