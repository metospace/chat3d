import {useEffect,useRef,useState} from 'react';
import {Button,Input,Modal} from 'antd';
import {ArchiveIcon,ArrowRightIcon,CubeIcon,DesktopIcon,DownloadIcon,ExitIcon,LayersIcon,LockClosedIcon,MagnifyingGlassIcon,PersonIcon} from '@radix-ui/react-icons';
import {TeamClient,beginTeamAuthorization,completeTeamOAuthCallbackPage,defaultTeamServiceBase,rememberTeamServiceBase,resumeTeamFromPlatformAuth,type TeamItem,type TeamVersion} from '../domain/teamLibrary';
import {parsePlatformOAuthCallback,showTeamPasswordLogin} from '../domain/platformOAuth';
import {assetDocument,parseModelAsset} from '../domain/modelAssets';
import {parseProject} from '../domain/project';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {downloadTeamCopyFile} from '../domain/teamCopyExport';
import {BrandMark} from '../ui/BrandMark';

export function TeamWebApp(){
 const address=defaultTeamServiceBase()||window.location.origin;
 const [kind,setKind]=useState<'asset'|'scene'>('asset'),[teamUser,setTeamUser]=useState(''),[teamPassword,setTeamPassword]=useState(''),[client,setClient]=useState<TeamClient>(),[rows,setRows]=useState<TeamItem[]>([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[preview,setPreview]=useState<TeamVersion>(),[image,setImage]=useState(''),[waiting,setWaiting]=useState(false);
 const lock=useRef(false);
 const debugPassword=showTeamPasswordLogin();
 const [oauthCallback]=useState(()=>parsePlatformOAuthCallback());
 const isOAuthCallback=/\/team\/sso\/callback\/?$/.test(window.location.pathname)||Boolean(oauthCallback);
 const callbackCompletion=useRef<Promise<TeamClient>|undefined>(undefined);
 const [callbackDone,setCallbackDone]=useState(false);
 useEffect(()=>{
  if(!isOAuthCallback||!oauthCallback)return;
  let alive=true;
  setWaiting(true);setNotice('');setCallbackDone(false);
  // Exchange once so the desktop can claim by state; do NOT enter the portal team library here.
  const completion=callbackCompletion.current??=completeTeamOAuthCallbackPage(oauthCallback,{base:address});
  void completion.then(()=>{if(alive)setCallbackDone(true);}).catch(e=>{if(alive)setNotice(e instanceof Error?e.message:'协同登录失败');}).finally(()=>{if(alive)setWaiting(false);});
  return ()=>{alive=false;};
 },[isOAuthCallback,address,oauthCallback]);
 useEffect(()=>{if(client||!address||isOAuthCallback)return;let alive=true;void resumeTeamFromPlatformAuth(address).then(async next=>{if(!alive||!next)return;setClient(next);try{setRows(await next.list(kind));}catch{/* keep form */}});return ()=>{alive=false;};},[address,client,kind,isOAuthCallback]);
 const kindLabel=kind==='asset'?'资产':'场景';
 const ResourceIcon=kind==='asset'?CubeIcon:LayersIcon;
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败，可重试');}finally{lock.current=false;setBusy(false);}}
 if(isOAuthCallback){
  const title=waiting?'正在完成协同登录…':callbackDone?'协同登录已完成，请返回应用':notice?'协同登录未完成':'协同登录';
  const hint=callbackDone?'':'可关闭本页并返回 Scenivo；桌面端会自动完成登录。';
  return <div className="team-web-shell"><main className="team-web-container team-web-main"><section className="team-web-callback"><h1>{title}</h1>{hint&&<p>{hint}</p>}{notice&&<p className="team-web-error" role="alert">{notice}</p>}{!!notice&&!waiting&&<p>请返回 Scenivo，重新点击「登录授权」后再试。</p>}</section></main></div>;
 }
 async function selectKind(next:'asset'|'scene'){
  if(!client||next===kind)return;
  const results=await client.list(next,query);
  setKind(next);setRows(results);
 }
 async function openPreview(row:TeamItem){
  if(!client)return;
  const value=await client.read(row);
  const doc=value.kind==='asset'?assetDocument(parseModelAsset(JSON.stringify(value.payload))):parseProject(JSON.stringify(value.payload));
  setImage('');setPreview(value);
  setImage((await captureLibraryThumbnail(doc)).image);
 }

 return <div className="team-web-shell">
  <header className="team-web-header">
   <div className="team-web-container team-web-header-inner">
    <div className="team-web-brand"><BrandMark/><strong>Scenivo</strong><span>团队资源库</span></div>
    {client?.user?<div className="team-web-account">
     <span className="team-web-avatar" aria-hidden><PersonIcon/></span>
     <div className="team-web-account-name"><strong title={client.user.name}>{client.user.name}</strong><small>{{admin:'管理员',member:'成员',viewer:'访客'}[client.user.role]}</small></div>
     <Button type="text" aria-label="退出登录" icon={<ExitIcon/>} disabled={busy} onClick={()=>void run(async()=>{try{await client.logout();}finally{setClient(undefined);setRows([]);setPreview(undefined);setImage('');}})}><span className="team-web-exit-label">退出</span></Button>
    </div>:<span className="team-web-private"><LockClosedIcon/> 公司内部</span>}
   </div>
  </header>

  <main className="team-web-container team-web-main">
   <header className="team-web-hero">
    <div className="team-web-hero-copy">
     <span className="team-web-eyebrow"><ArchiveIcon/> 公司共享空间</span>
     <h1>团队资源库</h1>
     <p>查找团队共享的 3D 资产与场景，预览已发布版本，下载到 Scenivo 桌面端继续使用。</p>
    </div>
    <div className="team-web-hero-art" aria-hidden><CubeIcon/><LayersIcon/></div>
   </header>

   {!client?<section className="team-web-signin" aria-labelledby="team-web-login-title">
    <div className="team-web-signin-copy"><span className="team-web-tile-icon"><LockClosedIcon/></span><h2 id="team-web-login-title">登录后访问团队资源</h2><p>使用公司协同账号访问已发布的资产和场景。浏览器仅提供预览和下载，发布与编辑请使用桌面端。</p></div>
    <form className="team-web-login-form" onSubmit={e=>{e.preventDefault();void run(async()=>{setWaiting(true);try{const next=await beginTeamAuthorization({base:address});setClient(next);setRows(await next.list(kind));}finally{setWaiting(false);}});}}>
     <Button type="primary" variant="solid" color="primary" className="team-web-primary" htmlType="submit" size="large" disabled={busy}>{busy||waiting?'等待协同登录…':'登录授权'}<ArrowRightIcon/></Button>
     {waiting&&!notice&&<p>请在协同平台完成授权，然后返回本页。</p>}
     {debugPassword&&<>
      <label className="team-web-field"><span>团队账号</span><Input aria-label="团队账号" autoComplete="username" value={teamUser} onChange={e=>setTeamUser(e.target.value)} disabled={busy}/></label>
      <label className="team-web-field"><span>团队密码</span><Input aria-label="团队密码" type="password" autoComplete="current-password" value={teamPassword} onChange={e=>setTeamPassword(e.target.value)} disabled={busy}/></label>
      <Button disabled={busy} onClick={()=>void run(async()=>{const next=new TeamClient(address);await next.login(teamUser,teamPassword);rememberTeamServiceBase(next.base);setTeamPassword('');setClient(next);setRows(await next.list(kind));})}>使用团队密码登录</Button>
     </>}
    </form>
   </section>:<section className="team-web-library" aria-labelledby="team-web-results-title">
    <div className="team-web-toolbar">
     <div className="team-web-kind" role="group" aria-label="资源类型">
      <Button type="text" aria-pressed={kind==='asset'} disabled={busy} icon={<CubeIcon/>} onClick={()=>void run(()=>selectKind('asset'))}>团队资产</Button>
      <Button type="text" aria-pressed={kind==='scene'} disabled={busy} icon={<LayersIcon/>} onClick={()=>void run(()=>selectKind('scene'))}>团队场景</Button>
     </div>
     <form className="team-web-search" role="search" onSubmit={e=>{e.preventDefault();void run(async()=>setRows(await client.list(kind,query)));}}>
      <Input aria-label="搜索团队库" value={query} onChange={e=>setQuery(e.target.value)} placeholder={`搜索${kindLabel}名称或说明`} prefix={<MagnifyingGlassIcon/>}/>
      <Button className="team-web-primary" type="primary" variant="solid" color="primary" htmlType="submit" disabled={busy}>搜索</Button>
     </form>
    </div>
    <div className="team-web-results-heading"><h2 id="team-web-results-title">已发布{kindLabel}</h2><span aria-live="polite">{rows.length} 项结果</span></div>
    {rows.length===0?<div className="team-web-empty"><span className="team-web-tile-icon"><ResourceIcon/></span><h3>暂无可显示的{kindLabel}</h3><p>试试其他关键词，或在 Scenivo 桌面端发布资源。</p></div>:
     <div className="team-web-results">{rows.map(row=><article key={row.id} className="team-web-card">
      <div className="team-web-card-cover" data-kind={row.kind}><span className="team-web-tile-icon" aria-hidden><ResourceIcon/></span><span className="team-web-version">v{row.version}</span></div>
      <div className="team-web-card-body"><h3>{row.name}</h3>{row.description&&<p>{row.description}</p>}
       <Button className="team-web-card-action" type="text" aria-label={`预览${row.name}`} disabled={busy} onClick={()=>void run(()=>openPreview(row))}>预览<ArrowRightIcon/></Button>
      </div>
     </article>)}</div>}
   </section>}
   {!preview&&(notice||busy)&&<p className="team-web-notice" role="status">{busy?'处理中…':notice}</p>}
  </main>

  <footer className="team-web-footer"><div className="team-web-container team-web-footer-inner"><span><LockClosedIcon/> 资源由公司团队服务管理</span><span><DesktopIcon/> 发布与编辑请使用 Scenivo 桌面端</span></div></footer>

  {preview&&<Modal open centered width={600} rootClassName="team-web-modal" title={preview.name} closable={{'aria-label':'关闭预览'}} onCancel={()=>{setPreview(undefined);setImage('');setNotice('');}} footer={<Button className="team-web-primary" type="primary" variant="solid" color="primary" icon={<DownloadIcon/>} disabled={busy} onClick={()=>void run(async()=>setNotice(downloadTeamCopyFile(preview)))}>下载桌面导入包</Button>}>
   <p className="team-web-preview-meta">团队{preview.kind==='asset'?'资产':'场景'} <span className="team-web-version">v{preview.version}</span></p>
   <div className="team-web-preview-media">{image?<img src={image} alt={`${preview.name} 预览`}/>:<p role="status">{busy?'正在生成预览…':'暂时无法显示预览'}</p>}</div>
   <p className="team-web-preview-copy">{preview.kind==='asset'?'在桌面端的「资产库 → 模型资产库」导入 JSON。':'在桌面端工作台的「打开项目」中导入场景文件。'}</p>
   {notice&&<p className="team-web-notice" role="status">{notice}</p>}
  </Modal>}
 </div>;
}
