import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Button,Input,Tag} from 'antd';
import {CheckIcon,CubeIcon,DownloadIcon,GridIcon,LayersIcon,ListBulletIcon,MagnifyingGlassIcon,ReloadIcon,UploadIcon} from '@radix-ui/react-icons';
import {getTeamSession,subscribeTeamSession,type TeamClient,type TeamItem} from '../domain/teamLibrary';
import {listLocalTeamResourceStates,rememberTeamResourceHeads,subscribeTeamResourceLinks,type LocalTeamResourceState} from '../domain/teamResourceLinks';
import {assetDocument,parseModelAsset} from '../domain/modelAssets';
import {parseProject} from '../domain/project';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {useWorkspaceStore} from '../workspace';
import {TeamSessionLogin,TeamTransferDialog} from './TeamTransferDialog';
import './team-library.css';

type TeamThumbnail={image:string;notice?:string};
let teamPreviewQueue=Promise.resolve();

/** Keep private previews in this pane's session, never in the local resource library. */
function createTeamPreviewLoader(client:TeamClient){
 const cache=new Map<string,TeamThumbnail>();
 return (row:TeamItem,signal:AbortSignal,render=false)=>{
  const key=`${row.kind}:${row.id}:${row.version}`;
  const check=()=>{if(signal.aborted)throw new DOMException('Preview cancelled','AbortError');};
  const pending=teamPreviewQueue.then(async()=>{
   check();
   if(!render&&cache.has(key))return cache.get(key)!;
   const value=await client.read(row);check();
   const asset=value.kind==='asset'?parseModelAsset(JSON.stringify(value.payload)):undefined;
   const thumbnail=asset?.thumbnail&&!render?{image:asset.thumbnail}:await captureLibraryThumbnail(asset?assetDocument(asset):parseProject(JSON.stringify(value.payload)));
   check();cache.set(key,thumbnail);return thumbnail;
  });
  teamPreviewQueue=pending.then(()=>{},()=>{});
  return pending;
 };
}
type TeamPreviewLoader=(row:TeamItem,signal:AbortSignal,render?:boolean)=>Promise<TeamThumbnail>;

