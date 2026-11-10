import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Button as AntButton,Input,Tag} from 'antd';
import {PortalDialog} from './kit/PortalDialog';
import {Cross1Icon,UploadIcon,DownloadIcon} from '@radix-ui/react-icons';
import {acquireLinkedTeamVersion,beginTeamAuthorization,defaultTeamServiceBase,getTeamSession,getTeamSessionStatus,listTeamPublishSources,loginTeamSession,logoutTeamSession,prepareTeamPublications,publishPreparedTeamBatch,resolveTeamPublishTarget,resumeTeamFromPlatformAuth,subscribeTeamSession,type PreparedTeamPublication,type TeamItem,type TeamLocalSource,type TeamPreparationProgress,type TeamPublishSource} from '../domain/teamLibrary';
import {showTeamPasswordLogin} from '../domain/platformOAuth';
import {OperationProgress,nextProgressPaint} from './OperationProgress';
import {listModelAssets} from '../domain/modelAssetStorage';
import {useWorkspaceStore} from '../workspace';
import type {TeamResourceLink} from '../domain/teamResourceLinks';
import './team-library.css';

export function TeamSessionLogin({onConnected,serviceOrigin}:{onConnected?:()=>void;serviceOrigin?:string}){
 const sessionStatus=useSyncExternalStore(subscribeTeamSession,getTeamSessionStatus,getTeamSessionStatus);
 const address=serviceOrigin??defaultTeamServiceBase();
 const [teamUser,setTeamUser]=useState(''),[teamPassword,setTeamPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[waiting,setWaiting]=useState(false);const lock=useRef(false);
 const debugPassword=showTeamPasswordLogin();
 useEffect(()=>{if(getTeamSession()?.user||!address)return;let alive=true;void resumeTeamFromPlatformAuth(address).then(next=>{if(alive&&next)onConnected?.();}).catch(()=>{});return ()=>{alive=false;};},[address,onConnected]);
 function submit(action:()=>Promise<unknown>){if(lock.current)return;lock.current=true;setBusy(true);setError('');void action().then(()=>{setTeamPassword('');setWaiting(false);onConnected?.();}).catch(error=>{setWaiting(false);setError(error instanceof Error?error.message:'团队登录失败');}).finally(()=>{lock.current=false;setBusy(false);});}
 return <form className="team-login-card" onSubmit={event=>{event.preventDefault();setWaiting(true);submit(()=>beginTeamAuthorization({base:address}));}}>
  <header><h3>通过协同平台登录</h3><p>在授权页面完成登录后自动返回，登录状态在应用内共用。</p></header>
  {!address&&<p className="team-security-note" role="status">团队授权服务尚未配置，请联系管理员。你可以继续使用本地资源。</p>}
  {error&&<p className="team-error" role="alert">{error}</p>}
  <AntButton htmlType="submit" disabled={busy||!address||sessionStatus==='restoring'}>{sessionStatus==='restoring'?'正在恢复登录…':busy||waiting?'等待协同登录…':'登录授权'}</AntButton>
  {waiting&&!error&&<p className="team-security-note">已打开协同登录，请在浏览器完成授权后回到本窗口。</p>}
  {debugPassword&&<>
   <label className="team-field"><span>团队账号</span><Input aria-label="团队账号" autoComplete="username" value={teamUser} onChange={event=>setTeamUser(event.target.value)} disabled={busy}/></label>
   <label className="team-field"><span>团队密码</span><Input aria-label="团队密码" type="password" autoComplete="current-password" value={teamPassword} onChange={event=>setTeamPassword(event.target.value)} disabled={busy}/></label>
   <AntButton htmlType="button" disabled={busy||!address||!teamUser||!teamPassword} onClick={()=>submit(()=>loginTeamSession(address,teamUser,teamPassword))}>使用团队密码登录</AntButton>
  </>}
 </form>;
}

export interface TeamTransferDialogProps {
 kind:'asset'|'scene';mode:'publish'|'acquire';sources?:TeamLocalSource[];items?:TeamItem[];serviceOrigin?:string;onClose:()=>void;onCompleted?:()=>void;onLocate?:(ids:string[])=>void;
}
interface Acquisition {item:TeamItem;status:'ready'|'running'|'success'|'error';error?:string;reused?:boolean;link?:TeamResourceLink}
function publicationSize(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(2)} MB`;}
function PublishEntry({entry,now}:{entry:PreparedTeamPublication;now:number}){
 const running=entry.status==='running',upload=entry.upload,uploading=running&&upload?.phase==='uploading',processing=running&&upload?.phase==='processing';
 const percent=upload&&upload.total>0?Math.min(100,Math.max(0,Math.floor(upload.loaded/upload.total*100))):undefined;
 const elapsed=entry.startedAt===undefined?undefined:Math.max(0,Math.floor(((entry.endedAt??now)-entry.startedAt)/1000));
 const label=entry.status==='success'?`已发布 v${entry.serverResult?.version}`:entry.status==='error'?'发布失败':processing?'服务器处理中':uploading?'上传中':running?'准备中':'待确认';
 return <div className="team-transfer-result team-publish-result"><div className="team-publish-content"><strong>{entry.request.name}</strong><span>{entry.request.itemId?`更新团队版本 v${entry.request.expectedVersion+1}`:'新增到团队库'}{entry.bytes!==undefined?` · ${publicationSize(entry.bytes)}`:''}</span>
  {running&&<div className="team-publish-progress"><div className="team-publish-progress-label"><span>{uploading&&upload?(upload.computable===false?`正在上传 · ${publicationSize(upload.total)}`:`已上传 ${publicationSize(upload.loaded)} / ${publicationSize(upload.total)}${percent!==undefined?` · ${percent}%`:''}`):label}</span>{elapsed!==undefined&&<span>已用 {elapsed} 秒</span>}</div>{uploading&&upload?.computable!==false&&percent!==undefined?<progress aria-label={`${entry.request.name} 上传进度`} max={100} value={percent}/>:<progress aria-label={`${entry.request.name} ${label}`}/>}</div>}
  {!running&&elapsed!==undefined&&<span className="team-publish-elapsed">用时 {elapsed} 秒</span>}
  {entry.error&&<p className="team-error" role="alert">{entry.error}</p>}
 </div><Tag color={entry.status==='error'?'red':undefined} variant="filled">{label}</Tag></div>;
}
export function TeamTransferDialog({kind,mode,sources,items,serviceOrigin,onClose,onCompleted,onLocate}:TeamTransferDialogProps){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession),[available,setAvailable]=useState<TeamPublishSource[]>([]),[selected,setSelected]=useState(()=>new Set(sources?.map(source=>source.id)??[])),[targets,setTargets]=useState<Record<string,string>>({}),[remote,setRemote]=useState<TeamItem[]>([]),[prepared,setPrepared]=useState<PreparedTeamPublication[]>(),[acquisitions]=useState<Acquisition[]>(()=>items?.map(item=>({item:{...item},status:'ready'}))??[]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);const lock=useRef(false),alive=useRef(true);
 const kindLabel=kind==='asset'?'资产':'场景';
 const sessions=useWorkspaceStore(state=>state.sessions),[localNames,setLocalNames]=useState<Record<string,string>>({});
 const localIds=acquisitions.flatMap(entry=>entry.link?[entry.link.localId]:[]);
 const [now,setNow]=useState(Date.now);
 const [operation,setOperation]=useState<'preparing'|'transferring'>(),[batchCompleted,setBatchCompleted]=useState(0);
 const [preparation,setPreparation]=useState<TeamPreparationProgress>();
 const preparationStage=preparation?({reading:'读取已保存快照',transferring:'传送场景快照到后台',sanitizing:'排除私有数据',validating:'校验发布内容',fingerprinting:'计算本地内容指纹',serializing:'生成发布请求',ready:'快照准备完成'} as Record<string,string>)[preparation.stage]??preparation.stage:'读取已保存快照';
 useEffect(()=>{if(!busy)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[busy]);
 useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!client||mode!=='publish')return;let current=true;setError('');void Promise.all([listTeamPublishSources(kind),client.list(kind)]).then(([local,rows])=>{if(current){setAvailable(local);setRemote(rows);setTargets(Object.fromEntries(local.map(source=>{const resolution=resolveTeamPublishTarget(client,source,rows);return [source.id,resolution.target?.id??(resolution.issue?'__choose__':'')];})));}}).catch(error=>{if(current)setError(error instanceof Error?error.message:'无法读取可发布资源');});return ()=>{current=false;};},[client,kind,mode]);
 function changed(){if(alive.current)setRevision(value=>value+1);}
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(error){if(alive.current)setError(error instanceof Error?error.message:'操作失败，可重试');}finally{lock.current=false;if(alive.current){setBusy(false);setOperation(undefined);setPreparation(undefined);}}}
 const publishEntries=prepared??[],results=mode==='publish'?publishEntries:acquisitions,success=results.filter(entry=>entry.status==='success').length,failed=results.filter(entry=>entry.status==='error').length,attempted=results.some(entry=>entry.status!=='ready'),complete=results.length>0&&success===results.length;
 const wrongService=!!serviceOrigin&&client?.base!==serviceOrigin;
 async function execute(){
  if(!client?.user)throw Error('请先登录团队服务');if(wrongService)throw Error('请登录该关联对应的团队服务，不能跨服务获取');
  setOperation('transferring');setBatchCompleted(success);
  await nextProgressPaint();
  const finished=new Set<PreparedTeamPublication|Acquisition>(results.filter(entry=>entry.status==='success')),running=new Set<PreparedTeamPublication|Acquisition>();
  function reportBatch(){
   for(const entry of results){if(entry.status==='running')running.add(entry);else if(running.has(entry)&&(entry.status==='success'||entry.status==='error'))finished.add(entry);}
   if(alive.current)setBatchCompleted(finished.size);changed();
  }
  if(mode==='publish')await publishPreparedTeamBatch(client,publishEntries,reportBatch);
  else {
   for(const entry of acquisitions){if(entry.status==='success')continue;entry.status='running';entry.error=undefined;reportBatch();try{const fixed=await client.read(entry.item);if(fixed.id!==entry.item.id||fixed.kind!==kind||fixed.version!==entry.item.version)throw Error('团队服务返回的固定版本不匹配');const result=await acquireLinkedTeamVersion(client,fixed);entry.reused=result.reused;entry.link=result.link;entry.status='success';}catch(error){entry.status='error';entry.error=error instanceof Error?error.message:'获取失败，可重试';}reportBatch();}
   if(kind==='asset'&&acquisitions.some(entry=>entry.link))try{const ids=new Set(acquisitions.map(entry=>entry.link?.localId));const rows=await listModelAssets();if(alive.current)setLocalNames(Object.fromEntries(rows.filter(row=>ids.has(row.id)).map(row=>[row.id,row.name])));}catch{/* The stored identity still supports location if names could not be read. */}
  }
  if(results.some(entry=>entry.status==='success'))onCompleted?.();
 }
 const dialogTitle=mode==='publish'?`发布${kindLabel}到团队`:`获取团队${kindLabel}`;
 return <PortalDialog label={dialogTitle} onClose={onClose} closable={!busy} width={mode==='publish'?620:760} className="team-transfer-dialog">
  <header className="team-transfer-heading"><div><h2 className="team-transfer-title">{dialogTitle}</h2>{mode==='acquire'&&<p className="team-transfer-description">获取固定版本作为独立本地副本。新版始终新建副本，旧内容、修改和预览全部保留。</p>}</div><AntButton type="text" disabled={busy} aria-label="关闭团队传输" onClick={onClose}><Cross1Icon/></AntButton></header>
  {!client?<TeamSessionLogin serviceOrigin={serviceOrigin}/>:<>
   {(mode==='acquire'||wrongService)&&<div className="team-transfer-service"><span>{client.user?.name} · {client.base}</span><Tag>{client.user?.role==='viewer'?'只读成员':client.user?.role==='admin'?'管理员':'团队成员'}</Tag></div>}
   {wrongService&&<div className="team-error" role="alert"><p>该关联属于 {serviceOrigin}。请登录对应服务；不会跨服务获取同名资源。</p><AntButton disabled={busy} onClick={()=>void run(logoutTeamSession)}>退出当前团队并重新登录</AntButton></div>}
   {mode==='publish'&&client.user?.role==='viewer'?<p className="team-empty">当前账号只有浏览和获取权限，不能发布。</p>:<>
    {operation==='preparing'&&<OperationProgress title={`准备发布${kindLabel}`} stage={`${preparation?.name?preparation.name+' · ':''}${preparationStage}`} completed={preparation?.completed} total={preparation?.total} detail="后台逐项处理已保存的固定快照；完成后可确认发布，此阶段不会上传到团队服务。"/>}
    {operation==='transferring'&&<OperationProgress title={mode==='publish'?'团队批量发布':'团队批量获取'} stage={`已处理 ${batchCompleted} / ${results.length} 项`} completed={batchCompleted} total={results.length} detail={`已成功 ${success} 项${failed?` · 失败 ${failed} 项，可重试`:''}`}/>}
    {mode==='publish'&&!prepared?<section className="team-transfer-selection" aria-label="选择发布内容"><div className="team-selection-heading"><strong>已保存的本地{kindLabel}</strong><span>已选 {selected.size} 项</span></div>{available.length===0?<p className="team-empty">没有可发布的已保存{kindLabel}。请先在本地库保存，未确认草稿不会出现在这里。</p>:available.filter(source=>!sources||sources.some(selected=>selected.id===source.id)).map(source=>{
     const resolution=resolveTeamPublishTarget(client,source,remote),destination=targets[source.id]??'',issue=resolution.issue&&(destination==='__choose__'||destination===resolution.target?.id)?resolution.issue:undefined;
     return <div className="team-transfer-source" key={source.id}><label><input type="checkbox" aria-label={`发布 ${source.name}`} disabled={busy} checked={selected.has(source.id)} onChange={event=>setSelected(previous=>{const next=new Set(previous);if(event.target.checked)next.add(source.id);else next.delete(source.id);return next;})}/><span>{source.name}{source.version?` · v${source.version}`:''}{issue&&<small className="team-error" role="status">{issue}</small>}{resolution.link&&!issue&&destination===resolution.target?.id&&<small>关联团队原件 · 基于 v{resolution.link.teamVersion}</small>}</span></label><select aria-label={`${source.name} 发布位置`} disabled={busy} value={destination} onChange={event=>setTargets(previous=>({...previous,[source.id]:event.target.value}))}><option value="__choose__" disabled>请选择发布位置</option><option value="">新增到团队库</option>{remote.filter(item=>item.owner===client.user?.id||client.user?.role==='admin'||item.id===resolution.target?.id).map(item=><option key={item.id} value={item.id} disabled={item.owner!==client.user?.id&&client.user?.role!=='admin'}>更新团队版本 v{item.version+1} · {item.name}</option>)}</select></div>;
    })}</section>:<section className="team-transfer-selection" aria-label={mode==='publish'?'发布列表':'固定版本获取列表'}><div className="team-selection-heading"><strong>{mode==='publish'?'发布内容':'将获取以下固定版本'}</strong><span>{success} / {results.length} 已完成</span></div>
     {mode==='publish'?publishEntries.map(entry=><PublishEntry key={entry.request.key} entry={entry} now={now}/>):acquisitions.map(entry=>{const link=entry.link,name=link&&(kind==='asset'?localNames[link.localId]:sessions.find(session=>session.id===link.localId)?.title),version=kind==='asset'?link?.localVersion:link?.sceneRevision;return <div className="team-transfer-result" key={entry.item.id+':'+entry.item.version}><div><strong>{entry.item.name}</strong><span>团队固定版本 v{entry.item.version}</span>{link&&<span>本机{kindLabel}库{name?`：${name}`:''}{version===undefined?'':` ${kind==='asset'?'v':'r'}${version}`}</span>}{entry.error&&<p className="team-error" role="alert">{entry.error}</p>}</div><Tag color={entry.status==='error'?'red':undefined} variant="filled">{entry.status==='success'?(entry.reused?'已复用既有副本':'已获取'):entry.status==='error'?'失败':entry.status==='running'?'获取中…':'待确认'}</Tag></div>;})}
    </section>}
    {mode==='acquire'&&<p className="team-transfer-safety">这是一次手动获取，不是自动同步。相同团队版本会复用已关联的副本，不重复创建。</p>}
    {mode==='publish'&&attempted&&failed>0&&<p className="team-transfer-safety">重试沿用本次发布内容与标识，已成功项不会重复发布。</p>}
    {error&&<p className="team-error" role="alert">{error}</p>}
    {((mode==='publish'&&complete)||(mode==='acquire'&&success>0&&!busy))&&<p className="team-transfer-complete" role="status">{mode==='publish'?`已发布 ${success} 项，并记录本地关联。`:`已获取 ${success} 项，结果在本机${kindLabel}库。旧副本和本地修改均已保留。`}</p>}
    {onLocate&&localIds.length>0&&!busy&&<AntButton type="primary" onClick={()=>{onClose();onLocate(localIds);}}>在{kindLabel}库中定位</AntButton>}
    <footer className="team-transfer-actions"><AntButton disabled={busy} onClick={onClose}>{attempted?'关闭':'取消'}</AntButton>{mode==='publish'&&!prepared?<AntButton disabled={busy||!selected.size||!available.length} onClick={()=>void run(async()=>{const chosen=[...(sources??available)].filter(source=>selected.has(source.id));if(chosen.some(source=>targets[source.id]==='__choose__'||targets[source.id]===undefined))throw Error('请为所选资源明确选择发布位置');const destinations=Object.fromEntries(chosen.map(source=>[source.id,remote.find(item=>item.id===targets[source.id])]));setOperation('preparing');await nextProgressPaint();setPrepared(await prepareTeamPublications(client,kind,chosen,destinations,progress=>{if(alive.current)setPreparation(progress);}));})}>{busy?'正在准备发布…':'准备发布'}</AntButton>:!complete&&<AntButton disabled={busy||!results.length||wrongService} onClick={()=>void run(execute)}>{mode==='publish'?<UploadIcon/>:<DownloadIcon/>}{busy?'正在逐项处理…':failed?`仅重试失败的 ${failed} 项`:mode==='publish'?'确认发布':'确认获取并保留旧副本'}</AntButton>}</footer>
   </>}
  </>}
  <span className="team-transfer-announcement" aria-live="polite">{busy?`正在处理，已完成 ${success} 项`:''}</span><span hidden>{revision}</span>
 </PortalDialog>;
}
