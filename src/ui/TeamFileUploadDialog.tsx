import {useEffect,useRef,useState} from 'react';
import {Button,Input,Tag} from 'antd';
import {PortalDialog} from './kit/PortalDialog';
import {parseTeamUploadFile,prepareTeamFileUpload,canUpdateTeamUpload,type TeamUploadFile} from '../domain/teamFileUpload';
import type {TeamClient,TeamItem} from '../domain/teamLibrary';
import type {TeamPreparationResult} from '../domain/teamPreparationCore';
import type {TeamUploadProgress} from '../domain/teamPublish';
import './team-library.css';

type Entry={id:string;file:File;parsed?:TeamUploadFile;name:string;description:string;category:string;target:string;status:'validating'|'ready'|'preparing'|'running'|'success'|'error';error?:string;stage?:string;prepared?:TeamPreparationResult;upload?:TeamUploadProgress;started?:number;ended?:number;version?:number};
const importStages:Record<string,string>={checking:'检查模型文件',parsing:'解析模型',converting:'转换模型部件',validating:'检查模型数据'};
const stageNames:Record<string,string>={compressing:'压缩上传包',reading:'读取文件',transferring:'传送到后台',sanitizing:'排除私有数据',validating:'校验发布内容',fingerprinting:'计算内容指纹',serializing:'生成发布请求',ready:'准备完成'};
const size=(bytes:number)=>bytes<1048576?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1048576).toFixed(2)} MB`;
export function TeamFileUploadDialog({client,kind,items,target,onClose,onCompleted}:{client:TeamClient;kind:'asset'|'scene';items:TeamItem[];target?:TeamItem;onClose:()=>void;onCompleted:()=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now),[notice,setNotice]=useState('');
 const alive=useRef(true),lock=useRef(false),input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|undefined>(undefined),cancelled=useRef(false);
 const owner=useRef({client,userId:client.user?.id});
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;cancelled.current=true;controller.current?.abort();};},[]);
 useEffect(()=>{if(!busy)return;const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[busy]);
 const changed=()=>{if(alive.current)setEntries(previous=>[...previous]);};
 const allowed=[...items.filter(item=>item.id!==target?.id),...(target?[target]:[])].filter(item=>item.kind===kind&&canUpdateTeamUpload(client,item));
 const validating=entries.some(entry=>entry.status==='validating'),attempted=entries.some(entry=>!!entry.started),success=entries.filter(entry=>entry.status==='success').length;
 async function select(files:File[]){
  const chosen=files;if(files.length>1&&target)setNotice('已选择多个文件：忽略预选更新目标，全部新增到团队库。');
  const added:Entry[]=chosen.map(file=>({id:crypto.randomUUID(),file,name:file.name,description:'',category:'',target:target?.id??'',status:'validating'}));
  setEntries(previous=>{const next=target?added:[...previous,...added];if(next.length>1)for(const entry of next)entry.target='';return next;});
  await Promise.all(added.map(async entry=>{try{entry.parsed=await parseTeamUploadFile(entry.file,kind,stage=>{entry.stage=stage;changed();});entry.name=entry.parsed.name;entry.description=entry.parsed.description;entry.category=entry.parsed.categoryPath.join(' / ');entry.status='ready';}catch(error){entry.status='error';entry.error=error instanceof Error?error.message:'文件校验失败';}changed();}));
 }
 async function publish(){
 if(lock.current)return;lock.current=true;cancelled.current=false;setBusy(true);setNotice('');
  try{
   if(owner.current.client!==client||owner.current.userId!==client.user?.id||!client.user||client.user.role==='viewer')throw Error('团队登录已变化或没有发布权限，请关闭后重新选择文件');
   for(const entry of entries){
    if(cancelled.current)break;
    if(entry.status==='success'||!entry.parsed)continue;
    entry.started=Date.now();entry.ended=undefined;entry.error=undefined;
    try{
     if(!entry.prepared){entry.status='preparing';changed();const destination=entry.target?allowed.find(item=>item.id===entry.target):undefined;if(entry.target&&!destination)throw Error('没有追加该团队原件的权限');if(entries.length>1&&destination)throw Error('批量文件只能新增到团队库');entry.prepared=await prepareTeamFileUpload(entry.parsed,{client,name:entry.name,description:entry.description,categoryPath:entry.category.split('/').map(part=>part.trim()).filter(Boolean),target:destination,key:entry.id},stage=>{entry.stage=stage;changed();});}
     entry.status='running';entry.upload=undefined;controller.current=new AbortController();changed();const result=await client.publish(entry.prepared.request,progress=>{entry.upload=progress;changed();},entry.prepared.publication,controller.current.signal);if(!result||typeof result.id!=='string'||!result.id||!Number.isSafeInteger(result.version)||result.version!==entry.prepared.request.expectedVersion+1||entry.prepared.request.itemId&&result.id!==entry.prepared.request.itemId)throw Error('服务器未返回有效发布结果，尚未确认操作结果；请重试同一项');entry.version=result.version;entry.status='success';onCompleted();
    }catch(error){entry.status='error';entry.error=controller.current?.signal.aborted?'已中止等待，尚未确认服务器结果；请手动重试同一项，勿重新选择文件。':error instanceof Error?error.message:'上传失败，请手动重试同一项';}
    controller.current=undefined;entry.ended=Date.now();changed();
   }
  }catch(error){setNotice(error instanceof Error?error.message:'发布失败');}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <PortalDialog label={target?'发布新版':'从文件上传到团队'} onClose={onClose} closable={!busy&&!validating} width={720} className="team-transfer-dialog team-file-upload-dialog">
  <header className="team-transfer-heading"><div><h2 className="team-transfer-title">{target?`发布新版：${target.name}`:'从文件上传到团队'}</h2><p className="team-transfer-description">直接发布{kind==='asset'?'资产':'场景'}文件，不导入本地库、不建立本地关联。{target?`基于固定版本 v${target.version} 追加新版，不覆盖旧版本。`:'多文件上传仅新增团队原件。'}</p></div><Button disabled={busy||validating} onClick={onClose}>关闭</Button></header>
  {busy&&<Button danger disabled={!controller.current} onClick={()=>{cancelled.current=true;controller.current?.abort();}}>中止上传 / 等待</Button>}
  {!attempted&&<div className="team-file-picker"><input ref={input} type="file" aria-label="选择团队上传文件" accept={kind==='asset'?'.glb,.json,.chat3d-asset.json':'.glb,.json,.chat3d.json'} multiple disabled={busy||validating} onChange={event=>{void select(Array.from(event.target.files??[]));event.target.value='';}}/><p>{kind==='asset'?'选择单个资产 JSON 或自包含 GLB 2.0 模型文件；不支持 GLTF 或外置 .bin、纹理资源，请先导出为单个自包含 GLB。':'选择场景项目 JSON 或自包含 GLB 2.0；不支持 GLTF 或外置 .bin、纹理资源。'}选择后立即逐项校验。可一次选择多个文件；多文件将忽略预选目标，全部新增。</p></div>}
  <section className="team-file-entries" aria-label="文件上传列表">{entries.map(entry=>{const frozen=busy||!!entry.prepared||entry.status==='success'||entry.status==='validating',upload=entry.upload,percent=upload&&upload.total>0?Math.min(100,Math.floor(upload.loaded/upload.total*100)):undefined;const label=entry.status==='success'?`发布成功 v${entry.version}`:entry.status==='error'?'失败':entry.status==='validating'?(importStages[entry.stage??'']??'校验中'):entry.status==='preparing'?(stageNames[entry.stage??'reading']??entry.stage):entry.status==='running'?(upload?.phase==='processing'?'服务器处理中':'上传中'):'待发布';return <article className="team-file-entry" key={entry.id}>
   <div className="team-selection-heading"><strong>{entry.file.name}</strong><Tag color={entry.status==='error'?'red':entry.status==='success'?'green':undefined}>{label}</Tag></div>
   <span className="team-file-size">{size(entry.file.size)}{entry.prepared?` · 上传包 ${size(entry.prepared.bytes)}`:''}</span>
   {entry.parsed&&<div className="team-file-fields"><label className="team-field"><span>名称</span><Input maxLength={80} aria-label={`${entry.file.name} 名称`} value={entry.name} disabled={frozen} onChange={event=>{entry.name=event.target.value;changed();}}/></label><label className="team-field"><span>说明</span><Input.TextArea maxLength={2000} aria-label={`${entry.file.name} 说明`} value={entry.description} disabled={frozen} onChange={event=>{entry.description=event.target.value;changed();}}/></label><label className="team-field"><span>分类路径（以 / 分隔）</span><Input list={`team-upload-categories-${entry.id}`} aria-label={`${entry.file.name} 分类路径`} value={entry.category} disabled={frozen} onChange={event=>{entry.category=event.target.value;changed();}}/></label><label className="team-field"><span>发布位置</span><select aria-label={`${entry.file.name} 发布位置`} value={entry.target} disabled={frozen||entries.length>1} onChange={event=>{entry.target=event.target.value;changed();}}><option value="">新增到团队库</option>{allowed.map(item=><option key={item.id} value={item.id}>{item.name} · 基于 v{item.version} 发布新版</option>)}</select></label><datalist id={`team-upload-categories-${entry.id}`}>{Array.from(new Set(items.map(item=>item.categoryPath?.join(' / ')??'').filter(Boolean))).map(path=><option key={path} value={path}/>)}</datalist></div>}
   {(entry.status==='validating'||entry.status==='preparing'||entry.status==='running')&&<div className="team-publish-progress" role="status"><div className="team-publish-progress-label"><span>{upload?.phase==='uploading'?`已上传 ${size(upload.loaded)} / ${size(upload.total)}${upload.computable!==false&&percent!==undefined?` · ${percent}%`:''}`:label}</span></div>{upload?.phase==='uploading'&&upload.computable!==false&&percent!==undefined?<progress max={100} value={percent} aria-label={`${entry.name} 上传进度`}/>:<progress aria-label={`${entry.name} ${label}`}/>}</div>}
   {entry.started&&<span className="team-publish-elapsed">{entry.ended?'用时':'已用'} {Math.max(0,Math.floor(((entry.ended??now)-entry.started)/1000))} 秒</span>}
   {entry.error&&<p className="team-error" role="alert">{entry.error}</p>}{!busy&&!attempted&&<Button type="text" onClick={()=>setEntries(previous=>previous.filter(row=>row!==entry))}>移除</Button>}
  </article>;})}</section>
  <p className="team-transfer-safety">上传开始后请等待明确结果。连接中断、超时或请求取消不表示服务器未发布；结果未确认时请手动重试同一项，沿用缓存的发布包与请求标识，不要重新选择文件重复发布。</p>
  {notice&&<p className="team-error" role="alert">{notice}</p>}{success>0&&<p className="team-transfer-complete" role="status">已成功发布 {success} 项。团队列表已刷新；未创建本地副本或关联。</p>}
  <footer className="team-transfer-actions"><Button disabled={busy||validating} onClick={onClose}>关闭</Button><Button type="primary" disabled={busy||validating||!entries.some(entry=>entry.parsed&&entry.status!=='success')||entries.some(entry=>entry.parsed&&!entry.name.trim())||entries.length>1&&entries.some(entry=>!!entry.target)} onClick={()=>void publish()}>{busy?'正在发布…':attempted?'手动重试失败项':'确认上传并发布'}</Button></footer>
 </PortalDialog>;
}