function TeamResourceImage({row,load,onOpen}:{row:TeamItem;load:TeamPreviewLoader;onOpen?:()=>void}){
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

export function TeamLibraryPane({kind,onCopied,showPublish=true}:{kind:'asset'|'scene';onCopied?:()=>void;showPublish?:boolean}){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession),[listing,setListing]=useState<{client:TeamClient;kind:'asset'|'scene';rows:TeamItem[]}>(),[query,setQuery]=useState(''),[view,setView]=useState<'grid'|'list'>('grid'),[filter,setFilter]=useState<'all'|'linked'|'updates'>('all'),[selected,setSelected]=useState<Set<string>>(new Set()),[links,setLinks]=useState<LocalTeamResourceState[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[previewSelection,setPreview]=useState<{client:TeamClient;item:TeamItem}>(),[transfer,setTransfer]=useState<{mode:'publish'|'acquire';items?:TeamItem[]}>();const lock=useRef(false),request=useRef(0);
 const rows=listing&&listing.client===client&&listing.kind===kind?listing.rows:[],preview=previewSelection&&previewSelection.client===client&&previewSelection.item.kind===kind?previewSelection.item:undefined,loadPreview=useMemo(()=>client?createTeamPreviewLoader(client):undefined,[client,kind]);
 const sessions=useWorkspaceStore(state=>state.sessions),kindLabel=kind==='asset'?'资产':'场景';
 useEffect(()=>{let current=true;const reload=()=>{void listLocalTeamResourceStates(kind).then(states=>{if(current)setLinks(states);}).catch(error=>{if(current)setNotice(error instanceof Error?error.message:'关联读取失败');});};reload();const unsubscribe=subscribeTeamResourceLinks(reload);return ()=>{current=false;unsubscribe();};},[kind,sessions]);
 useEffect(()=>{const id=++request.current;setListing(undefined);setSelected(new Set());setPreview(undefined);setNotice('');setTransfer(undefined);if(!client){setBusy(false);return;}setBusy(true);void client.list(kind).then(async values=>{if(id!==request.current)return;setListing({client,kind,rows:values});await rememberTeamResourceHeads(client.base,kind,values);}).catch(error=>{if(id===request.current)setNotice(error instanceof Error?error.message:'团队资源读取失败');}).finally(()=>{if(id===request.current)setBusy(false);});return ()=>{request.current++;};},[client,kind]);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setNotice('');try{await action();}catch(error){setNotice(error instanceof Error?error.message:'操作失败，可重试');}finally{lock.current=false;setBusy(false);}}
 async function refresh(){if(!client)return;const current=request.current,values=await client.list(kind);if(current!==request.current)return;setListing({client,kind,rows:values});setPreview(undefined);await rememberTeamResourceHeads(client.base,kind,values);setNotice('已检查团队版本。不会自动获取或上传本地内容。');}
 const activeLinks=links.filter(state=>state.link.active&&state.link.serviceOrigin===client?.base),linkByItem=new Map(activeLinks.map(state=>[state.link.teamItemId,state])),needle=query.trim().toLocaleLowerCase(),shown=rows.filter(row=>(!needle||`${row.name} ${row.description}`.toLocaleLowerCase().includes(needle))&&(filter==='all'||(filter==='linked'&&linkByItem.has(row.id))||(filter==='updates'&&!!linkByItem.get(row.id)?.updateAvailable))),chosen=rows.filter(row=>selected.has(row.id)),allSelected=shown.length>0&&shown.every(row=>selected.has(row.id)),updates=activeLinks.filter(state=>state.updateAvailable).length;
 function toggle(id:string){setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 function openPreview(row:TeamItem){if(client)setPreview({client,item:row});}
 return <div className="team-panel" aria-label={`团队${kindLabel}库`}>
  {!client?<section className="team-auth-layout"><div className="team-auth-intro"><span className="team-auth-symbol">{kind==='asset'?<CubeIcon/>:<LayersIcon/>}</span><p className="team-auth-eyebrow">团队资源</p><h2>共享已完成的内容，<br/>保留自己的工作节奏。</h2><p>批量发布已保存的资产与场景，按需获取同事的固定版本。团队有新版时再手动获取，绝不自动同步草稿。</p><div className="team-auth-principles"><span><CheckIcon/>跨页面保留登录会话</span><span><CheckIcon/>新版另存，旧副本不覆盖</span><span><CheckIcon/>发布前冻结快照并确认</span></div></div><TeamSessionLogin/></section>:<section className="team-workspace">
   <div className="team-browser-toolbar"><Input className="team-search-input" aria-label="搜索团队库" value={query} onChange={event=>setQuery(event.target.value)} placeholder={`搜索团队${kindLabel}名称或说明`} prefix={<MagnifyingGlassIcon/>}/><div className="team-toolbar-actions"><Button disabled={busy} onClick={()=>void run(refresh)}><ReloadIcon/>检查更新</Button>{showPublish&&client.user?.role!=='viewer'&&<Button type="primary" className="primary" disabled={busy} onClick={()=>setTransfer({mode:'publish'})}><UploadIcon/>发布到团队</Button>}<div className="team-view-switch" role="group" aria-label="团队资源视图"><Button type="text" aria-label="网格视图" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><GridIcon/></Button><Button type="text" aria-label="列表视图" aria-pressed={view==='list'} onClick={()=>setView('list')}><ListBulletIcon/></Button></div></div></div>
   <div className="team-resource-filters" role="group" aria-label="团队关联筛选">{([['all','全部资源'],['linked','已关联本地'],['updates',`可更新${updates?` ${updates}`:''}`]] as const).map(([value,label])=><Button key={value} type="text" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</Button>)}<span>{shown.length} 项{kindLabel}</span></div>
   <div className="team-batch-bar"><label><input type="checkbox" aria-label="全选当前团队资源" checked={allSelected} disabled={!shown.length||busy} onChange={()=>setSelected(previous=>{const next=new Set(previous);for(const row of shown){if(allSelected)next.delete(row.id);else next.add(row.id);}return next;})}/><span>{selected.size?`已选 ${selected.size} 项`:'选择资源以批量获取'}</span></label><Button disabled={busy||!chosen.length} onClick={()=>setTransfer({mode:'acquire',items:chosen})}><DownloadIcon/>获取所选{chosen.length?` (${chosen.length})`:''}</Button></div>
   <div className={`team-browser${preview?' has-detail':''}`}><section className={`team-results team-results-${view}`} aria-label="团队发布列表">
    {shown.length===0?<div className="team-empty-state"><span className="team-empty-icon">{kind==='asset'?<CubeIcon/>:<LayersIcon/>}</span><h3>{busy?'正在读取团队资源…':query||filter!=='all'?'没有匹配的资源':'团队库还没有发布内容'}</h3><p>{query||filter!=='all'?'调整搜索或筛选条件。':'将本地已保存内容发布到团队，同事即可按需获取。草稿不会自动上传。'}</p>{showPublish&&client.user?.role!=='viewer'&&!busy&&<Button onClick={()=>setTransfer({mode:'publish'})}>选择本地内容发布</Button>}</div>:shown.map(row=>{const linked=linkByItem.get(row.id);return <article key={`${row.kind}:${row.id}:${row.version}`} className={`team-result-card${selected.has(row.id)?' is-selected':''}${preview?.id===row.id?' is-previewing':''}`}><label className="team-result-select"><input type="checkbox" aria-label={`选择 ${row.name}`} checked={selected.has(row.id)} disabled={busy} onChange={()=>toggle(row.id)}/></label>{loadPreview&&<TeamResourceImage row={row} load={loadPreview} onOpen={()=>openPreview(row)}/>}<div className="team-result-body"><div className="team-result-title"><button disabled={busy} onClick={()=>openPreview(row)}>{row.name}</button><Tag>v{row.version}</Tag></div><p>{row.description||'暂无说明'}</p><div className="team-link-indicators">{linked?<><span>{linked.link.direction==='publish'?'已从本地发布':'已获取到本地'} · v{linked.link.teamVersion}</span>{linked.updateAvailable&&<Tag variant="filled">可获取新版</Tag>}{linked.localModified&&<Tag color="gold" variant="filled">本地有修改</Tag>}{linked.localMissing&&<Tag>旧副本已移除</Tag>}</>:<span>尚未关联本地</span>}</div></div><div className="team-result-actions"><Button disabled={busy} onClick={()=>setTransfer({mode:'acquire',items:[row]})}><DownloadIcon/>{linked?.updateAvailable?'获取新版':linked?.link.teamVersion===row.version?'查看 / 复用副本':'获取'}</Button></div></article>;})}
   </section>{preview&&<aside className="team-preview" aria-label="团队版本预览"><header className="team-preview-head"><div><h3>{preview.name}</h3><span>固定团队版本 v{preview.version}</span></div><Button type="text" aria-label="关闭预览" onClick={()=>setPreview(undefined)}>关闭</Button></header>{loadPreview&&<TeamResourceImage key={`${preview.kind}:${preview.id}:${preview.version}`} row={preview} load={loadPreview}/>}<p className="team-preview-description">{preview.description||'暂无说明'}</p><div className="team-preview-policy"><strong>按版本关联，不自动同步</strong><p>每次获取新版都创建独立副本，原有版本、本地修改和未确认预览全部保留。</p></div><Button type="primary" className="primary" disabled={busy} onClick={()=>setTransfer({mode:'acquire',items:[preview]})}><DownloadIcon/>{linkByItem.get(preview.id)?.updateAvailable?'获取新版并保留旧副本':'获取此固定版本'}</Button></aside>}</div>
  </section>}
  {(notice||busy)&&<p className="team-status" role="status">{busy?'正在处理…':notice}</p>}
  {client&&transfer&&<TeamTransferDialog kind={kind} mode={transfer.mode} items={transfer.items} serviceOrigin={client.base} onClose={()=>setTransfer(undefined)} onCompleted={()=>{void refresh().catch(error=>setNotice(error instanceof Error?error.message:'刷新失败'));onCopied?.();}}/>}
 </div>;
}
